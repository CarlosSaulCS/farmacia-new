import type { Prisma } from "@prisma/client";
import cors from "cors";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import morgan from "morgan";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  requestAionBusinessInsights,
  requestAionPriceAdjustments,
  type PriceAdjustmentSuggestion,
} from "./aion.js";
import { config } from "./config.js";
import { loadPrismaClientPackage } from "./prisma-client-package.js";
import { prisma } from "./prisma.js";

const prismaClientPackage = loadPrismaClientPackage();
const {
  AppointmentStatus,
  CashMovementType,
  CashSessionStatus,
  FollowUpStatus,
  ProductKind,
} = prismaClientPackage;

type ProductKindCode = import("@prisma/client").ProductKind;
type AppointmentStatusCode = import("@prisma/client").AppointmentStatus;
type CashMovementTypeCode = import("@prisma/client").CashMovementType;

class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const app = express();
const allowedOrigins = config.webOrigins
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowAllOrigins = allowedOrigins.length === 0 || allowedOrigins.includes("*");

function isAllowedOrigin(origin: string): boolean {
  if (allowedOrigins.includes(origin)) {
    return true;
  }

  if (origin.startsWith("file://") && allowedOrigins.includes("file://")) {
    return true;
  }

  return false;
}

app.use(
  cors({
    origin(origin, callback) {
      if (allowAllOrigins) {
        callback(null, true);
        return;
      }

      if (!origin || origin === "null" || isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(new ApiError(403, `Origen no permitido: ${origin}`));
    },
  }),
);
app.use(express.json({ limit: "2mb" }));
app.use(morgan("dev"));

type AsyncHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<void>;

const asyncHandler =
  (handler: AsyncHandler) => (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res, next).catch(next);
  };

const inventoryKinds: ProductKindCode[] = [
  ProductKind.MEDICATION,
  ProductKind.MEDICAL_SUPPLY,
];
const serviceKind = ProductKind.MEDICAL_SERVICE;
const expirationAlertDays = 45;
const appointmentReminderMinutes = 60;
const genericMedicationCategories = new Set([
  "",
  "Medicamento",
  "Medicamentos generales",
]);

const productBaseSchema = z.object({
  sku: z.string().min(2).max(40).optional(),
  name: z.string().min(2).max(120),
  commercialName: z.string().max(120).optional(),
  kind: z.nativeEnum(ProductKind).default(ProductKind.MEDICATION),
  description: z.string().max(500).optional(),
  category: z.string().max(80).optional(),
  unit: z.string().max(30).optional(),
  cost: z.number().nonnegative().default(0),
  price: z.number().positive(),
  stock: z.number().int().nonnegative().default(0),
  minStock: z.number().int().nonnegative().default(0),
  expiresAt: z.string().max(40).nullable().optional(),
  lotCode: z.string().max(60).optional(),
  isActive: z.boolean().optional(),
});

const productCreateSchema = productBaseSchema.refine((value) => {
  return value.kind === serviceKind || value.price >= value.cost;
}, {
  path: ["price"],
  message: "El precio al publico no puede ser menor al costo.",
});

const productUpdateSchema = productBaseSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Debes enviar al menos un campo para actualizar.",
  })
  .refine((value) => {
    if (typeof value.price === "number" && typeof value.cost === "number") {
      if (value.kind === serviceKind) {
        return true;
      }
      return value.price >= value.cost;
    }
    return true;
  }, {
    path: ["price"],
    message: "El precio al publico no puede ser menor al costo.",
  });

const stockAdjustSchema = z.object({
  change: z.number().int().optional(),
  targetStock: z.number().int().nonnegative().optional(),
  reason: z.string().min(3).max(120),
  lotCode: z.string().max(60).optional(),
  expiresAt: z.string().max(40).nullable().optional(),
  cost: z.number().nonnegative().optional(),
}).superRefine((value, context) => {
  const hasChange = typeof value.change === "number";
  const hasTargetStock = typeof value.targetStock === "number";

  if (hasChange === hasTargetStock) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["targetStock"],
      message: "Envia stock fisico real o cambio de cantidad, pero no ambos.",
    });
  }

  if (hasChange && value.change === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["change"],
      message: "El cambio de cantidad debe ser distinto de 0.",
    });
  }
});

const saleCreateSchema = z.object({
  customerName: z.string().max(120).optional(),
  notes: z.string().max(500).optional(),
  discount: z.number().min(0).default(0),
  amountPaid: z.number().min(0).optional(),
  changeGiven: z.number().min(0).optional(),
  items: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1),
});

const appointmentCreateSchema = z.object({
  patientName: z.string().min(2).max(120),
  patientPhone: z.string().max(40).optional(),
  serviceType: z.string().min(2).max(120),
  notes: z.string().max(500).optional(),
  appointmentAt: z.string().datetime(),
});

const appointmentStatusSchema = z.object({
  status: z.nativeEnum(AppointmentStatus),
});

const aiAdjustmentInputSchema = z.object({
  marketShift: z.number().min(-0.25).max(0.25).optional(),
  trigger: z.enum(["manual", "monthly-cutoff", "cost-increase"]).optional(),
});

const patientCreateSchema = z.object({
  fullName: z.string().min(2).max(120),
  phone: z.string().max(40).optional(),
  notes: z.string().max(500).optional(),
});

const consultationCreateSchema = z.object({
  patientId: z.number().int().positive(),
  appointmentId: z.number().int().positive().optional(),
  serviceProductId: z.number().int().positive().optional(),
  serviceType: z.string().min(2).max(120),
  summary: z.string().max(500).optional(),
  diagnosis: z.string().max(500).optional(),
  treatment: z.string().max(500).optional(),
  observations: z.string().max(1000).optional(),
  followUpAt: z.string().datetime().optional(),
  followUpStatus: z.nativeEnum(FollowUpStatus).optional(),
});

const followUpStatusSchema = z.object({
  status: z.nativeEnum(FollowUpStatus),
});

const cashSessionOpenSchema = z.object({
  openingAmount: z.number().min(0).default(0),
  notes: z.string().max(500).optional(),
});

const cashMovementCreateSchema = z.object({
  type: z.nativeEnum(CashMovementType).refine(
    (value) => value === CashMovementType.INCOME || value === CashMovementType.EXPENSE || value === CashMovementType.ADJUSTMENT,
    { message: "Solo se permiten movimientos manuales de ingreso, egreso o ajuste." },
  ),
  amount: z.number().positive(),
  reason: z.string().min(3).max(200),
});

const cashSessionCloseSchema = z.object({
  countedAmount: z.number().min(0),
  notes: z.string().max(500).optional(),
});

const assistantQuerySchema = z.object({
  query: z.string().min(2).max(240),
});

function parseId(rawId: string): number {
  const id = Number.parseInt(rawId, 10);
  if (Number.isNaN(id) || id <= 0) {
    throw new ApiError(400, "ID invalido.");
  }
  return id;
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}

function normalizeDateInput(raw: string): Date {
  const normalized = raw.includes("T") ? raw : `${raw}T00:00:00`;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError(400, "La fecha de caducidad no es valida.");
  }
  return parsed;
}

function resolveProductExpirationDate(
  kind: ProductKindCode,
  rawValue: string | null | undefined,
  fallback: Date | null,
): Date | null {
  if (kind !== ProductKind.MEDICATION) {
    return null;
  }

  let resolvedDate: Date | null = fallback;
  if (rawValue !== undefined) {
    resolvedDate = rawValue ? normalizeDateInput(rawValue) : null;
  }

  if (!resolvedDate) {
    throw new ApiError(
      400,
      "La fecha de caducidad es obligatoria para medicamentos.",
    );
  }

  return resolvedDate;
}

function defaultCategoryForKind(kind: ProductKindCode): string {
  if (kind === ProductKind.MEDICAL_SUPPLY) {
    return "Material quirurgico";
  }
  if (kind === ProductKind.MEDICAL_SERVICE) {
    return "Servicio medico";
  }
  return "Medicamentos generales";
}

function inferProductCategory(name: string, kind: ProductKindCode): string {
  if (kind !== ProductKind.MEDICATION) {
    return defaultCategoryForKind(kind);
  }

  const normalized = normalizeSearchValue(name);
  if (/(amoxicilina|azitromicina|ampicilina|cef|cipro|clindamicina|metronidazol)/.test(normalized)) {
    return "Antibioticos";
  }
  if (/(losartan|metformina|enalapril|amlodipino|atorvastatina|glibenclamida|insulina)/.test(normalized)) {
    return "Cronicos";
  }
  if (/(paracetamol|ibuprofeno|diclofenaco|naproxeno|ketorolaco|aspirina)/.test(normalized)) {
    return "Analgesicos y antiinflamatorios";
  }
  if (/(loratadina|cetirizina|salbutamol|ambroxol|dextrometorfano|clorfenamina)/.test(normalized)) {
    return "Alergias y respiratorio";
  }
  if (/(omeprazol|loperamida|butilhioscina|metoclopramida|ranitidina|antiacido)/.test(normalized)) {
    return "Gastrointestinal";
  }

  return "Medicamentos generales";
}

function defaultUnitForKind(kind: ProductKindCode): string {
  if (kind === ProductKind.MEDICAL_SUPPLY) {
    return "pieza";
  }
  if (kind === ProductKind.MEDICAL_SERVICE) {
    return "servicio";
  }
  return "caja";
}

type PrismaTx = Prisma.TransactionClient;
type PrismaDb = PrismaTx | typeof prisma;

type SearchableProduct = {
  id?: number;
  sku: string;
  name: string;
  commercialName: string | null;
  category: string | null;
  kind?: ProductKindCode;
  stock?: number;
  minStock?: number;
};

type SearchIntent = {
  wantsRestock: boolean;
  wantsOutOfStock: boolean;
  wantsExpiring: boolean;
  wantsServices: boolean;
  wantsInventory: boolean;
  assistantTopic: "restock" | "top-sales" | "follow-up" | "sales-summary" | "general";
  aliases: string[];
};

type OperationalAlertLevel = "info" | "warning" | "critical";

type OperationalAlert = {
  id: string;
  type:
    | "LOW_STOCK"
    | "OUT_OF_STOCK"
    | "EXPIRING"
    | "UPCOMING_APPOINTMENT"
    | "FOLLOW_UP"
    | "LOW_ROTATION"
    | "CASH_MISMATCH"
    | "SALES_ANOMALY";
  level: OperationalAlertLevel;
  title: string;
  message: string;
  module: "inventory" | "appointments" | "reports" | "pos";
  entityId?: number;
  entityType?: string;
};

function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeSkuInput(value: string): string {
  return stripDiacritics(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function skuPrefixForKind(kind: ProductKindCode): string {
  if (kind === ProductKind.MEDICAL_SUPPLY) {
    return "INS";
  }
  if (kind === ProductKind.MEDICAL_SERVICE) {
    return "SER";
  }
  return "MED";
}

function buildSkuStem(name: string): string {
  const cleanName = stripDiacritics(name)
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .trim();

  const tokens = cleanName.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return "ITEM";
  }

  return [tokens[0]?.slice(0, 4), tokens[1]?.slice(0, 3), tokens[2]?.slice(0, 3)]
    .filter(Boolean)
    .join("-");
}

function buildSkuBase(name: string, kind: ProductKindCode): string {
  const candidate = normalizeSkuInput(`${skuPrefixForKind(kind)}-${buildSkuStem(name)}`);
  return candidate || `${skuPrefixForKind(kind)}-ITEM`;
}

async function generateUniqueSku(
  tx: PrismaTx,
  name: string,
  kind: ProductKindCode,
): Promise<string> {
  const baseCandidate = buildSkuBase(name, kind).slice(0, 32).replace(/-+$/g, "");
  const safeBase = baseCandidate.length >= 2
    ? baseCandidate
    : `${skuPrefixForKind(kind)}-ITEM`;

  for (let attempt = 0; attempt < 500; attempt += 1) {
    const suffix = attempt === 0 ? "" : `-${String(attempt + 1).padStart(2, "0")}`;
    const sku = `${safeBase}${suffix}`.slice(0, 40).replace(/-+$/g, "");

    const exists = await tx.product.findUnique({
      where: { sku },
      select: { id: true },
    });

    if (!exists) {
      return sku;
    }
  }

  throw new ApiError(500, "No fue posible generar un SKU unico para el producto.");
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function normalizeSearchValue(value: string): string {
  return stripDiacritics(value)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueTokens(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  if (left.length === 0) {
    return right.length;
  }
  if (right.length === 0) {
    return left.length;
  }

  const previous = new Array<number>(right.length + 1).fill(0);
  const current = new Array<number>(right.length + 1).fill(0);

  for (let j = 0; j <= right.length; j += 1) {
    previous[j] = j;
  }

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost,
      );
    }

    for (let j = 0; j <= right.length; j += 1) {
      previous[j] = current[j];
    }
  }

  return previous[right.length];
}

function inferSearchIntent(query: string): SearchIntent {
  const normalized = normalizeSearchValue(query);
  const tokens = uniqueTokens(normalized.split(" "));
  const aliases = new Set<string>(tokens);
  const keywordAliases: Record<string, string[]> = {
    surtir: ["reabasto", "reponer", "faltante", "faltantes", "restock"],
    agotado: ["sin stock", "stock cero", "agotados"],
    antibiotico: ["amoxicilina", "azitromicina"],
    curacion: ["gasas", "alcohol", "guantes", "jeringa", "inyeccion"],
    servicio: ["consulta", "curacion", "nebulizacion", "chequeo"],
    paciente: ["cita", "seguimiento", "consulta"],
    caducidad: ["caduca", "vencido", "vencimiento", "expira"],
  };

  for (const token of tokens) {
    for (const alias of keywordAliases[token] ?? []) {
      aliases.add(alias);
    }
  }

  const tokenSet = new Set(tokens);
  return {
    wantsRestock:
      tokenSet.has("surtir") ||
      tokenSet.has("reabasto") ||
      tokenSet.has("reponer") ||
      tokenSet.has("faltante"),
    wantsOutOfStock:
      tokenSet.has("agotado") ||
      tokenSet.has("agotados") ||
      (tokenSet.has("sin") && tokenSet.has("stock")),
    wantsExpiring:
      tokenSet.has("caducidad") ||
      tokenSet.has("caduca") ||
      tokenSet.has("vencido") ||
      tokenSet.has("vencimiento"),
    wantsServices:
      tokenSet.has("servicio") ||
      tokenSet.has("consulta") ||
      tokenSet.has("curacion") ||
      tokenSet.has("nebulizacion"),
    wantsInventory:
      tokenSet.has("inventario") ||
      tokenSet.has("medicamento") ||
      tokenSet.has("material") ||
      tokenSet.has("producto"),
    assistantTopic:
      tokenSet.has("seguimiento")
        ? "follow-up"
        : tokenSet.has("vendidos") || (tokenSet.has("mas") && tokenSet.has("vendidos"))
          ? "top-sales"
          : tokenSet.has("ventas") && (tokenSet.has("dia") || tokenSet.has("hoy"))
            ? "sales-summary"
            : tokenSet.has("surtir") || tokenSet.has("reabasto")
              ? "restock"
              : "general",
    aliases: [...aliases],
  };
}

function scoreProductSearch(product: SearchableProduct, query: string): number {
  const normalizedQuery = normalizeSearchValue(query);
  if (!normalizedQuery) {
    return 0;
  }

  const intent = inferSearchIntent(query);
  const haystack = uniqueTokens([
    normalizeSearchValue(product.name),
    normalizeSearchValue(product.commercialName ?? ""),
    normalizeSearchValue(product.sku),
    normalizeSearchValue(product.category ?? ""),
    normalizeSearchValue(product.kind ?? ""),
  ]);
  const compoundHaystack = haystack.join(" ");

  let score = 0;
  if (compoundHaystack.startsWith(normalizedQuery)) {
    score += 12;
  }
  if (compoundHaystack.includes(normalizedQuery)) {
    score += 8;
  }

  for (const token of intent.aliases) {
    if (!token) {
      continue;
    }

    if (normalizeSearchValue(product.name).startsWith(token)) score += 8;
    if (normalizeSearchValue(product.commercialName ?? "").startsWith(token)) score += 7;
    if (normalizeSearchValue(product.sku).startsWith(token)) score += 6;
    if (compoundHaystack.includes(token)) score += 4;

    for (const hay of haystack) {
      const candidateTokens = hay.split(" ").filter(Boolean);
      if (candidateTokens.some((candidate) =>
        candidate.length >= 4 &&
        token.length >= 4 &&
        levenshteinDistance(candidate, token) <= 1
      )) {
        score += 3;
        break;
      }
    }
  }

  if (intent.wantsRestock && typeof product.stock === "number" && typeof product.minStock === "number") {
    if (product.stock <= product.minStock) {
      score += 12;
    }
  }
  if (intent.wantsOutOfStock && product.stock === 0) {
    score += 14;
  }
  if (intent.wantsServices && product.kind === ProductKind.MEDICAL_SERVICE) {
    score += 10;
  }
  if (intent.wantsInventory && product.kind !== ProductKind.MEDICAL_SERVICE) {
    score += 6;
  }

  return score;
}

function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value);
  if (!text.includes(",") && !text.includes("\"") && !text.includes("\n")) {
    return text;
  }

  return `"${text.replaceAll("\"", "\"\"")}"`;
}

type PricingTrigger = "manual" | "monthly-cutoff" | "cost-increase";

type InventoryProductForPricing = {
  id: number;
  name: string;
  kind: ProductKindCode;
  category: string | null;
  cost: number;
  price: number;
  stock: number;
  minStock: number;
};

function targetMarginForKind(kind: ProductKindCode): number {
  return kind === ProductKind.MEDICATION ? 0.32 : 0.27;
}

function roundPercent(value: number): number {
  return Number((value * 100).toFixed(1));
}

function calculateSuggestedPublicPrice(
  product: InventoryProductForPricing,
  marketShift: number,
  recentCostIncreaseRatio: number,
  trigger: PricingTrigger,
): PriceAdjustmentSuggestion {
  const currentPrice = Math.max(0.1, product.price);
  const currentCost = Math.max(0, product.cost);
  const currentMargin = currentPrice > 0 ? (currentPrice - currentCost) / currentPrice : 0;
  const targetMargin = targetMarginForKind(product.kind);

  const reasons: string[] = [];
  let adjustment = marketShift;

  if (trigger === "monthly-cutoff") {
    reasons.push("Revision mensual de margen por corte de caja.");
  }

  if (recentCostIncreaseRatio > 0) {
    adjustment += Math.min(0.12, recentCostIncreaseRatio);
    reasons.push(
      `Costo reciente al alza (+${roundPercent(recentCostIncreaseRatio)}%).`,
    );
  }

  if (currentMargin < targetMargin) {
    reasons.push(
      `Margen bajo (${roundPercent(currentMargin)}%). Objetivo: ${roundPercent(targetMargin)}%.`,
    );
  }

  if (product.stock <= product.minStock) {
    adjustment += 0.04;
    reasons.push("Stock bajo: se sugiere proteger margen.");
  } else if (product.minStock > 0 && product.stock >= product.minStock * 2) {
    adjustment -= 0.03;
    reasons.push("Stock alto: se puede estimular rotacion.");
  }

  const marketShiftPrice = currentPrice * (1 + adjustment);
  const marginFloorPrice = currentCost > 0
    ? currentCost / Math.max(0.1, 1 - targetMargin)
    : marketShiftPrice;

  const suggestedPrice = roundMoney(
    Math.max(0.1, marketShiftPrice, marginFloorPrice, currentCost * 1.05),
  );

  return {
    productId: product.id,
    productName: product.name,
    suggestedPrice,
    reason:
      reasons.length > 0
        ? reasons.join(" ")
        : "Revision de precio por comportamiento de mercado.",
    confidence: trigger === "monthly-cutoff" ? 0.78 : 0.72,
    currentCost: roundMoney(currentCost),
    currentPrice: roundMoney(currentPrice),
    marginPct: roundPercent(currentMargin),
    trigger,
    source: "local",
  };
}

async function getRecentCostIncreaseRatios(days = 45): Promise<Map<number, number>> {
  const recentEvents = await prisma.productCostEvent.findMany({
    where: {
      createdAt: { gte: daysAgo(days) },
    },
    orderBy: { createdAt: "desc" },
  });

  const ratioByProduct = new Map<number, number>();
  for (const event of recentEvents) {
    if (!ratioByProduct.has(event.productId)) {
      ratioByProduct.set(event.productId, Math.max(0, event.changePct));
    }
  }

  return ratioByProduct;
}

async function buildPriceSuggestions(
  marketShift: number,
  trigger: PricingTrigger,
): Promise<{
  source: "aion" | "local";
  suggestions: PriceAdjustmentSuggestion[];
}> {
  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      kind: { in: inventoryKinds },
      unit: { not: "servicio" },
    },
    orderBy: { name: "asc" },
  });
  const productNameById = new Map(products.map((product) => [product.id, product.name]));

  const [recentCostIncreaseByProduct, recentPriceEvents] = await Promise.all([
    getRecentCostIncreaseRatios(),
    prisma.productPriceEvent.findMany({
      where: {
        createdAt: { gte: daysAgo(180) },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const priceHistoryByProduct = new Map<number, number[]>();
  for (const event of recentPriceEvents) {
    const history = priceHistoryByProduct.get(event.productId) ?? [];
    if (history.length < 8) {
      history.push(event.newPrice, event.previousPrice);
    }
    priceHistoryByProduct.set(event.productId, history);
  }

  const externalSuggestions = await requestAionPriceAdjustments({
    marketShift,
    trigger,
    products,
    recentCostIncreaseByProduct: Object.fromEntries(recentCostIncreaseByProduct),
  });

  if (externalSuggestions && externalSuggestions.length > 0) {
    return {
      source: "aion",
      suggestions: externalSuggestions.map((item) => ({
        ...item,
        productName: item.productName ?? productNameById.get(item.productId),
        trigger: item.trigger ?? trigger,
        source: "aion",
      })),
    };
  }

  const localSuggestions = products.map((product) => {
    const suggestion = calculateSuggestedPublicPrice(
      product,
      marketShift,
      recentCostIncreaseByProduct.get(product.id) ?? 0,
      trigger,
    );
    const priceHistory = priceHistoryByProduct.get(product.id) ?? [];
    if (priceHistory.length > 0) {
      const ordered = [...priceHistory].sort((a, b) => a - b);
      const median = ordered[Math.floor(ordered.length / 2)] ?? product.price;
      const min = ordered[0] ?? product.price;
      const max = ordered[ordered.length - 1] ?? product.price;

      if (product.price < median * 0.85) {
        suggestion.reason += ` Precio actual por debajo del historico reciente (mediana ${roundMoney(median)}).`;
      } else if (product.price > median * 1.2) {
        suggestion.reason += ` Precio actual por encima del historico reciente (mediana ${roundMoney(median)}).`;
      } else if (max - min > 0) {
        suggestion.reason += ` Banda historica reciente: ${roundMoney(min)}-${roundMoney(max)}.`;
      }
    }

    return suggestion;
  });

  return {
    source: "local",
    suggestions: localSuggestions,
  };
}

function buildDefaultLotCode(productSku: string, suffix = "LOT"): string {
  const seed = normalizeSkuInput(`${productSku}-${suffix}`).slice(0, 50).replace(/-+$/g, "");
  return seed.length >= 3 ? seed : `LOT-${Date.now()}`;
}

function expirySortValue(expiresAt: Date | null | undefined): number {
  return expiresAt ? new Date(expiresAt).getTime() : Number.MAX_SAFE_INTEGER;
}

function computeCashDelta(type: CashMovementTypeCode, amount: number): number {
  if (type === CashMovementType.EXPENSE) {
    return -Math.abs(amount);
  }
  if (type === CashMovementType.SALE || type === CashMovementType.INCOME || type === CashMovementType.ADJUSTMENT) {
    return Math.abs(amount);
  }
  return 0;
}

async function writeAuditLog(
  tx: PrismaTx,
  entry: {
    entityType: string;
    entityId?: number | null;
    action: string;
    message: string;
    payload?: Prisma.InputJsonValue;
  },
) {
  await tx.auditLog.create({
    data: {
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      action: entry.action,
      message: entry.message,
      payload: entry.payload,
    },
  });
}

async function findOrCreatePatient(
  tx: PrismaTx,
  payload: {
    fullName: string;
    phone?: string | null;
    notes?: string | null;
  },
) {
  const fullName = payload.fullName.trim();
  const normalizedName = normalizeSearchValue(fullName);
  const normalizedPhone = normalizeSearchValue(payload.phone ?? "");

  const candidates = await tx.patient.findMany({
    where: {
      fullName: {
        contains: fullName,
      },
    },
    take: 20,
    orderBy: { createdAt: "asc" },
  });

  const existing = candidates.find((patient) => {
    const sameName = normalizeSearchValue(patient.fullName) === normalizedName;
    if (!sameName) {
      return false;
    }

    if (!normalizedPhone) {
      return true;
    }

    return normalizeSearchValue(patient.phone ?? "") === normalizedPhone;
  });

  if (existing) {
    if (!existing.phone && payload.phone) {
      return tx.patient.update({
        where: { id: existing.id },
        data: { phone: payload.phone },
      });
    }

    return existing;
  }

  return tx.patient.create({
    data: {
      fullName,
      phone: payload.phone?.trim() || null,
      notes: payload.notes?.trim() || null,
    },
  });
}

async function ensureFallbackLotForProduct(
  tx: PrismaTx,
  product: {
    id: number;
    sku: string;
    kind: ProductKindCode;
    stock: number;
    cost: number;
    expiresAt: Date | null;
  },
) {
  if (product.kind === serviceKind || product.stock <= 0) {
    return;
  }

  const existingLots = await tx.inventoryLot.count({
    where: {
      productId: product.id,
      quantity: { gt: 0 },
    },
  });

  if (existingLots > 0) {
    return;
  }

  await tx.inventoryLot.create({
    data: {
      productId: product.id,
      lotCode: buildDefaultLotCode(product.sku, `LEGACY-${product.id}`),
      quantity: product.stock,
      cost: product.cost,
      expiresAt: product.kind === ProductKind.MEDICATION ? product.expiresAt : null,
    },
  });
}

async function syncProductFromLots(tx: PrismaTx, productId: number) {
  const product = await tx.product.findUnique({
    where: { id: productId },
    include: {
      lots: {
        where: { quantity: { gt: 0 } },
      },
    },
  });

  if (!product || product.kind === serviceKind) {
    return product;
  }

  const sortedLots = [...product.lots].sort(
    (left, right) => expirySortValue(left.expiresAt) - expirySortValue(right.expiresAt),
  );
  const stock = sortedLots.reduce((sum, lot) => sum + lot.quantity, 0);
  const nextExpiry =
    product.kind === ProductKind.MEDICATION
      ? sortedLots.find((lot) => lot.expiresAt)?.expiresAt ?? null
      : null;

  return tx.product.update({
    where: { id: productId },
    data: {
      stock,
      expiresAt: nextExpiry,
    },
  });
}

async function reconcileInventorySnapshot() {
  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      kind: { in: inventoryKinds },
      unit: { not: "servicio" },
    },
    select: {
      id: true,
      sku: true,
      kind: true,
      stock: true,
      cost: true,
      expiresAt: true,
    },
  });

  for (const product of products) {
    await prisma.$transaction(async (tx) => {
      await ensureFallbackLotForProduct(tx, product);
      await syncProductFromLots(tx, product.id);
    });
  }
}

async function increaseInventoryLot(
  tx: PrismaTx,
  product: {
    id: number;
    sku: string;
    kind: ProductKindCode;
    cost: number;
    expiresAt: Date | null;
  },
  payload: {
    quantity: number;
    lotCode?: string | null;
    expiresAt?: Date | null;
    cost?: number | null;
  },
) {
  if (payload.quantity <= 0 || product.kind === serviceKind) {
    return null;
  }

  const lotCode = payload.lotCode?.trim()
    ? normalizeSkuInput(payload.lotCode)
    : buildDefaultLotCode(product.sku, new Date().toISOString().slice(0, 10));
  const lot = await tx.inventoryLot.findUnique({
    where: {
      productId_lotCode: {
        productId: product.id,
        lotCode,
      },
    },
  });

  if (lot) {
    await tx.inventoryLot.update({
      where: { id: lot.id },
      data: {
        quantity: { increment: payload.quantity },
        cost: payload.cost ?? lot.cost,
        expiresAt:
          product.kind === ProductKind.MEDICATION
            ? payload.expiresAt ?? lot.expiresAt ?? product.expiresAt
            : null,
      },
    });
  } else {
    await tx.inventoryLot.create({
      data: {
        productId: product.id,
        lotCode,
        quantity: payload.quantity,
        cost: payload.cost ?? product.cost,
        expiresAt:
          product.kind === ProductKind.MEDICATION
            ? payload.expiresAt ?? product.expiresAt
            : null,
      },
    });
  }

  await syncProductFromLots(tx, product.id);
  return lotCode;
}

async function consumeInventoryLots(
  tx: PrismaTx,
  product: {
    id: number;
    sku: string;
    kind: ProductKindCode;
    stock: number;
    cost: number;
    expiresAt: Date | null;
  },
  quantity: number,
) {
  if (quantity <= 0 || product.kind === serviceKind) {
    return [];
  }

  await ensureFallbackLotForProduct(tx, product);
  const lots = await tx.inventoryLot.findMany({
    where: {
      productId: product.id,
      quantity: { gt: 0 },
    },
  });

  const sortedLots = [...lots].sort(
    (left, right) => expirySortValue(left.expiresAt) - expirySortValue(right.expiresAt),
  );

  let remaining = quantity;
  const touchedLotCodes: string[] = [];

  for (const lot of sortedLots) {
    if (remaining <= 0) {
      break;
    }
    const take = Math.min(remaining, lot.quantity);
    if (take <= 0) {
      continue;
    }

    await tx.inventoryLot.update({
      where: { id: lot.id },
      data: {
        quantity: {
          decrement: take,
        },
      },
    });
    touchedLotCodes.push(lot.lotCode);
    remaining -= take;
  }

  if (remaining > 0) {
    throw new ApiError(400, `No hay lotes suficientes para ${product.sku}.`);
  }

  await syncProductFromLots(tx, product.id);
  return uniqueTokens(touchedLotCodes);
}

async function getOpenCashSession(db: PrismaDb) {
  return db.cashSession.findFirst({
    where: { status: CashSessionStatus.OPEN },
    include: {
      movements: {
        orderBy: { createdAt: "desc" },
        take: 20,
      },
    },
    orderBy: { openedAt: "desc" },
  });
}

async function appendCashMovement(
  tx: PrismaTx,
  sessionId: number,
  payload: {
    type: CashMovementTypeCode;
    amount: number;
    reason: string;
    saleId?: number;
  },
) {
  const delta = computeCashDelta(payload.type, payload.amount);
  const movement = await tx.cashMovement.create({
    data: {
      sessionId,
      saleId: payload.saleId,
      type: payload.type,
      amount: roundMoney(payload.amount),
      reason: payload.reason,
    },
  });

  if (delta !== 0) {
    await tx.cashSession.update({
      where: { id: sessionId },
      data: {
        expectedAmount: {
          increment: roundMoney(delta),
        },
      },
    });
  }

  return movement;
}

async function buildCashOverview() {
  const [openSession, lastClosedSession] = await Promise.all([
    prisma.cashSession.findFirst({
      where: { status: CashSessionStatus.OPEN },
      include: {
        movements: {
          orderBy: { createdAt: "desc" },
          take: 20,
        },
      },
      orderBy: { openedAt: "desc" },
    }),
    prisma.cashSession.findFirst({
      where: { status: CashSessionStatus.CLOSED },
      include: {
        movements: {
          orderBy: { createdAt: "desc" },
          take: 10,
        },
      },
      orderBy: { closedAt: "desc" },
    }),
  ]);

  return {
    openSession,
    lastClosedSession,
  };
}

async function buildPendingFollowUps(take = 20) {
  const followUps = await prisma.consultation.findMany({
    where: {
      followUpAt: { not: null },
      followUpStatus: FollowUpStatus.PENDING,
    },
    include: {
      patient: true,
      appointment: true,
    },
    orderBy: { followUpAt: "asc" },
    take,
  });

  return followUps.map((item) => ({
    id: item.id,
    patientId: item.patientId,
    patientName: item.patient.fullName,
    patientPhone: item.patient.phone,
    serviceType: item.serviceType,
    followUpAt: item.followUpAt?.toISOString() ?? null,
    status: item.followUpStatus,
    summary: item.summary,
    appointmentId: item.appointmentId,
  }));
}

function resolveSqliteDatabaseFile(databaseUrl: string): string {
  if (!databaseUrl.startsWith("file:")) {
    throw new ApiError(
      500,
      "La exportacion automatica solo esta habilitada para SQLite.",
    );
  }

  const filePath = databaseUrl.replace("file:", "").replace(/^\.\//, "");
  if (path.isAbsolute(filePath)) {
    return filePath;
  }

  return path.resolve(process.cwd(), "prisma", filePath);
}

function resolveBackupDirectory(): string {
  if (!config.backupDirectory) {
    return path.resolve(process.cwd(), "backups");
  }

  if (path.isAbsolute(config.backupDirectory)) {
    return config.backupDirectory;
  }

  return path.resolve(process.cwd(), config.backupDirectory);
}

async function cleanupOldBackupFiles(backupDir: string): Promise<void> {
  const maxAgeMs = config.backupRetentionDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const entries = await fs.readdir(backupDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const isBackupFile =
      entry.name.endsWith(".db") &&
      (entry.name.startsWith("farmacia-backup-") ||
        entry.name.startsWith("farmacia-auto-backup-"));

    if (!isBackupFile) {
      continue;
    }

    const backupPath = path.join(backupDir, entry.name);
    try {
      const stats = await fs.stat(backupPath);
      if (now - stats.mtimeMs > maxAgeMs) {
        await fs.rm(backupPath, { force: true });
      }
    } catch (error) {
      console.warn("No se pudo evaluar respaldo antiguo:", backupPath, error);
    }
  }
}

async function createDatabaseBackup(kind: "manual" | "scheduled"): Promise<{
  fileName: string;
  destination: string;
}> {
  const sourceDbFile = resolveSqliteDatabaseFile(config.databaseUrl);
  await fs.access(sourceDbFile);

  const backupDir = resolveBackupDirectory();
  await fs.mkdir(backupDir, { recursive: true });

  const prefix = kind === "scheduled" ? "farmacia-auto-backup" : "farmacia-backup";
  const fileName = `${prefix}-${new Date().toISOString().replace(/[:.]/g, "-")}.db`;
  const destination = path.join(backupDir, fileName);

  await fs.copyFile(sourceDbFile, destination);
  await cleanupOldBackupFiles(backupDir);

  return {
    fileName,
    destination,
  };
}

let backupTimer: NodeJS.Timeout | null = null;

function startAutomaticBackups() {
  if (!config.backupEnabled) {
    console.log("Respaldo automatico deshabilitado por configuracion.");
    return;
  }

  const backupDir = resolveBackupDirectory();
  const intervalMs = config.backupIntervalMinutes * 60_000;

  console.log(
    `Respaldo automatico habilitado cada ${config.backupIntervalMinutes} minutos en ${backupDir}.`,
  );

  const runScheduledBackup = async () => {
    try {
      const backup = await createDatabaseBackup("scheduled");
      console.log(`Respaldo automatico generado: ${backup.fileName}`);
    } catch (error) {
      console.error("Fallo el respaldo automatico de base de datos:", error);
    }
  };

  void runScheduledBackup();

  backupTimer = setInterval(() => {
    void runScheduledBackup();
  }, intervalMs);
  backupTimer.unref();
}

async function ensureSchemaCompatibility() {
  const baseSchemaStatements = [
    `CREATE TABLE IF NOT EXISTS "Product" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "sku" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "commercialName" TEXT,
      "kind" TEXT NOT NULL DEFAULT 'MEDICATION',
      "description" TEXT,
      "category" TEXT,
      "unit" TEXT NOT NULL DEFAULT 'unidad',
      "cost" REAL NOT NULL DEFAULT 0,
      "price" REAL NOT NULL,
      "stock" INTEGER NOT NULL DEFAULT 0,
      "minStock" INTEGER NOT NULL DEFAULT 0,
      "expiresAt" DATETIME,
      "isActive" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    'CREATE UNIQUE INDEX IF NOT EXISTS "Product_sku_key" ON "Product"("sku")',
    `CREATE TABLE IF NOT EXISTS "Sale" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "customerName" TEXT,
      "notes" TEXT,
      "subtotal" REAL NOT NULL,
      "discount" REAL NOT NULL DEFAULT 0,
      "total" REAL NOT NULL,
      "amountPaid" REAL,
      "changeGiven" REAL
    )`,
    `CREATE TABLE IF NOT EXISTS "Patient" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "fullName" TEXT NOT NULL,
      "phone" TEXT,
      "notes" TEXT,
      "lastVisitAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    'CREATE INDEX IF NOT EXISTS "Patient_fullName_idx" ON "Patient"("fullName")',
    `CREATE TABLE IF NOT EXISTS "Appointment" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "patientId" INTEGER,
      "patientName" TEXT NOT NULL,
      "patientPhone" TEXT,
      "serviceType" TEXT NOT NULL,
      "notes" TEXT,
      "appointmentAt" DATETIME NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    'CREATE INDEX IF NOT EXISTS "Appointment_appointmentAt_status_idx" ON "Appointment"("appointmentAt","status")',
    'CREATE INDEX IF NOT EXISTS "Appointment_patientId_idx" ON "Appointment"("patientId")',
    `CREATE TABLE IF NOT EXISTS "SaleItem" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "saleId" INTEGER NOT NULL,
      "productId" INTEGER NOT NULL,
      "quantity" INTEGER NOT NULL,
      "unitPrice" REAL NOT NULL,
      "unitCost" REAL NOT NULL DEFAULT 0,
      "lineTotal" REAL NOT NULL,
      "productSku" TEXT,
      "productName" TEXT,
      "productCommercialName" TEXT,
      "productKind" TEXT,
      "productCategory" TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS "Consultation" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "patientId" INTEGER NOT NULL,
      "appointmentId" INTEGER,
      "serviceProductId" INTEGER,
      "serviceType" TEXT NOT NULL,
      "summary" TEXT,
      "diagnosis" TEXT,
      "treatment" TEXT,
      "observations" TEXT,
      "followUpAt" DATETIME,
      "followUpStatus" TEXT NOT NULL DEFAULT 'NONE',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    'CREATE UNIQUE INDEX IF NOT EXISTS "Consultation_appointmentId_key" ON "Consultation"("appointmentId")',
    'CREATE INDEX IF NOT EXISTS "Consultation_patientId_createdAt_idx" ON "Consultation"("patientId","createdAt")',
    'CREATE INDEX IF NOT EXISTS "Consultation_followUpAt_followUpStatus_idx" ON "Consultation"("followUpAt","followUpStatus")',
    `CREATE TABLE IF NOT EXISTS "InventoryMovement" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "productId" INTEGER NOT NULL,
      "change" INTEGER NOT NULL,
      "reason" TEXT NOT NULL,
      "lotCode" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS "ProductCostEvent" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "productId" INTEGER NOT NULL,
      "previousCost" REAL NOT NULL,
      "newCost" REAL NOT NULL,
      "changePct" REAL NOT NULL,
      "reason" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS "ProductPriceEvent" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "productId" INTEGER NOT NULL,
      "previousPrice" REAL NOT NULL,
      "newPrice" REAL NOT NULL,
      "changePct" REAL NOT NULL,
      "reason" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS "InventoryLot" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "productId" INTEGER NOT NULL,
      "lotCode" TEXT NOT NULL,
      "expiresAt" DATETIME,
      "quantity" INTEGER NOT NULL DEFAULT 0,
      "cost" REAL NOT NULL DEFAULT 0,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    'CREATE UNIQUE INDEX IF NOT EXISTS "InventoryLot_productId_lotCode_key" ON "InventoryLot"("productId","lotCode")',
    'CREATE INDEX IF NOT EXISTS "InventoryLot_productId_expiresAt_idx" ON "InventoryLot"("productId","expiresAt")',
    `CREATE TABLE IF NOT EXISTS "CashSession" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "status" TEXT NOT NULL DEFAULT 'OPEN',
      "openingAmount" REAL NOT NULL DEFAULT 0,
      "expectedAmount" REAL NOT NULL DEFAULT 0,
      "countedAmount" REAL,
      "difference" REAL,
      "notes" TEXT,
      "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "closedAt" DATETIME
    )`,
    'CREATE INDEX IF NOT EXISTS "CashSession_status_openedAt_idx" ON "CashSession"("status","openedAt")',
    `CREATE TABLE IF NOT EXISTS "CashMovement" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "sessionId" INTEGER NOT NULL,
      "saleId" INTEGER,
      "type" TEXT NOT NULL,
      "amount" REAL NOT NULL,
      "reason" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    'CREATE INDEX IF NOT EXISTS "CashMovement_sessionId_createdAt_idx" ON "CashMovement"("sessionId","createdAt")',
    `CREATE TABLE IF NOT EXISTS "AuditLog" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "entityType" TEXT NOT NULL,
      "entityId" INTEGER,
      "action" TEXT NOT NULL,
      "message" TEXT NOT NULL,
      "payload" JSONB,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    'CREATE INDEX IF NOT EXISTS "AuditLog_entityType_createdAt_idx" ON "AuditLog"("entityType","createdAt")',
    `CREATE TABLE IF NOT EXISTS "AiSuggestion" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "suggestionType" TEXT NOT NULL,
      "payload" JSONB NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  ];

  const compatibilityStatements = [
    'ALTER TABLE "Product" ADD COLUMN "commercialName" TEXT',
    'ALTER TABLE "Sale" ADD COLUMN "amountPaid" REAL',
    'ALTER TABLE "Sale" ADD COLUMN "changeGiven" REAL',
    'ALTER TABLE "SaleItem" ADD COLUMN "unitCost" REAL NOT NULL DEFAULT 0',
    'ALTER TABLE "SaleItem" ADD COLUMN "productSku" TEXT',
    'ALTER TABLE "SaleItem" ADD COLUMN "productName" TEXT',
    'ALTER TABLE "SaleItem" ADD COLUMN "productCommercialName" TEXT',
    'ALTER TABLE "SaleItem" ADD COLUMN "productKind" TEXT',
    'ALTER TABLE "SaleItem" ADD COLUMN "productCategory" TEXT',
    'ALTER TABLE "Appointment" ADD COLUMN "patientId" INTEGER',
    'ALTER TABLE "Appointment" ADD COLUMN "patientPhone" TEXT',
    'ALTER TABLE "InventoryMovement" ADD COLUMN "lotCode" TEXT',
    `CREATE TABLE IF NOT EXISTS "Patient" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "fullName" TEXT NOT NULL,
      "phone" TEXT,
      "notes" TEXT,
      "lastVisitAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    'CREATE INDEX IF NOT EXISTS "Patient_fullName_idx" ON "Patient"("fullName")',
    `CREATE TABLE IF NOT EXISTS "Consultation" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "patientId" INTEGER NOT NULL,
      "appointmentId" INTEGER,
      "serviceProductId" INTEGER,
      "serviceType" TEXT NOT NULL,
      "summary" TEXT,
      "diagnosis" TEXT,
      "treatment" TEXT,
      "observations" TEXT,
      "followUpAt" DATETIME,
      "followUpStatus" TEXT NOT NULL DEFAULT 'NONE',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    'CREATE UNIQUE INDEX IF NOT EXISTS "Consultation_appointmentId_key" ON "Consultation"("appointmentId")',
    'CREATE INDEX IF NOT EXISTS "Consultation_patientId_createdAt_idx" ON "Consultation"("patientId","createdAt")',
    'CREATE INDEX IF NOT EXISTS "Consultation_followUpAt_followUpStatus_idx" ON "Consultation"("followUpAt","followUpStatus")',
    `CREATE TABLE IF NOT EXISTS "ProductPriceEvent" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "productId" INTEGER NOT NULL,
      "previousPrice" REAL NOT NULL,
      "newPrice" REAL NOT NULL,
      "changePct" REAL NOT NULL,
      "reason" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS "InventoryLot" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "productId" INTEGER NOT NULL,
      "lotCode" TEXT NOT NULL,
      "expiresAt" DATETIME,
      "quantity" INTEGER NOT NULL DEFAULT 0,
      "cost" REAL NOT NULL DEFAULT 0,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    'CREATE UNIQUE INDEX IF NOT EXISTS "InventoryLot_productId_lotCode_key" ON "InventoryLot"("productId","lotCode")',
    'CREATE INDEX IF NOT EXISTS "InventoryLot_productId_expiresAt_idx" ON "InventoryLot"("productId","expiresAt")',
    `CREATE TABLE IF NOT EXISTS "CashSession" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "status" TEXT NOT NULL DEFAULT 'OPEN',
      "openingAmount" REAL NOT NULL DEFAULT 0,
      "expectedAmount" REAL NOT NULL DEFAULT 0,
      "countedAmount" REAL,
      "difference" REAL,
      "notes" TEXT,
      "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "closedAt" DATETIME
    )`,
    'CREATE INDEX IF NOT EXISTS "CashSession_status_openedAt_idx" ON "CashSession"("status","openedAt")',
    `CREATE TABLE IF NOT EXISTS "CashMovement" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "sessionId" INTEGER NOT NULL,
      "saleId" INTEGER,
      "type" TEXT NOT NULL,
      "amount" REAL NOT NULL,
      "reason" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    'CREATE INDEX IF NOT EXISTS "CashMovement_sessionId_createdAt_idx" ON "CashMovement"("sessionId","createdAt")',
    `CREATE TABLE IF NOT EXISTS "AuditLog" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "entityType" TEXT NOT NULL,
      "entityId" INTEGER,
      "action" TEXT NOT NULL,
      "message" TEXT NOT NULL,
      "payload" JSONB,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    'CREATE INDEX IF NOT EXISTS "AuditLog_entityType_createdAt_idx" ON "AuditLog"("entityType","createdAt")',
    'CREATE INDEX IF NOT EXISTS "Appointment_appointmentAt_status_idx" ON "Appointment"("appointmentAt","status")',
    'CREATE INDEX IF NOT EXISTS "Appointment_patientId_idx" ON "Appointment"("patientId")',
  ];

  for (const statement of baseSchemaStatements) {
    await prisma.$executeRawUnsafe(statement);
  }

  for (const statement of compatibilityStatements) {
    try {
      await prisma.$executeRawUnsafe(statement);
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
      if (
        message.includes("duplicate column name") ||
        message.includes("already exists")
      ) {
        continue;
      }
      throw error;
    }
  }

  const legacyProducts = await prisma.product.findMany({
    where: {
      kind: { in: inventoryKinds },
      unit: { not: "servicio" },
      stock: { gt: 0 },
    },
    select: {
      id: true,
      sku: true,
      kind: true,
      stock: true,
      cost: true,
      expiresAt: true,
    },
  });

  for (const product of legacyProducts) {
    await prisma.$transaction(async (tx) => {
      await ensureFallbackLotForProduct(tx, product);
      await syncProductFromLots(tx, product.id);
    });
  }

  const legacyAppointments = await prisma.appointment.findMany({
    where: { patientId: null },
    select: {
      id: true,
      patientName: true,
      patientPhone: true,
      notes: true,
    },
  });

  for (const appointment of legacyAppointments) {
    await prisma.$transaction(async (tx) => {
      const patient = await findOrCreatePatient(tx, {
        fullName: appointment.patientName,
        phone: appointment.patientPhone,
        notes: appointment.notes,
      });

      await tx.appointment.update({
        where: { id: appointment.id },
        data: { patientId: patient.id },
      });
    });
  }

  const productsToCategorize = await prisma.product.findMany({
    select: {
      id: true,
      name: true,
      kind: true,
      category: true,
    },
  });

  for (const product of productsToCategorize) {
    const currentCategory = product.category?.trim() ?? "";
    let nextCategory: string | null = null;

    if (
      product.kind === ProductKind.MEDICATION &&
      genericMedicationCategories.has(currentCategory)
    ) {
      nextCategory = inferProductCategory(product.name, product.kind);
    } else if (
      product.kind === ProductKind.MEDICAL_SUPPLY &&
      (!currentCategory || currentCategory === "Insumo medico")
    ) {
      nextCategory = defaultCategoryForKind(product.kind);
    } else if (
      product.kind === ProductKind.MEDICAL_SERVICE &&
      !currentCategory
    ) {
      nextCategory = defaultCategoryForKind(product.kind);
    }

    if (nextCategory && nextCategory !== currentCategory) {
      await prisma.product.update({
        where: { id: product.id },
        data: { category: nextCategory },
      });
    }
  }
}

async function buildSalesReport(from: Date, to: Date) {
  const sales = await prisma.sale.findMany({
    where: {
      createdAt: {
        gte: from,
        lte: to,
      },
    },
    include: {
      items: {
        include: {
          product: true,
        },
      },
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  const productsForPeriod = await prisma.product.findMany({
    where: {
      isActive: true,
      kind: { in: inventoryKinds },
      unit: { not: "servicio" },
    },
    select: {
      id: true,
      sku: true,
      name: true,
      commercialName: true,
      cost: true,
    },
  });
  const saleIds = sales.map((sale) => sale.id);
  const saleCashMovements = saleIds.length > 0
    ? await prisma.cashMovement.findMany({
        where: {
          type: CashMovementType.SALE,
          saleId: { in: saleIds },
        },
        select: {
          saleId: true,
          sessionId: true,
          amount: true,
        },
      })
    : [];
  const cashMovementBySaleId = new Map<
    number,
    {
      amount: number;
      sessionIds: Set<number>;
    }
  >();
  for (const movement of saleCashMovements) {
    if (!movement.saleId) {
      continue;
    }

    const current = cashMovementBySaleId.get(movement.saleId) ?? {
      amount: 0,
      sessionIds: new Set<number>(),
    };
    current.amount += movement.amount;
    current.sessionIds.add(movement.sessionId);
    cashMovementBySaleId.set(movement.saleId, current);
  }

  const totalSales = sales.length;
  const grossRevenue = roundMoney(sales.reduce((sum, sale) => sum + sale.subtotal, 0));
  const totalDiscount = roundMoney(sales.reduce((sum, sale) => sum + sale.discount, 0));
  const totalRevenue = roundMoney(sales.reduce((sum, sale) => sum + sale.total, 0));
  const averageTicket = totalSales > 0 ? roundMoney(totalRevenue / totalSales) : 0;
  const discountRatePct = grossRevenue > 0
    ? roundPercent(totalDiscount / grossRevenue)
    : 0;

  const productAccumulator = new Map<
    number,
    {
      productId: number;
      sku: string;
      productName: string;
      productCommercialName: string | null;
      quantity: number;
      revenue: number;
      estimatedCost: number;
    }
  >();

  let totalItemsSold = 0;
  let estimatedTotalCost = 0;

  for (const sale of sales) {
    for (const item of sale.items) {
      const unitCost = item.unitCost > 0 ? item.unitCost : item.product.cost;
      const lineCost = item.quantity * unitCost;
      const productSku = item.productSku ?? item.product.sku;
      const productName = item.productName ?? item.product.name;
      const productCommercialName =
        item.productCommercialName ?? item.product.commercialName;

      const current = productAccumulator.get(item.productId) ?? {
        productId: item.productId,
        sku: productSku,
        productName,
        productCommercialName,
        quantity: 0,
        revenue: 0,
        estimatedCost: 0,
      };

      current.quantity += item.quantity;
      current.revenue += item.lineTotal;
      current.estimatedCost += lineCost;
      productAccumulator.set(item.productId, current);

      totalItemsSold += item.quantity;
      estimatedTotalCost += lineCost;
    }
  }

  estimatedTotalCost = roundMoney(estimatedTotalCost);
  const estimatedGrossProfit = roundMoney(totalRevenue - estimatedTotalCost);
  const estimatedMarginPct = totalRevenue > 0
    ? roundPercent(estimatedGrossProfit / totalRevenue)
    : 0;

  const dailyAccumulator = new Map<string, { date: string; totalRevenue: number; totalSales: number }>();
  for (const sale of sales) {
    const dateKey = sale.createdAt.toISOString().slice(0, 10);
    const bucket = dailyAccumulator.get(dateKey) ?? {
      date: dateKey,
      totalRevenue: 0,
      totalSales: 0,
    };
    bucket.totalRevenue += sale.total;
    bucket.totalSales += 1;
    dailyAccumulator.set(dateKey, bucket);
  }
  const dailySales = [...dailyAccumulator.values()]
    .map((item) => ({
      date: item.date,
      totalRevenue: roundMoney(item.totalRevenue),
      totalSales: item.totalSales,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const salesSummary = sales
    .map((sale) => {
      const itemCount = sale.items.reduce((sum, item) => sum + item.quantity, 0);
      const cashMovement = cashMovementBySaleId.get(sale.id);
      return {
        saleId: sale.id,
        createdAt: sale.createdAt.toISOString(),
        customerName: sale.customerName,
        subtotal: roundMoney(sale.subtotal),
        discount: roundMoney(sale.discount),
        total: roundMoney(sale.total),
        amountPaid: roundMoney(sale.amountPaid ?? sale.total),
        changeGiven: roundMoney(sale.changeGiven ?? 0),
        cashLinked: Boolean(cashMovement),
        cashSessionId: cashMovement ? [...cashMovement.sessionIds][0] ?? null : null,
        itemCount,
      };
    })
    .sort((a, b) => b.saleId - a.saleId)
    .slice(0, 40);

  const unlinkedSales = sales.filter((sale) => !cashMovementBySaleId.has(sale.id));
  const linkedSalesTotal = roundMoney(
    sales
      .filter((sale) => cashMovementBySaleId.has(sale.id))
      .reduce((sum, sale) => sum + sale.total, 0),
  );
  const unlinkedSalesTotal = roundMoney(
    unlinkedSales.reduce((sum, sale) => sum + sale.total, 0),
  );
  const cashMovementTotal = roundMoney(
    [...cashMovementBySaleId.values()].reduce((sum, movement) => sum + movement.amount, 0),
  );
  const cashReconciliation = {
    linkedSales: totalSales - unlinkedSales.length,
    linkedSalesTotal,
    unlinkedSales: unlinkedSales.length,
    unlinkedSalesTotal,
    cashMovementTotal,
    hasDifferences:
      unlinkedSales.length > 0 ||
      Math.abs(cashMovementTotal - linkedSalesTotal) > 0.01,
  };

  const performanceRows = [...productAccumulator.values()].map((entry) => {
    const averageUnitPrice = entry.quantity > 0 ? entry.revenue / entry.quantity : 0;
    const estimatedProfit = entry.revenue - entry.estimatedCost;
    const marginPct = entry.revenue > 0 ? estimatedProfit / entry.revenue : 0;

    return {
      productId: entry.productId,
      sku: entry.sku,
      productName: entry.productName,
      productCommercialName: entry.productCommercialName,
      quantity: entry.quantity,
      revenue: roundMoney(entry.revenue),
      estimatedCost: roundMoney(entry.estimatedCost),
      estimatedProfit: roundMoney(estimatedProfit),
      averageUnitPrice: roundMoney(averageUnitPrice),
      marginPct: roundPercent(marginPct),
    };
  });

  const topProducts = [...performanceRows]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10)
    .map((entry) => ({
      productId: entry.productId,
      productName: entry.productName,
      productCommercialName: entry.productCommercialName,
      quantity: entry.quantity,
      revenue: entry.revenue,
    }));

  const bestSellingProducts = [...performanceRows]
    .sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue)
    .slice(0, 10);

  const leastSellingProducts = [...performanceRows]
    .sort((a, b) => a.quantity - b.quantity || a.revenue - b.revenue)
    .slice(0, 10);

  const soldProductIds = new Set(performanceRows.map((item) => item.productId));
  const unsoldProducts = productsForPeriod
    .filter((product) => !soldProductIds.has(product.id))
    .map((product) => ({
      productId: product.id,
      sku: product.sku,
      productName: product.name,
      productCommercialName: product.commercialName,
      quantity: 0,
      revenue: 0,
      estimatedCost: 0,
      estimatedProfit: 0,
      averageUnitPrice: 0,
      marginPct: 0,
    }))
    .slice(0, 20);

  const averageItemsPerSale = totalSales > 0
    ? Number((totalItemsSold / totalSales).toFixed(2))
    : 0;

  const anomalies: Array<{
    type: "SPIKE" | "DROP" | "DISCOUNT" | "LOW_ACTIVITY";
    message: string;
    severity: OperationalAlertLevel;
  }> = [];
  if (dailySales.length >= 4) {
    const lastDay = dailySales[dailySales.length - 1];
    const baseline = dailySales.slice(0, -1);
    const baselineRevenue =
      baseline.reduce((sum, item) => sum + item.totalRevenue, 0) / Math.max(1, baseline.length);
    const baselineTickets =
      baseline.reduce((sum, item) => sum + item.totalSales, 0) / Math.max(1, baseline.length);

    if (baselineRevenue > 0 && lastDay.totalRevenue >= baselineRevenue * 1.65) {
      anomalies.push({
        type: "SPIKE",
        severity: "warning",
        message:
          `Ventas de ${lastDay.date} por ${roundMoney(lastDay.totalRevenue)}; ` +
          `superan el promedio reciente de ${roundMoney(baselineRevenue)}.`,
      });
    }

    if (baselineRevenue > 0 && lastDay.totalRevenue <= baselineRevenue * 0.5) {
      anomalies.push({
        type: "DROP",
        severity: "critical",
        message:
          `Ventas de ${lastDay.date} por ${roundMoney(lastDay.totalRevenue)}; ` +
          `quedaron por debajo del promedio reciente de ${roundMoney(baselineRevenue)}.`,
      });
    }

    if (baselineTickets > 0 && lastDay.totalSales <= Math.max(1, baselineTickets * 0.6)) {
      anomalies.push({
        type: "LOW_ACTIVITY",
        severity: "warning",
        message:
          `Solo se registraron ${lastDay.totalSales} tickets el ${lastDay.date}; ` +
          `promedio reciente ${baselineTickets.toFixed(1)}.`,
      });
    }
  }

  if (grossRevenue > 0 && totalDiscount / grossRevenue >= 0.18) {
    anomalies.push({
      type: "DISCOUNT",
      severity: "warning",
      message:
        `El descuento acumulado representa ${roundPercent(totalDiscount / grossRevenue)}% del bruto; revisa promociones y autorizaciones.`,
    });
  }

  const topByRevenue = topProducts[0];
  const topByUnits = bestSellingProducts[0];
  const lowRotationLead = leastSellingProducts[0] ?? unsoldProducts[0] ?? null;
  const highlights = [
    `Ingreso neto del periodo: $${totalRevenue.toFixed(2)} en ${totalSales} ventas.`,
    topByRevenue
      ? `Mayor aportacion por ingreso: ${topByRevenue.productName} con $${topByRevenue.revenue.toFixed(2)}.`
      : "Sin productos destacados por ingreso en el periodo.",
    topByUnits
      ? `Mayor rotacion por unidades: ${topByUnits.productName} con ${topByUnits.quantity} unidades.`
      : "Sin rotacion destacada en el periodo.",
    lowRotationLead
      ? `Revision sugerida para baja rotacion: ${lowRotationLead.productName} (${lowRotationLead.quantity} unidades).`
      : "Sin rezagos de rotacion identificados.",
    anomalies[0]?.message ?? "Sin anomalias operativas basicas detectadas en ventas.",
  ];

  return {
    range: {
      from: from.toISOString(),
      to: to.toISOString(),
    },
    totalSales,
    totalItemsSold,
    averageItemsPerSale,
    grossRevenue,
    totalDiscount,
    discountRatePct,
    totalRevenue,
    estimatedTotalCost,
    estimatedGrossProfit,
    estimatedMarginPct,
    averageTicket,
    topProducts,
    bestSellingProducts,
    leastSellingProducts,
    unsoldProducts,
    dailySales,
    anomalies,
    highlights,
    productPerformance: performanceRows,
    salesSummary,
    cashReconciliation,
    cashLinkedSaleIds: [...cashMovementBySaleId.keys()],
    sales,
  };
}

async function listRecentInventoryMovements(take = 120) {
  const maxTake = Math.min(300, Math.max(1, take));

  const rows = await prisma.inventoryMovement.findMany({
    include: {
      product: {
        select: {
          id: true,
          sku: true,
          name: true,
          commercialName: true,
          stock: true,
          minStock: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: maxTake,
  });

  return rows.map((row) => ({
    movementId: row.id,
    productId: row.productId,
    productSku: row.product.sku,
    productName: row.product.name,
    productCommercialName: row.product.commercialName,
    change: row.change,
    reason: row.reason,
    lotCode: row.lotCode,
    createdAt: row.createdAt.toISOString(),
    currentStock: row.product.stock,
    minStock: row.product.minStock,
  }));
}

function calculateMinimumRestockTarget(stock: number, minStock: number): number {
  if (stock <= minStock) {
    return Math.max(minStock + 1, stock + 1, 1);
  }

  return minStock;
}

async function buildReorderReport(days: number, coverageDays: number) {
  const periodDays = Math.max(1, days);
  const desiredCoverageDays = Math.max(1, coverageDays);
  const from = daysAgo(periodDays);
  const to = new Date();
  await reconcileInventorySnapshot();

  const [products, sales] = await Promise.all([
    prisma.product.findMany({
      where: {
        isActive: true,
        kind: { in: inventoryKinds },
        unit: { not: "servicio" },
      },
      orderBy: { name: "asc" },
    }),
    prisma.sale.findMany({
      where: {
        createdAt: { gte: from, lte: to },
      },
      include: {
        items: {
          select: {
            productId: true,
            quantity: true,
          },
        },
      },
    }),
  ]);

  const soldByProduct = new Map<number, number>();
  for (const sale of sales) {
    for (const item of sale.items) {
      soldByProduct.set(
        item.productId,
        (soldByProduct.get(item.productId) ?? 0) + item.quantity,
      );
    }
  }

  const items = products
    .map((product) => {
      const soldInPeriod = soldByProduct.get(product.id) ?? 0;
      const dailyVelocity = soldInPeriod / periodDays;
      const minimumRestockTarget = calculateMinimumRestockTarget(
        product.stock,
        product.minStock,
      );
      const minimumOrder = Math.max(0, minimumRestockTarget - product.stock);
      const coverageDemand = Math.ceil(dailyVelocity * desiredCoverageDays);
      const safetyStock = Math.ceil(dailyVelocity * 3);
      const salesBasedTarget = Math.ceil(coverageDemand + safetyStock);
      const targetStock = Math.max(
        minimumRestockTarget,
        salesBasedTarget,
      );
      const suggestedOrder = Math.max(0, targetStock - product.stock);
      const rotationOrder = Math.max(0, suggestedOrder - minimumOrder);
      const salesBand =
        soldInPeriod === 0
          ? "LOW"
          : dailyVelocity >= 1
            ? "HIGH"
            : "MEDIUM";

      const reachedMinimumStock = product.stock <= product.minStock;
      if (!reachedMinimumStock) {
        return null;
      }

      let priority: "CRITICAL" | "HIGH" | "MEDIUM" = "MEDIUM";
      if (product.stock === 0 || suggestedOrder >= Math.max(5, Math.ceil(targetStock * 0.5))) {
        priority = "CRITICAL";
      } else if (product.stock <= product.minStock) {
        priority = "HIGH";
      }

      return {
        productId: product.id,
        sku: product.sku,
        name: product.name,
        commercialName: product.commercialName,
        kind: product.kind,
        category: product.category,
        stock: product.stock,
        minStock: product.minStock,
        targetStock,
        suggestedOrder,
        minimumOrder,
        rotationOrder,
        salesCoverageUnits: coverageDemand,
        soldInPeriod,
        dailyVelocity: Number(dailyVelocity.toFixed(2)),
        salesBand,
        purchaseReason:
          salesBand === "HIGH"
            ? `Alta rotacion: ${soldInPeriod} unidades vendidas en ${periodDays} dias.`
            : salesBand === "MEDIUM"
              ? `Rotacion moderada: ${soldInPeriod} unidades vendidas en ${periodDays} dias.`
              : "Sin ventas recientes: comprar solo lo necesario para superar el minimo.",
        priority,
        criticalityScore: roundMoney(
          suggestedOrder * 1.8 +
            dailyVelocity * 6 +
            (product.stock === 0 ? 12 : 0) +
            (product.kind === ProductKind.MEDICAL_SUPPLY ? 2 : 0),
        ),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => {
      const priorityWeight = { CRITICAL: 3, HIGH: 2, MEDIUM: 1 };
      if (priorityWeight[a.priority] !== priorityWeight[b.priority]) {
        return priorityWeight[b.priority] - priorityWeight[a.priority];
      }
      if (a.criticalityScore !== b.criticalityScore) {
        return b.criticalityScore - a.criticalityScore;
      }
      if (a.suggestedOrder !== b.suggestedOrder) {
        return b.suggestedOrder - a.suggestedOrder;
      }
      return b.dailyVelocity - a.dailyVelocity;
    });

  const totalUnitsSuggested = items.reduce((sum, item) => sum + item.suggestedOrder, 0);

  return {
    generatedAt: new Date().toISOString(),
    range: {
      from: from.toISOString(),
      to: to.toISOString(),
    },
    periodDays,
    coverageDays: desiredCoverageDays,
    totalItems: items.length,
    totalUnitsSuggested,
    highlights: [
      items[0]
        ? `Prioridad principal: ${items[0].name} con ${items[0].suggestedOrder} unidades sugeridas.`
        : "No hay productos en stock minimo para surtir.",
      items.find((item) => item.kind === ProductKind.MEDICAL_SUPPLY)
        ? `Material quirurgico prioritario: ${items.find((item) => item.kind === ProductKind.MEDICAL_SUPPLY)?.name}.`
        : "Sin material quirurgico critico por surtir.",
      `Cobertura objetivo: ${desiredCoverageDays} dias con base en ${periodDays} dias analizados.`,
    ],
    items,
  };
}

async function buildOperationalAlerts(limit = 40) {
  const now = new Date();
  const appointmentReminderLimit = new Date(
    now.getTime() + appointmentReminderMinutes * 60 * 1000,
  );
  const [products, upcomingAppointments, pendingFollowUps, cashOverview, salesReport] = await Promise.all([
    prisma.product.findMany({
      where: {
        isActive: true,
        kind: { in: inventoryKinds },
        unit: { not: "servicio" },
      },
      orderBy: { name: "asc" },
    }),
    prisma.appointment.findMany({
      where: {
        status: AppointmentStatus.SCHEDULED,
        appointmentAt: {
          gte: now,
          lte: appointmentReminderLimit,
        },
      },
      orderBy: { appointmentAt: "asc" },
      take: 10,
    }),
    buildPendingFollowUps(12),
    buildCashOverview(),
    buildSalesReport(daysAgo(14), new Date()),
  ]);

  const lowRotationIds = salesReport.totalSales > 0
    ? new Set([
        ...salesReport.leastSellingProducts.slice(0, 5).map((item) => item.productId),
        ...salesReport.unsoldProducts.slice(0, 5).map((item) => item.productId),
      ])
    : new Set<number>();

  const alerts: OperationalAlert[] = [];
  for (const product of products) {
    if (product.stock === 0) {
      alerts.push({
        id: `product-out-${product.id}`,
        type: "OUT_OF_STOCK",
        level: "critical",
        title: `${product.name} agotado`,
        message: `SKU ${product.sku} sin existencia disponible.`,
        module: "inventory",
        entityId: product.id,
        entityType: "product",
      });
      continue;
    }

    if (product.stock <= product.minStock) {
      alerts.push({
        id: `product-low-${product.id}`,
        type: "LOW_STOCK",
        level: product.stock <= Math.max(1, Math.floor(product.minStock / 2)) ? "critical" : "warning",
        title: `${product.name} bajo stock`,
        message: `Stock ${product.stock}/${product.minStock}.`,
        module: "inventory",
        entityId: product.id,
        entityType: "product",
      });
    }

    if (lowRotationIds.has(product.id) && product.stock > Math.max(5, product.minStock)) {
      alerts.push({
        id: `product-rotation-${product.id}`,
        type: "LOW_ROTATION",
        level: "info",
        title: `${product.name} con baja rotacion`,
        message: `Tiene stock ${product.stock} y poca salida reciente.`,
        module: "reports",
        entityId: product.id,
        entityType: "product",
      });
    }
  }

  const expiringLots = await prisma.inventoryLot.findMany({
    where: {
      quantity: { gt: 0 },
      expiresAt: { not: null, lte: new Date(Date.now() + expirationAlertDays * 24 * 60 * 60 * 1000) },
      product: {
        kind: ProductKind.MEDICATION,
        isActive: true,
      },
    },
    include: {
      product: true,
    },
    orderBy: { expiresAt: "asc" },
    take: 12,
  });

  for (const lot of expiringLots) {
    const daysToExpire = Math.ceil(
      ((lot.expiresAt?.getTime() ?? 0) - Date.now()) / (24 * 60 * 60 * 1000),
    );
    alerts.push({
      id: `lot-exp-${lot.id}`,
      type: "EXPIRING",
      level: daysToExpire < 0 ? "critical" : "warning",
      title: `${lot.product.name} proximo a caducar`,
      message: `Lote ${lot.lotCode} con ${lot.quantity} unidades; vence ${lot.expiresAt?.toISOString().slice(0, 10)}.`,
      module: "inventory",
      entityId: lot.productId,
      entityType: "product",
    });
  }

  for (const appointment of upcomingAppointments) {
    const minutesToAppointment = Math.max(
      0,
      Math.round((appointment.appointmentAt.getTime() - now.getTime()) / 60_000),
    );
    alerts.push({
      id: `appt-${appointment.id}`,
      type: "UPCOMING_APPOINTMENT",
      level: minutesToAppointment <= 15 ? "warning" : "info",
      title: `${appointment.patientName} tiene consulta proxima`,
      message:
        `${appointment.serviceType} en ${minutesToAppointment} min ` +
        `(${appointment.appointmentAt.toISOString()}).`,
      module: "appointments",
      entityId: appointment.id,
      entityType: "appointment",
    });
  }

  for (const followUp of pendingFollowUps) {
    alerts.push({
      id: `follow-up-${followUp.id}`,
      type: "FOLLOW_UP",
      level: "warning",
      title: `${followUp.patientName} con seguimiento pendiente`,
      message: `${followUp.serviceType} con seguimiento ${followUp.followUpAt?.slice(0, 10) ?? "pendiente"}.`,
      module: "appointments",
      entityId: followUp.id,
      entityType: "consultation",
    });
  }

  if (cashOverview.lastClosedSession && Math.abs(cashOverview.lastClosedSession.difference ?? 0) > 0.01) {
    alerts.push({
      id: `cash-${cashOverview.lastClosedSession.id}`,
      type: "CASH_MISMATCH",
      level: Math.abs(cashOverview.lastClosedSession.difference ?? 0) >= 100 ? "critical" : "warning",
      title: "Caja descuadrada en ultimo corte",
      message:
        `Esperado ${roundMoney(cashOverview.lastClosedSession.expectedAmount)} vs contado ${roundMoney(cashOverview.lastClosedSession.countedAmount ?? 0)}.`,
      module: "pos",
      entityId: cashOverview.lastClosedSession.id,
      entityType: "cashSession",
    });
  }

  for (const anomaly of salesReport.anomalies) {
    alerts.push({
      id: `sales-${anomaly.type}-${alerts.length + 1}`,
      type: "SALES_ANOMALY",
      level: anomaly.severity,
      title: "Anomalia basica en ventas",
      message: anomaly.message,
      module: "reports",
      entityType: "salesReport",
    });
  }

  const levelWeight = { critical: 3, warning: 2, info: 1 };
  const sorted = alerts.sort((a, b) => {
    if (levelWeight[a.level] !== levelWeight[b.level]) {
      return levelWeight[b.level] - levelWeight[a.level];
    }
    return a.title.localeCompare(b.title);
  });

  return {
    total: sorted.length,
    alerts: sorted.slice(0, limit),
  };
}

async function searchPatients(query: string) {
  const normalizedQuery = normalizeSearchValue(query);
  const patients = await prisma.patient.findMany({
    orderBy: { updatedAt: "desc" },
    take: 120,
  });

  return patients
    .map((patient) => {
      const score =
        scoreProductSearch(
          {
            sku: patient.phone ?? "",
            name: patient.fullName,
            commercialName: null,
            category: patient.notes ?? "",
          },
          normalizedQuery,
        );

      return {
        ...patient,
        relevance: score,
      };
    })
    .filter((patient) => patient.relevance > 0 || !normalizedQuery)
    .sort((a, b) => b.relevance - a.relevance || a.fullName.localeCompare(b.fullName));
}

async function buildAssistantResponse(query: string) {
  const intent = inferSearchIntent(query);
  const normalizedQuery = normalizeSearchValue(query);

  if (intent.assistantTopic === "restock") {
    const reorder = await buildReorderReport(30, 14);
    const topItems = reorder.items.slice(0, 5).map((item) =>
      `${item.name}: surtir ${item.suggestedOrder} unidades (${item.priority}).`
    );

    return {
      topic: "restock",
      title: "Surtido recomendado",
      summary:
        reorder.totalItems > 0
          ? `Hoy conviene priorizar ${reorder.totalItems} productos y ${reorder.totalUnitsSuggested} unidades sugeridas.`
          : "Hoy no hay productos urgentes por surtir.",
      bullets: topItems,
      records: reorder.items.slice(0, 8),
    };
  }

  if (intent.assistantTopic === "top-sales") {
    const report = await buildSalesReport(daysAgo(7), new Date());
    return {
      topic: "top-sales",
      title: "Mas vendidos de la semana",
      summary: `En los ultimos 7 dias hubo ${report.totalSales} ventas y ${report.totalItemsSold} unidades.`,
      bullets: report.bestSellingProducts.slice(0, 5).map((item) =>
        `${item.productName}: ${item.quantity} unidades y $${item.revenue.toFixed(2)}.`
      ),
      records: report.bestSellingProducts.slice(0, 8),
    };
  }

  if (intent.assistantTopic === "follow-up") {
    const followUps = await buildPendingFollowUps(10);
    return {
      topic: "follow-up",
      title: "Seguimientos pendientes",
      summary:
        followUps.length > 0
          ? `${followUps.length} pacientes requieren seguimiento.`
          : "No hay seguimientos pendientes.",
      bullets: followUps.map((item) =>
        `${item.patientName}: ${item.serviceType} ${item.followUpAt ? `(${item.followUpAt.slice(0, 10)})` : ""}`.trim()
      ),
      records: followUps,
    };
  }

  if (intent.assistantTopic === "sales-summary") {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const report = await buildSalesReport(todayStart, new Date());
    return {
      topic: "sales-summary",
      title: "Resumen de ventas del dia",
      summary:
        `Hoy llevas ${report.totalSales} ventas por $${report.totalRevenue.toFixed(2)} ` +
        `con utilidad estimada de $${report.estimatedGrossProfit.toFixed(2)}.`,
      bullets: report.highlights.slice(0, 4),
      records: report.salesSummary.slice(0, 8),
    };
  }

  const [products, patients, alerts] = await Promise.all([
    prisma.product.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      take: 120,
    }),
    searchPatients(normalizedQuery),
    buildOperationalAlerts(8),
  ]);

  const productMatches = products
    .map((product) => ({
      ...product,
      relevance: scoreProductSearch(product, normalizedQuery),
    }))
    .filter((product) => product.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance || a.name.localeCompare(b.name))
    .slice(0, 8);

  return {
    topic: "general",
    title: "Respuesta local del sistema",
    summary:
      productMatches.length > 0
        ? `Encontre ${productMatches.length} coincidencias de producto y ${patients.slice(0, 5).length} de paciente.`
        : `No hubo coincidencias fuertes. Hay ${alerts.total} alertas operativas activas.`,
    bullets: [
      ...productMatches.slice(0, 4).map((item) => `${item.name} (${item.sku})`),
      ...patients.slice(0, 3).map((item) => `Paciente: ${item.fullName}`),
      ...alerts.alerts.slice(0, 2).map((item) => item.title),
    ],
    records: {
      products: productMatches,
      patients: patients.slice(0, 5),
      alerts: alerts.alerts.slice(0, 5),
    },
  };
}

app.get("/health", (_req, res) => {
  res.json({
    service: "farmacia-api",
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

app.get(
  "/api/products",
  asyncHandler(async (req, res) => {
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const rawKind = typeof req.query.kind === "string"
      ? req.query.kind.trim().toUpperCase()
      : "";

    const kindFilter = Object.values(ProductKind).includes(rawKind as ProductKindCode)
      ? (rawKind as ProductKindCode)
      : null;

    if (!kindFilter || inventoryKinds.includes(kindFilter)) {
      await reconcileInventorySnapshot();
    }

    const products = await prisma.product.findMany({
      where: {
        kind: kindFilter ? kindFilter : { in: inventoryKinds },
      },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    });

    const ranked = query
      ? products
          .map((product) => ({
            ...product,
            relevance: scoreProductSearch(product, query),
          }))
          .filter((product) => product.relevance > 0)
          .sort((a, b) => b.relevance - a.relevance || a.name.localeCompare(b.name))
      : products;

    res.json(ranked);
  }),
);

app.get(
  "/api/products/search",
  asyncHandler(async (req, res) => {
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const rawKind = typeof req.query.kind === "string"
      ? req.query.kind.trim().toUpperCase()
      : "";
    const kindFilter = Object.values(ProductKind).includes(rawKind as ProductKindCode)
      ? (rawKind as ProductKindCode)
      : null;
    const intent = inferSearchIntent(query);

    if (query.length < 2) {
      res.status(400).json({ message: "La busqueda requiere minimo 2 caracteres." });
      return;
    }

    if (!kindFilter || inventoryKinds.includes(kindFilter)) {
      await reconcileInventorySnapshot();
    }

    const products = await prisma.product.findMany({
      where: {
        kind:
          kindFilter ??
          (intent.wantsServices ? ProductKind.MEDICAL_SERVICE : { in: [...inventoryKinds, serviceKind] }),
        isActive: true,
      },
    });

    const ranked = products
      .map((product) => ({
        ...product,
        relevance: scoreProductSearch(product, query),
      }))
      .filter((product) => {
        if (intent.wantsRestock) {
          return product.kind !== ProductKind.MEDICAL_SERVICE && product.stock <= product.minStock;
        }
        if (intent.wantsOutOfStock) {
          return product.kind !== ProductKind.MEDICAL_SERVICE && product.stock === 0;
        }
        return product.relevance > 0;
      })
      .sort((a, b) => b.relevance - a.relevance || a.name.localeCompare(b.name));

    res.json(ranked);
  }),
);

app.get(
  "/api/pos/items",
  asyncHandler(async (req, res) => {
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const intent = inferSearchIntent(query);
    await reconcileInventorySnapshot();

    const items = await prisma.product.findMany({
      where: { isActive: true },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
    });

    const ranked = query
      ? items
          .map((item) => ({
            ...item,
            relevance: scoreProductSearch(item, query),
          }))
          .filter((item) => {
            if (intent.wantsServices) {
              return item.kind === ProductKind.MEDICAL_SERVICE;
            }
            if (intent.wantsRestock) {
              return item.kind !== ProductKind.MEDICAL_SERVICE && item.stock <= item.minStock;
            }
            return item.relevance > 0;
          })
          .sort((a, b) => b.relevance - a.relevance || a.name.localeCompare(b.name))
      : items;

    res.json(ranked);
  }),
);

app.post(
  "/api/products",
  asyncHandler(async (req, res) => {
    const payload = productCreateSchema.parse(req.body);

    const normalizedCategory = payload.category?.trim()
      ? payload.category.trim()
      : inferProductCategory(payload.name, payload.kind);

    const normalizedUnit = payload.unit?.trim()
      ? payload.unit.trim().toLowerCase()
      : defaultUnitForKind(payload.kind);

    if (payload.kind !== serviceKind && normalizedUnit === "servicio") {
      throw new ApiError(
        400,
        "Los servicios se gestionan en el modulo Servicios/Citas y no forman parte del inventario.",
      );
    }

    const resolvedUnit = payload.kind === serviceKind ? "servicio" : normalizedUnit;
    const resolvedCost = payload.kind === serviceKind ? 0 : payload.cost;
    const resolvedStock = payload.kind === serviceKind ? 0 : payload.stock;
    const resolvedMinStock = payload.kind === serviceKind ? 0 : payload.minStock;
    const resolvedExpiresAt = resolveProductExpirationDate(
      payload.kind,
      payload.expiresAt,
      null,
    );

    const createdProduct = await prisma.$transaction(async (tx) => {
      const providedSku = typeof payload.sku === "string" ? normalizeSkuInput(payload.sku) : "";
      const resolvedSku = providedSku.length >= 2
        ? providedSku
        : await generateUniqueSku(tx, payload.name, payload.kind);
      const normalizedCommercialName = payload.commercialName?.trim()
        ? payload.commercialName.trim()
        : null;
      const { sku: _ignoredSku, lotCode: _ignoredLotCode, ...productData } = payload;

      const created = await tx.product.create({
        data: {
          ...productData,
          sku: resolvedSku,
          commercialName: normalizedCommercialName,
          category: normalizedCategory,
          unit: resolvedUnit,
          cost: resolvedCost,
          stock: resolvedStock,
          minStock: resolvedMinStock,
          expiresAt: resolvedExpiresAt,
        },
      });

      if (resolvedStock > 0 && payload.kind !== serviceKind) {
        await increaseInventoryLot(tx, created, {
          quantity: resolvedStock,
          lotCode: payload.lotCode,
          expiresAt: resolvedExpiresAt,
          cost: resolvedCost,
        });
      }

      await writeAuditLog(tx, {
        entityType: "product",
        entityId: created.id,
        action: "CREATE",
        message: `Producto creado: ${created.name}.`,
        payload: {
          sku: created.sku,
          kind: created.kind,
          stock: created.stock,
          minStock: created.minStock,
        },
      });

      return created;
    });

    res.status(201).json(createdProduct);
  }),
);

app.put(
  "/api/products/:id",
  asyncHandler(async (req, res) => {
    const productId = parseId(req.params.id);
    const payload = productUpdateSchema.parse(req.body);

    const result = await prisma.$transaction(async (tx) => {
      const previousProduct = await tx.product.findUnique({ where: { id: productId } });
      if (!previousProduct) {
        throw new ApiError(404, "Producto no encontrado.");
      }
      const { lotCode: _ignoredLotCode, ...payloadForUpdate } = payload;

      const nextKind = payload.kind ?? previousProduct.kind;
      const nextCost = nextKind === serviceKind ? 0 : (payload.cost ?? previousProduct.cost);
      const nextPrice = payload.price ?? previousProduct.price;
      const nextSku =
        typeof payload.sku === "string"
          ? normalizeSkuInput(payload.sku)
          : previousProduct.sku;
      const nextUnitRaw =
        typeof payload.unit === "string"
          ? payload.unit.trim().toLowerCase()
          : previousProduct.unit;
      const nextUnit = nextKind === serviceKind ? "servicio" : nextUnitRaw;

      if (typeof payload.sku === "string" && nextSku.length < 2) {
        throw new ApiError(400, "El SKU debe contener al menos 2 caracteres validos.");
      }

      if (nextKind !== serviceKind && nextPrice < nextCost) {
        throw new ApiError(
          400,
          "El precio al publico no puede ser menor al costo del producto.",
        );
      }

      if (nextKind !== serviceKind && nextUnit === "servicio") {
        throw new ApiError(
          400,
          "Los servicios se gestionan en el modulo Servicios/Citas y no forman parte del inventario.",
        );
      }

      const nextExpiresAt = resolveProductExpirationDate(
        nextKind,
        payload.expiresAt,
        previousProduct.expiresAt,
      );
      const currentCategory = previousProduct.category?.trim() ?? "";
      let nextCategory: string | null | undefined = payload.category;

      if (typeof payload.category === "string") {
        nextCategory = payload.category.trim() || null;
      } else if (
        (typeof payload.name === "string" || typeof payload.kind === "string") &&
        nextKind === ProductKind.MEDICATION &&
        genericMedicationCategories.has(currentCategory)
      ) {
        nextCategory = inferProductCategory(
          payload.name ?? previousProduct.name,
          nextKind,
        );
      } else if (
        (typeof payload.kind === "string" || !currentCategory) &&
        nextKind !== ProductKind.MEDICATION
      ) {
        nextCategory = defaultCategoryForKind(nextKind);
      }

      const updatedProduct = await tx.product.update({
        where: { id: productId },
        data: {
          ...payloadForUpdate,
          sku: typeof payload.sku === "string" ? nextSku : undefined,
          kind: nextKind,
          category: nextCategory,
          commercialName:
            typeof payload.commercialName === "string"
              ? payload.commercialName.trim() || null
              : payload.commercialName,
          unit: nextUnit,
          cost: nextKind === serviceKind ? 0 : payload.cost,
          stock:
            nextKind === serviceKind
              ? 0
              : typeof payload.stock === "number"
                ? payload.stock
                : undefined,
          minStock:
            nextKind === serviceKind
              ? 0
              : typeof payload.minStock === "number"
                ? payload.minStock
                : undefined,
          expiresAt: nextExpiresAt,
        },
      });

      if (typeof payload.price === "number" && payload.price !== previousProduct.price) {
        const previousPrice = previousProduct.price;
        const newPrice = payload.price;
        const changePct = previousPrice > 0 ? (newPrice - previousPrice) / previousPrice : 1;

        await tx.productPriceEvent.create({
          data: {
            productId,
            previousPrice,
            newPrice,
            changePct,
            reason: "Actualizacion manual de precio publico.",
          },
        });
      }

      let priceReview: {
        suggestedPrice: number;
        reason: string;
      } | null = null;

      if (
        nextKind !== serviceKind &&
        typeof payload.cost === "number" &&
        payload.cost > previousProduct.cost
      ) {
        const previousCost = previousProduct.cost;
        const newCost = payload.cost;
        const changePct = previousCost > 0 ? (newCost - previousCost) / previousCost : 1;

        await tx.productCostEvent.create({
          data: {
            productId,
            previousCost,
            newCost,
            changePct,
            reason: "Aumento de costo detectado en inventario.",
          },
        });

        const suggestedPrice = roundMoney(
          Math.max(
            updatedProduct.price,
            newCost / Math.max(0.1, 1 - targetMarginForKind(updatedProduct.kind)),
          ),
        );

        priceReview = {
          suggestedPrice,
          reason:
            `Costo aumentado +${roundPercent(changePct)}%. ` +
            "Se recomienda revisar precio al publico para proteger margen.",
        };

        await tx.aiSuggestion.create({
          data: {
            suggestionType: "cost-increase-price-review",
            payload: {
              generatedAt: new Date().toISOString(),
              productId,
              productName: updatedProduct.name,
              previousCost,
              newCost,
              currentPrice: updatedProduct.price,
              suggestedPrice,
              reason: priceReview.reason,
            },
          },
        });
      }

      if (
        typeof payload.expiresAt === "string" &&
        updatedProduct.kind === ProductKind.MEDICATION
      ) {
        const earliestLot = await tx.inventoryLot.findFirst({
          where: {
            productId,
            quantity: { gt: 0 },
          },
          orderBy: { expiresAt: "asc" },
        });

        if (earliestLot) {
          await tx.inventoryLot.update({
            where: { id: earliestLot.id },
            data: {
              expiresAt: nextExpiresAt,
            },
          });
          await syncProductFromLots(tx, productId);
        }
      }

      await writeAuditLog(tx, {
        entityType: "product",
        entityId: productId,
        action: "UPDATE",
        message: `Producto actualizado: ${updatedProduct.name}.`,
        payload: {
          cost: updatedProduct.cost,
          price: updatedProduct.price,
          minStock: updatedProduct.minStock,
          isActive: updatedProduct.isActive,
        },
      });

      return {
        updatedProduct,
        costIncreaseDetected: priceReview !== null,
        priceReview,
      };
    });

    res.json({
      ...result.updatedProduct,
      costIncreaseDetected: result.costIncreaseDetected,
      priceReview: result.priceReview,
    });
  }),
);

app.delete(
  "/api/products/:id",
  asyncHandler(async (req, res) => {
    const productId = parseId(req.params.id);

    const result = await prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: productId } });
      if (!product) {
        throw new ApiError(404, "Producto no encontrado.");
      }

      const [saleItemCount, consultationCount] = await Promise.all([
        tx.saleItem.count({ where: { productId } }),
        tx.consultation.count({ where: { serviceProductId: productId } }),
      ]);

      if (saleItemCount > 0 || consultationCount > 0) {
        const archived = await tx.product.update({
          where: { id: productId },
          data: { isActive: false },
        });

        await writeAuditLog(tx, {
          entityType: "product",
          entityId: productId,
          action: "ARCHIVE",
          message: `Producto archivado: ${archived.name}.`,
          payload: {
            sku: archived.sku,
            saleItemCount,
            consultationCount,
          },
        });

        return {
          mode: "archived" as const,
          product: archived,
        };
      }

      await tx.inventoryLot.deleteMany({ where: { productId } });
      await tx.inventoryMovement.deleteMany({ where: { productId } });
      await tx.productCostEvent.deleteMany({ where: { productId } });
      await tx.productPriceEvent.deleteMany({ where: { productId } });
      await tx.product.delete({ where: { id: productId } });

      await writeAuditLog(tx, {
        entityType: "product",
        entityId: productId,
        action: "DELETE",
        message: `Producto eliminado: ${product.name}.`,
        payload: {
          sku: product.sku,
          kind: product.kind,
        },
      });

      return {
        mode: "deleted" as const,
        product,
      };
    });

    res.json({
      mode: result.mode,
      product: result.product,
      message:
        result.mode === "deleted"
          ? "Producto eliminado del catalogo."
          : "Producto archivado porque ya tiene historial operativo.",
    });
  }),
);

app.patch(
  "/api/products/:id/stock",
  asyncHandler(async (req, res) => {
    const productId = parseId(req.params.id);
    const payload = stockAdjustSchema.parse(req.body);

    const updatedProduct = await prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: productId } });
      if (!product) {
        throw new ApiError(404, "Producto no encontrado.");
      }

      if (product.kind === serviceKind) {
        throw new ApiError(
          400,
          "Los servicios medicos no manejan ajustes de stock.",
        );
      }

      const adjustmentChange =
        typeof payload.targetStock === "number"
          ? payload.targetStock - product.stock
          : payload.change ?? 0;

      if (adjustmentChange === 0) {
        throw new ApiError(400, "El stock fisico ya coincide con el inventario registrado.");
      }

      const nextStock = product.stock + adjustmentChange;
      if (nextStock < 0) {
        throw new ApiError(400, "El ajuste deja el inventario en negativo.");
      }

      let touchedLotCodes: string[] = [];
      if (adjustmentChange > 0) {
        const lotCode = await increaseInventoryLot(tx, product, {
          quantity: adjustmentChange,
          lotCode: payload.lotCode,
          expiresAt: payload.expiresAt ? normalizeDateInput(payload.expiresAt) : undefined,
          cost: payload.cost ?? undefined,
        });
        touchedLotCodes = lotCode ? [lotCode] : [];
      } else if (adjustmentChange < 0) {
        touchedLotCodes = await consumeInventoryLots(tx, product, Math.abs(adjustmentChange));
      }

      if (typeof payload.cost === "number" && payload.cost !== product.cost) {
        const changePct = product.cost > 0 ? (payload.cost - product.cost) / product.cost : 1;
        await tx.product.update({
          where: { id: productId },
          data: { cost: payload.cost },
        });
        await tx.productCostEvent.create({
          data: {
            productId,
            previousCost: product.cost,
            newCost: payload.cost,
            changePct,
            reason: `Ajuste rapido de stock: ${payload.reason}`,
          },
        });
      }

      await tx.inventoryMovement.create({
        data: {
          productId,
          change: adjustmentChange,
          reason: payload.reason,
          lotCode: touchedLotCodes.join(", ") || payload.lotCode?.trim() || null,
        },
      });

      const productAfterUpdate = await syncProductFromLots(tx, productId);

      await writeAuditLog(tx, {
        entityType: "product",
        entityId: productId,
        action: "STOCK_ADJUST",
        message: `Ajuste de inventario para ${product.name}.`,
        payload: {
          previousStock: product.stock,
          targetStock: typeof payload.targetStock === "number" ? payload.targetStock : nextStock,
          change: adjustmentChange,
          reason: payload.reason,
          lotCodes: touchedLotCodes,
          cost: payload.cost,
        },
      });

      return productAfterUpdate;
    });

    res.json(updatedProduct);
  }),
);

app.get(
  "/api/inventory/alerts",
  asyncHandler(async (_req, res) => {
    await reconcileInventorySnapshot();

    const [products, operational] = await Promise.all([
      prisma.product.findMany({
        where: {
          isActive: true,
          kind: { in: inventoryKinds },
          unit: { not: "servicio" },
        },
        orderBy: { name: "asc" },
      }),
      buildOperationalAlerts(20),
    ]);

    const lowStockAlerts = products
      .map((product) => {
        const targetStock = calculateMinimumRestockTarget(
          product.stock,
          product.minStock,
        );
        return {
          ...product,
          targetStock,
          shortage: Math.max(0, targetStock - product.stock),
        };
      })
      .filter((product) => product.stock <= product.targetStock)
      .sort((a, b) => b.shortage - a.shortage);

    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const expiringLimit = new Date(now.getTime() + expirationAlertDays * 24 * 60 * 60 * 1000);

    const expiringLots = await prisma.inventoryLot.findMany({
      where: {
        quantity: { gt: 0 },
        expiresAt: { not: null, lte: expiringLimit },
        product: {
          kind: ProductKind.MEDICATION,
          isActive: true,
        },
      },
      include: {
        product: true,
      },
      orderBy: { expiresAt: "asc" },
      take: 120,
    });

    const expiringAlerts = expiringLots
      .map((lot) => {
        const expiryDate = new Date(lot.expiresAt as Date);
        expiryDate.setHours(0, 0, 0, 0);
        const daysToExpire = Math.ceil(
          (expiryDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
        );

        return {
          id: lot.id,
          productId: lot.productId,
          sku: lot.product.sku,
          name: lot.product.name,
          commercialName: lot.product.commercialName,
          category: lot.product.category,
          lotCode: lot.lotCode,
          quantity: lot.quantity,
          expiresAt: (lot.expiresAt as Date).toISOString(),
          daysToExpire,
          status: daysToExpire < 0 ? "EXPIRED" : "EXPIRING_SOON",
        };
      })
      .sort((a, b) => a.daysToExpire - b.daysToExpire);

    res.json({
      total: lowStockAlerts.length,
      alerts: lowStockAlerts,
      expiringTotal: expiringAlerts.length,
      expiringAlerts,
      expirationThresholdDays: expirationAlertDays,
      appointmentReminderMinutes,
      operationalAlerts: operational.alerts,
    });
  }),
);

app.get(
  "/api/inventory/movements",
  asyncHandler(async (req, res) => {
    const parsedTake = Number.parseInt(String(req.query.take ?? "120"), 10);
    const take = Number.isNaN(parsedTake) ? 120 : parsedTake;
    const movements = await listRecentInventoryMovements(take);

    res.json({
      count: movements.length,
      movements,
    });
  }),
);

app.post(
  "/api/sales",
  asyncHandler(async (req, res) => {
    const payload = saleCreateSchema.parse(req.body);

    const groupedItems = new Map<number, number>();
    for (const item of payload.items) {
      groupedItems.set(item.productId, (groupedItems.get(item.productId) ?? 0) + item.quantity);
    }

    const normalizedItems = [...groupedItems.entries()].map(([productId, quantity]) => ({
      productId,
      quantity,
    }));
    const productIds = normalizedItems.map((item) => item.productId);

    const createdSale = await prisma.$transaction(async (tx) => {
      const openSession = await getOpenCashSession(tx);
      if (!openSession) {
        throw new ApiError(
          409,
          "Abre caja antes de registrar ventas para mantener sincronizado el corte.",
        );
      }

      const products = await tx.product.findMany({
        where: {
          id: { in: productIds },
          isActive: true,
        },
      });

      if (products.length !== productIds.length) {
        throw new ApiError(400, "Uno o mas productos no son validos para la venta.");
      }

      const productMap = new Map(products.map((product) => [product.id, product]));

      const sale = await tx.sale.create({
        data: {
          customerName: payload.customerName,
          notes: payload.notes,
          subtotal: 0,
          discount: payload.discount,
          total: 0,
          amountPaid: payload.amountPaid,
          changeGiven: payload.changeGiven,
        },
      });

      let subtotal = 0;

      for (const item of normalizedItems) {
        const product = productMap.get(item.productId);
        if (!product) {
          throw new ApiError(400, `Producto ${item.productId} no encontrado.`);
        }

        if (product.kind !== serviceKind) {
          const touchedLots = await consumeInventoryLots(tx, product, item.quantity);
          if (touchedLots.length === 0 && product.stock < item.quantity) {
            throw new ApiError(
              400,
              `Stock insuficiente para ${product.name}. Disponible: ${product.stock}.`,
            );
          }

          await tx.inventoryMovement.create({
            data: {
              productId: product.id,
              change: -item.quantity,
              reason: `Venta #${sale.id}`,
              lotCode: touchedLots.join(", "),
            },
          });
        }

        const lineTotal = roundMoney(item.quantity * product.price);
        subtotal += lineTotal;

        await tx.saleItem.create({
          data: {
            saleId: sale.id,
            productId: product.id,
            quantity: item.quantity,
            unitPrice: product.price,
            unitCost: product.cost,
            lineTotal,
            productSku: product.sku,
            productName: product.name,
            productCommercialName: product.commercialName,
            productKind: product.kind,
            productCategory: product.category,
          },
        });
      }

      const total = roundMoney(Math.max(0, subtotal - payload.discount));
      const amountPaid = payload.amountPaid ?? total;
      const changeGiven = payload.changeGiven ?? roundMoney(Math.max(0, amountPaid - total));

      if (amountPaid < total) {
        throw new ApiError(400, "El pago recibido no cubre el total de la venta.");
      }

      const finalSale = await tx.sale.update({
        where: { id: sale.id },
        data: {
          subtotal: roundMoney(subtotal),
          total,
          amountPaid,
          changeGiven,
        },
        include: {
          items: {
            include: { product: true },
          },
        },
      });

      await appendCashMovement(tx, openSession.id, {
        type: CashMovementType.SALE,
        amount: total,
        reason: `Venta #${sale.id}`,
        saleId: sale.id,
      });

      await writeAuditLog(tx, {
        entityType: "sale",
        entityId: sale.id,
        action: "CREATE",
        message: `Venta #${sale.id} registrada.`,
        payload: {
          total,
          items: normalizedItems,
          cashSessionId: openSession.id,
        },
      });

      return finalSale;
    });

    res.status(201).json(createdSale);
  }),
);

app.get(
  "/api/sales",
  asyncHandler(async (_req, res) => {
    const recentSales = await prisma.sale.findMany({
      include: {
        items: {
          include: { product: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 30,
    });

    res.json(recentSales);
  }),
);

app.get(
  "/api/appointments",
  asyncHandler(async (req, res) => {
    const status =
      typeof req.query.status === "string" ? req.query.status.toUpperCase() : null;

    const appointments = await prisma.appointment.findMany({
      where:
        status && Object.values(AppointmentStatus).includes(status as AppointmentStatusCode)
          ? { status: status as AppointmentStatusCode }
          : undefined,
      include: {
        patient: true,
        consultation: true,
      },
      orderBy: { appointmentAt: "asc" },
      take: 100,
    });

    res.json(appointments);
  }),
);

app.post(
  "/api/appointments",
  asyncHandler(async (req, res) => {
    const payload = appointmentCreateSchema.parse(req.body);
    const appointmentDate = new Date(payload.appointmentAt);
    if (Number.isNaN(appointmentDate.getTime())) {
      throw new ApiError(400, "La fecha de cita no es valida.");
    }

    const appointment = await prisma.$transaction(async (tx) => {
      const patient = await findOrCreatePatient(tx, {
        fullName: payload.patientName,
        phone: payload.patientPhone,
        notes: payload.notes,
      });

      const created = await tx.appointment.create({
        data: {
          patientId: patient.id,
          patientName: payload.patientName,
          patientPhone: payload.patientPhone?.trim() || null,
          serviceType: payload.serviceType,
          notes: payload.notes,
          appointmentAt: appointmentDate,
        },
      });

      await writeAuditLog(tx, {
        entityType: "appointment",
        entityId: created.id,
        action: "CREATE",
        message: `Cita registrada para ${created.patientName}.`,
        payload: {
          serviceType: created.serviceType,
          appointmentAt: created.appointmentAt.toISOString(),
        },
      });

      return created;
    });

    res.status(201).json(appointment);
  }),
);

app.patch(
  "/api/appointments/:id/status",
  asyncHandler(async (req, res) => {
    const appointmentId = parseId(req.params.id);
    const payload = appointmentStatusSchema.parse(req.body);

    const updatedAppointment = await prisma.$transaction(async (tx) => {
      const updated = await tx.appointment.update({
        where: { id: appointmentId },
        data: { status: payload.status },
      });

      await writeAuditLog(tx, {
        entityType: "appointment",
        entityId: appointmentId,
        action: "STATUS_CHANGE",
        message: `Estado de cita actualizado a ${payload.status}.`,
        payload: {
          status: payload.status,
        },
      });

      return updated;
    });

    res.json(updatedAppointment);
  }),
);

app.get(
  "/api/patients",
  asyncHandler(async (req, res) => {
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const patients = query ? await searchPatients(query) : await prisma.patient.findMany({
      orderBy: { updatedAt: "desc" },
      take: 120,
    });

    res.json(patients);
  }),
);

app.post(
  "/api/patients",
  asyncHandler(async (req, res) => {
    const payload = patientCreateSchema.parse(req.body);
    const patient = await prisma.$transaction(async (tx) => {
      const created = await findOrCreatePatient(tx, {
        fullName: payload.fullName,
        phone: payload.phone,
        notes: payload.notes,
      });

      await writeAuditLog(tx, {
        entityType: "patient",
        entityId: created.id,
        action: "UPSERT",
        message: `Paciente registrado: ${created.fullName}.`,
        payload: {
          phone: created.phone,
        },
      });

      return created;
    });

    res.status(201).json(patient);
  }),
);

app.get(
  "/api/consultations",
  asyncHandler(async (req, res) => {
    const patientId =
      typeof req.query.patientId === "string" ? parseId(req.query.patientId) : null;

    const consultations = await prisma.consultation.findMany({
      where: patientId ? { patientId } : undefined,
      include: {
        patient: true,
        appointment: true,
        serviceProduct: true,
      },
      orderBy: { createdAt: "desc" },
      take: 120,
    });

    res.json(consultations);
  }),
);

app.post(
  "/api/consultations",
  asyncHandler(async (req, res) => {
    const payload = consultationCreateSchema.parse(req.body);
    const followUpAt = payload.followUpAt ? new Date(payload.followUpAt) : null;
    if (payload.followUpAt && Number.isNaN(followUpAt?.getTime() ?? Number.NaN)) {
      throw new ApiError(400, "La fecha de seguimiento no es valida.");
    }

    const consultation = await prisma.$transaction(async (tx) => {
      const patient = await tx.patient.findUnique({ where: { id: payload.patientId } });
      if (!patient) {
        throw new ApiError(404, "Paciente no encontrado.");
      }

      if (payload.appointmentId) {
        const appointment = await tx.appointment.findUnique({
          where: { id: payload.appointmentId },
        });
        if (!appointment) {
          throw new ApiError(404, "La cita asociada no existe.");
        }
      }

      const created = await tx.consultation.create({
        data: {
          patientId: payload.patientId,
          appointmentId: payload.appointmentId,
          serviceProductId: payload.serviceProductId,
          serviceType: payload.serviceType,
          summary: payload.summary,
          diagnosis: payload.diagnosis,
          treatment: payload.treatment,
          observations: payload.observations,
          followUpAt,
          followUpStatus:
            payload.followUpStatus ??
            (followUpAt ? FollowUpStatus.PENDING : FollowUpStatus.NONE),
        },
        include: {
          patient: true,
          appointment: true,
          serviceProduct: true,
        },
      });

      await tx.patient.update({
        where: { id: payload.patientId },
        data: { lastVisitAt: new Date() },
      });

      if (payload.appointmentId) {
        await tx.appointment.update({
          where: { id: payload.appointmentId },
          data: { status: AppointmentStatus.COMPLETED },
        });
      }

      await writeAuditLog(tx, {
        entityType: "consultation",
        entityId: created.id,
        action: "CREATE",
        message: `Consulta registrada para ${created.patient.fullName}.`,
        payload: {
          serviceType: created.serviceType,
          followUpAt: created.followUpAt?.toISOString() ?? null,
        },
      });

      return created;
    });

    res.status(201).json(consultation);
  }),
);

app.patch(
  "/api/consultations/:id/follow-up",
  asyncHandler(async (req, res) => {
    const consultationId = parseId(req.params.id);
    const payload = followUpStatusSchema.parse(req.body);

    const consultation = await prisma.$transaction(async (tx) => {
      const updated = await tx.consultation.update({
        where: { id: consultationId },
        data: {
          followUpStatus: payload.status,
        },
        include: {
          patient: true,
        },
      });

      await writeAuditLog(tx, {
        entityType: "consultation",
        entityId: consultationId,
        action: "FOLLOW_UP_STATUS",
        message: `Seguimiento de ${updated.patient.fullName} actualizado a ${payload.status}.`,
        payload: {
          status: payload.status,
        },
      });

      return updated;
    });

    res.json(consultation);
  }),
);

app.get(
  "/api/inventory/lots",
  asyncHandler(async (req, res) => {
    const productId =
      typeof req.query.productId === "string" ? parseId(req.query.productId) : null;

    const lots = await prisma.inventoryLot.findMany({
      where: productId ? { productId } : undefined,
      include: {
        product: {
          select: {
            id: true,
            sku: true,
            name: true,
            commercialName: true,
            kind: true,
          },
        },
      },
      orderBy: [{ expiresAt: "asc" }, { createdAt: "desc" }],
      take: 240,
    });

    res.json(lots);
  }),
);

app.get(
  "/api/cash/current",
  asyncHandler(async (_req, res) => {
    res.json(await buildCashOverview());
  }),
);

app.post(
  "/api/cash/open",
  asyncHandler(async (req, res) => {
    const payload = cashSessionOpenSchema.parse(req.body ?? {});

    const session = await prisma.$transaction(async (tx) => {
      const existing = await getOpenCashSession(tx);
      if (existing) {
        throw new ApiError(409, "Ya existe una caja abierta.");
      }

      const created = await tx.cashSession.create({
        data: {
          status: CashSessionStatus.OPEN,
          openingAmount: roundMoney(payload.openingAmount),
          expectedAmount: roundMoney(payload.openingAmount),
          notes: payload.notes,
        },
      });

      await tx.cashMovement.create({
        data: {
          sessionId: created.id,
          type: CashMovementType.OPENING,
          amount: roundMoney(payload.openingAmount),
          reason: payload.notes?.trim() || "Apertura de caja",
        },
      });

      await writeAuditLog(tx, {
        entityType: "cashSession",
        entityId: created.id,
        action: "OPEN",
        message: "Caja abierta.",
        payload: {
          openingAmount: created.openingAmount,
        },
      });

      return tx.cashSession.findUnique({
        where: { id: created.id },
        include: {
          movements: {
            orderBy: { createdAt: "desc" },
            take: 20,
          },
        },
      });
    });

    res.status(201).json(session);
  }),
);

app.post(
  "/api/cash/movements",
  asyncHandler(async (req, res) => {
    const payload = cashMovementCreateSchema.parse(req.body);

    const movement = await prisma.$transaction(async (tx) => {
      const session = await getOpenCashSession(tx);
      if (!session) {
        throw new ApiError(409, "No hay una caja abierta.");
      }

      const created = await appendCashMovement(tx, session.id, payload);
      await writeAuditLog(tx, {
        entityType: "cashSession",
        entityId: session.id,
        action: "MOVE",
        message: `Movimiento ${payload.type} registrado en caja.`,
        payload: {
          amount: payload.amount,
          reason: payload.reason,
        },
      });

      return created;
    });

    res.status(201).json(movement);
  }),
);

app.post(
  "/api/cash/close",
  asyncHandler(async (req, res) => {
    const payload = cashSessionCloseSchema.parse(req.body);

    const session = await prisma.$transaction(async (tx) => {
      const openSession = await getOpenCashSession(tx);
      if (!openSession) {
        throw new ApiError(409, "No hay una caja abierta para cerrar.");
      }

      const difference = roundMoney(payload.countedAmount - openSession.expectedAmount);
      await tx.cashMovement.create({
        data: {
          sessionId: openSession.id,
          type: CashMovementType.CLOSING,
          amount: roundMoney(payload.countedAmount),
          reason: payload.notes?.trim() || "Cierre de caja",
        },
      });

      const closed = await tx.cashSession.update({
        where: { id: openSession.id },
        data: {
          status: CashSessionStatus.CLOSED,
          countedAmount: roundMoney(payload.countedAmount),
          difference,
          closedAt: new Date(),
          notes: payload.notes ?? openSession.notes,
        },
        include: {
          movements: {
            orderBy: { createdAt: "desc" },
            take: 30,
          },
        },
      });

      await writeAuditLog(tx, {
        entityType: "cashSession",
        entityId: closed.id,
        action: "CLOSE",
        message: "Caja cerrada.",
        payload: {
          expectedAmount: closed.expectedAmount,
          countedAmount: closed.countedAmount,
          difference: closed.difference,
        },
      });

      return closed;
    });

    res.json(session);
  }),
);

app.get(
  "/api/operations/alerts",
  asyncHandler(async (_req, res) => {
    await reconcileInventorySnapshot();
    res.json(await buildOperationalAlerts());
  }),
);

app.get(
  "/api/audit-log",
  asyncHandler(async (req, res) => {
    const parsedTake = Number.parseInt(String(req.query.take ?? "120"), 10);
    const take = Number.isNaN(parsedTake) ? 120 : Math.min(300, Math.max(1, parsedTake));
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take,
    });

    res.json({
      count: logs.length,
      logs,
    });
  }),
);

app.post(
  "/api/assistant/query",
  asyncHandler(async (req, res) => {
    const payload = assistantQuerySchema.parse(req.body ?? {});
    res.json(await buildAssistantResponse(payload.query));
  }),
);

app.get(
  "/api/analytics/dashboard",
  asyncHandler(async (_req, res) => {
    await reconcileInventorySnapshot();

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [
      todaySales,
      monthSales,
      totalProducts,
      inventorySnapshot,
      openAppointments,
      nextAppointments,
      pendingFollowUps,
      cashOverview,
      operationsAlerts,
    ] = await Promise.all([
      prisma.sale.aggregate({
        _sum: { total: true },
        _count: { _all: true },
        where: { createdAt: { gte: startOfToday } },
      }),
      prisma.sale.aggregate({
        _sum: { total: true },
        _count: { _all: true },
        where: { createdAt: { gte: daysAgo(30) } },
      }),
      prisma.product.count({
        where: {
          isActive: true,
          kind: { in: inventoryKinds },
          unit: { not: "servicio" },
        },
      }),
      prisma.product.findMany({
        where: {
          isActive: true,
          kind: { in: inventoryKinds },
          unit: { not: "servicio" },
        },
        select: { stock: true, minStock: true },
      }),
      prisma.appointment.count({ where: { status: AppointmentStatus.SCHEDULED } }),
      prisma.appointment.findMany({
        where: {
          status: AppointmentStatus.SCHEDULED,
          appointmentAt: { gte: new Date() },
        },
        orderBy: { appointmentAt: "asc" },
        take: 5,
      }),
      buildPendingFollowUps(5),
      buildCashOverview(),
      buildOperationalAlerts(10),
    ]);

    const lowStockProducts = inventorySnapshot.filter(
      (item) => item.stock <= item.minStock,
    ).length;

    res.json({
      salesToday: roundMoney(todaySales._sum.total ?? 0),
      ticketsToday: todaySales._count._all,
      sales30Days: roundMoney(monthSales._sum.total ?? 0),
      tickets30Days: monthSales._count._all,
      totalProducts,
      lowStockProducts,
      openAppointments,
      nextAppointments,
      pendingFollowUpsCount: pendingFollowUps.length,
      pendingFollowUps,
      openCashSession: cashOverview.openSession,
      lastClosedCashSession: cashOverview.lastClosedSession,
      operationalAlerts: operationsAlerts.alerts,
    });
  }),
);

app.get(
  "/api/reports/sales",
  asyncHandler(async (req, res) => {
    const from =
      typeof req.query.from === "string" ? new Date(req.query.from) : daysAgo(30);
    const to = typeof req.query.to === "string" ? new Date(req.query.to) : new Date();

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new ApiError(400, "Las fechas del reporte no son validas.");
    }

    const report = await buildSalesReport(from, to);
    res.json(report);
  }),
);

app.get(
  "/api/reports/sales.csv",
  asyncHandler(async (req, res) => {
    const from =
      typeof req.query.from === "string" ? new Date(req.query.from) : daysAgo(30);
    const to = typeof req.query.to === "string" ? new Date(req.query.to) : new Date();

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new ApiError(400, "Las fechas del reporte no son validas.");
    }

    const report = await buildSalesReport(from, to);
    const csvHeader = [
      "saleId",
      "createdAt",
      "customerName",
      "subtotal",
      "discount",
      "total",
      "amountPaid",
      "changeGiven",
      "cashLinked",
    ];

    const cashLinkedSaleIds = new Set(report.cashLinkedSaleIds);
    const csvLines = report.sales.map((sale) =>
      [
        csvEscape(sale.id),
        csvEscape(sale.createdAt.toISOString()),
        csvEscape(sale.customerName),
        csvEscape(sale.subtotal),
        csvEscape(sale.discount),
        csvEscape(sale.total),
        csvEscape(sale.amountPaid),
        csvEscape(sale.changeGiven),
        csvEscape(cashLinkedSaleIds.has(sale.id) ? "yes" : "review"),
      ].join(","),
    );

    const csv = [csvHeader.join(","), ...csvLines].join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=sales-report-${new Date().toISOString().slice(0, 10)}.csv`,
    );
    res.send(csv);
  }),
);

app.get(
  "/api/reports/reorder",
  asyncHandler(async (req, res) => {
    const parsedDays = Number.parseInt(String(req.query.days ?? "30"), 10);
    const parsedCoverageDays = Number.parseInt(String(req.query.coverageDays ?? "14"), 10);

    const days = Number.isNaN(parsedDays) ? 30 : Math.min(120, Math.max(1, parsedDays));
    const coverageDays = Number.isNaN(parsedCoverageDays)
      ? 14
      : Math.min(60, Math.max(1, parsedCoverageDays));

    const report = await buildReorderReport(days, coverageDays);
    res.json(report);
  }),
);

app.get(
  "/api/ai/price-adjustments",
  asyncHandler(async (req, res) => {
    const rawMarketShift = Number.parseFloat(String(req.query.marketShift ?? "0"));
    const marketShift = Number.isNaN(rawMarketShift)
      ? 0
      : Math.min(0.25, Math.max(-0.25, rawMarketShift));
    const rawTrigger = String(req.query.trigger ?? "manual");
    const trigger: PricingTrigger =
      rawTrigger === "monthly-cutoff" || rawTrigger === "cost-increase"
        ? rawTrigger
        : "manual";

    const { source, suggestions } = await buildPriceSuggestions(marketShift, trigger);

    res.json({
      source,
      count: suggestions.length,
      suggestions,
    });
  }),
);

app.post(
  "/api/ai/price-adjustments",
  asyncHandler(async (req, res) => {
    const payload = aiAdjustmentInputSchema.parse(req.body ?? {});
    const marketShift = payload.marketShift ?? 0;
    const trigger: PricingTrigger = payload.trigger ?? "manual";

    const { source, suggestions } = await buildPriceSuggestions(marketShift, trigger);

    await prisma.aiSuggestion.create({
      data: {
        suggestionType: "price-adjustments",
        payload: {
          generatedAt: new Date().toISOString(),
          marketShift,
          trigger,
          source,
          suggestions,
        },
      },
    });

    res.json({
      source,
      count: suggestions.length,
      suggestions,
    });
  }),
);

app.post(
  "/api/ai/price-adjustments/monthly",
  asyncHandler(async (_req, res) => {
    const trigger: PricingTrigger = "monthly-cutoff";
    const marketShift = 0;

    const { source, suggestions } = await buildPriceSuggestions(marketShift, trigger);

    await prisma.aiSuggestion.create({
      data: {
        suggestionType: "monthly-price-cutoff",
        payload: {
          generatedAt: new Date().toISOString(),
          marketShift,
          trigger,
          source,
          suggestions,
        },
      },
    });

    res.json({
      source,
      count: suggestions.length,
      suggestions,
      message: "Corte mensual de precios generado.",
    });
  }),
);

app.get(
  "/api/ai/business-insights",
  asyncHandler(async (_req, res) => {
    const [salesReport, inventoryAlerts, followUps] = await Promise.all([
      buildSalesReport(daysAgo(30), new Date()),
      prisma.product.findMany({
        where: {
          isActive: true,
          kind: { in: inventoryKinds },
          unit: { not: "servicio" },
        },
        select: { id: true, name: true, stock: true, minStock: true },
      }),
      buildPendingFollowUps(6),
    ]);

    const lowStock = inventoryAlerts.filter((item) => item.stock <= item.minStock).length;

    const aiInsights = await requestAionBusinessInsights({
      totalRevenue30Days: salesReport.totalRevenue,
      totalSales30Days: salesReport.totalSales,
      averageTicket30Days: salesReport.averageTicket,
      lowStockProducts: lowStock,
      topProducts: salesReport.topProducts,
    });

    if (aiInsights && aiInsights.length > 0) {
      res.json({
        source: "aion",
        insights: aiInsights,
      });
      return;
    }

    const topByUnits = salesReport.bestSellingProducts[0];
    const leastByUnits = salesReport.leastSellingProducts[0];

    const fallbackInsights = [
      ...salesReport.highlights.slice(0, 3),
      `Descuentos acumulados: $${salesReport.totalDiscount.toFixed(2)} (${salesReport.discountRatePct.toFixed(2)}% del bruto).`,
      `Utilidad estimada: $${salesReport.estimatedGrossProfit.toFixed(2)} con margen estimado ${salesReport.estimatedMarginPct.toFixed(2)}%.`,
      `Producto mas vendido por unidades: ${topByUnits ? `${topByUnits.productName} (${topByUnits.quantity})` : "sin datos"}.`,
      `Producto de menor rotacion: ${leastByUnits ? `${leastByUnits.productName} (${leastByUnits.quantity})` : "sin datos"}.`,
      `Pacientes con seguimiento pendiente: ${followUps.length}.`,
      `Productos con alerta de inventario: ${lowStock}. Recomendacion: priorizar reposicion y campañas para productos de baja rotacion.`,
    ];

    res.json({
      source: "local",
      insights: fallbackInsights,
    });
  }),
);

app.post(
  "/api/database/export",
  asyncHandler(async (_req, res) => {
    const backup = await createDatabaseBackup("manual");
    await prisma.auditLog.create({
      data: {
        entityType: "database",
        action: "EXPORT",
        message: "Respaldo manual generado.",
        payload: {
          fileName: backup.fileName,
          destination: backup.destination,
        },
      },
    });

    res.json({
      message: "Exportacion completada.",
      fileName: backup.fileName,
      path: backup.destination,
    });
  }),
);

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof z.ZodError) {
    res.status(400).json({
      message: "Datos invalidos.",
      details: error.issues,
    });
    return;
  }

  const prismaErrorCode =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: string }).code
      : undefined;

  if (prismaErrorCode === "P2025") {
    res.status(404).json({ message: "Registro no encontrado." });
    return;
  }

  if (prismaErrorCode === "P2002") {
    res.status(409).json({ message: "Ya existe un registro con ese valor unico." });
    return;
  }

  if (error instanceof ApiError) {
    res.status(error.status).json({ message: error.message });
    return;
  }

  console.error("Error no controlado en API:", error);
  res.status(500).json({ message: "Error interno del servidor." });
});

let server: ReturnType<typeof app.listen> | null = null;

async function startServer() {
  await ensureSchemaCompatibility();

  server = app.listen(config.port, config.apiHost, () => {
    console.log(`API de farmacia ejecutandose en http://${config.apiHost}:${config.port}`);
    startAutomaticBackups();
  });
}

void startServer().catch((error) => {
  console.error("No fue posible iniciar la API:", error);
  process.exit(1);
});

async function shutdown(signal: string) {
  console.log(`Recibida señal ${signal}. Cerrando API...`);
  if (backupTimer) {
    clearInterval(backupTimer);
    backupTimer = null;
  }

  if (!server) {
    await prisma.$disconnect();
    process.exit(0);
    return;
  }

  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });

  setTimeout(() => {
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
