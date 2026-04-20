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
const { AppointmentStatus, ProductKind } = prismaClientPackage;

type ProductKindCode = import("@prisma/client").ProductKind;
type AppointmentStatusCode = import("@prisma/client").AppointmentStatus;

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
  isActive: z.boolean().optional(),
});

const productCreateSchema = productBaseSchema.refine((value) => value.price >= value.cost, {
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
      return value.price >= value.cost;
    }
    return true;
  }, {
    path: ["price"],
    message: "El precio al publico no puede ser menor al costo.",
  });

const stockAdjustSchema = z.object({
  change: z.number().int(),
  reason: z.string().min(3).max(120),
});

const saleCreateSchema = z.object({
  customerName: z.string().max(120).optional(),
  notes: z.string().max(500).optional(),
  discount: z.number().min(0).default(0),
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
  return "Medicamento";
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

function scoreProductSearch(product: {
  sku: string;
  name: string;
  commercialName: string | null;
  category: string | null;
}, query: string): number {
  const q = query.toLowerCase();
  const sku = product.sku.toLowerCase();
  const name = product.name.toLowerCase();
  const commercialName = (product.commercialName ?? "").toLowerCase();
  const category = (product.category ?? "").toLowerCase();

  let score = 0;
  if (name.startsWith(q)) score += 5;
  if (commercialName.startsWith(q)) score += 5;
  if (sku.startsWith(q)) score += 4;
  if (name.includes(q)) score += 3;
  if (commercialName.includes(q)) score += 3;
  if (category.includes(q)) score += 2;
  if (sku.includes(q)) score += 1;
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

  const recentCostIncreaseByProduct = await getRecentCostIncreaseRatios();

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

  const localSuggestions = products.map((product) =>
    calculateSuggestedPublicPrice(
      product,
      marketShift,
      recentCostIncreaseByProduct.get(product.id) ?? 0,
      trigger,
    ),
  );

  return {
    source: "local",
    suggestions: localSuggestions,
  };
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
  try {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "Product" ADD COLUMN "commercialName" TEXT',
    );
    console.log("Columna commercialName agregada a Product.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("duplicate column name")) {
      return;
    }
    throw error;
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
  const productById = new Map(productsForPeriod.map((product) => [product.id, product]));

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
      const productSnapshot = productById.get(item.productId);
      const unitCost = productSnapshot?.cost ?? item.product.cost;
      const lineCost = item.quantity * unitCost;

      const current = productAccumulator.get(item.productId) ?? {
        productId: item.productId,
        sku: item.product.sku,
        productName: item.product.name,
        productCommercialName: item.product.commercialName,
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

  const salesSummary = sales
    .map((sale) => {
      const itemCount = sale.items.reduce((sum, item) => sum + item.quantity, 0);
      return {
        saleId: sale.id,
        createdAt: sale.createdAt.toISOString(),
        customerName: sale.customerName,
        subtotal: roundMoney(sale.subtotal),
        discount: roundMoney(sale.discount),
        total: roundMoney(sale.total),
        itemCount,
      };
    })
    .sort((a, b) => b.saleId - a.saleId)
    .slice(0, 40);

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
    productPerformance: performanceRows,
    salesSummary,
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
    createdAt: row.createdAt.toISOString(),
    currentStock: row.product.stock,
    minStock: row.product.minStock,
  }));
}

async function buildReorderReport(days: number, coverageDays: number) {
  const periodDays = Math.max(1, days);
  const desiredCoverageDays = Math.max(1, coverageDays);
  const from = daysAgo(periodDays);
  const to = new Date();

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
      const safetyStock = Math.max(product.minStock, Math.ceil(dailyVelocity * 3));
      const targetStock = Math.max(
        product.minStock,
        Math.ceil(dailyVelocity * desiredCoverageDays + safetyStock),
      );
      const suggestedOrder = Math.max(0, targetStock - product.stock);

      const needsRestock = product.stock <= product.minStock || suggestedOrder > 0;
      if (!needsRestock) {
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
        category: product.category,
        stock: product.stock,
        minStock: product.minStock,
        targetStock,
        suggestedOrder,
        soldInPeriod,
        dailyVelocity: Number(dailyVelocity.toFixed(2)),
        priority,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => {
      const priorityWeight = { CRITICAL: 3, HIGH: 2, MEDIUM: 1 };
      if (priorityWeight[a.priority] !== priorityWeight[b.priority]) {
        return priorityWeight[b.priority] - priorityWeight[a.priority];
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
    items,
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

    const where = {
      kind: kindFilter ? kindFilter : { in: inventoryKinds },
      ...(query
        ? {
            OR: [
              { name: { contains: query } },
              { commercialName: { contains: query } },
              { sku: { contains: query } },
              { category: { contains: query } },
            ],
          }
        : {}),
    };

    const products = await prisma.product.findMany({
      where,
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    });

    res.json(products);
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

    if (query.length < 2) {
      res.status(400).json({ message: "La busqueda requiere minimo 2 caracteres." });
      return;
    }

    const products = await prisma.product.findMany({
      where: {
        kind: kindFilter ? kindFilter : { in: inventoryKinds },
        OR: [
          { name: { contains: query } },
          { commercialName: { contains: query } },
          { sku: { contains: query } },
          { category: { contains: query } },
        ],
        isActive: true,
      },
    });

    const ranked = products
      .map((product) => ({
        ...product,
        relevance: scoreProductSearch(product, query),
      }))
      .sort((a, b) => b.relevance - a.relevance || a.name.localeCompare(b.name));

    res.json(ranked);
  }),
);

app.get(
  "/api/pos/items",
  asyncHandler(async (req, res) => {
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";

    const where = {
      isActive: true,
      ...(query
        ? {
            OR: [
              { name: { contains: query } },
              { commercialName: { contains: query } },
              { sku: { contains: query } },
              { category: { contains: query } },
            ],
          }
        : {}),
    };

    const items = await prisma.product.findMany({
      where,
      orderBy: [{ kind: "asc" }, { name: "asc" }],
    });

    const ranked = query
      ? items
          .map((item) => ({
            ...item,
            relevance: scoreProductSearch(item, query),
          }))
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
      : defaultCategoryForKind(payload.kind);

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
      const { sku: _ignoredSku, ...productData } = payload;

      return tx.product.create({
        data: {
          ...productData,
          sku: resolvedSku,
          commercialName: normalizedCommercialName,
          category: normalizedCategory,
          unit: resolvedUnit,
          stock: resolvedStock,
          minStock: resolvedMinStock,
          expiresAt: resolvedExpiresAt,
        },
      });
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

      const nextCost = payload.cost ?? previousProduct.cost;
      const nextPrice = payload.price ?? previousProduct.price;
      const nextKind = payload.kind ?? previousProduct.kind;
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

      if (nextPrice < nextCost) {
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

      const updatedProduct = await tx.product.update({
        where: { id: productId },
        data: {
          ...payload,
          sku: typeof payload.sku === "string" ? nextSku : undefined,
          kind: nextKind,
          category:
            typeof payload.category === "string"
              ? payload.category.trim() || null
              : payload.category,
          commercialName:
            typeof payload.commercialName === "string"
              ? payload.commercialName.trim() || null
              : payload.commercialName,
          unit: nextUnit,
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

      let priceReview: {
        suggestedPrice: number;
        reason: string;
      } | null = null;

      if (typeof payload.cost === "number" && payload.cost > previousProduct.cost) {
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

      const nextStock = product.stock + payload.change;
      if (nextStock < 0) {
        throw new ApiError(400, "El ajuste deja el inventario en negativo.");
      }

      const productAfterUpdate = await tx.product.update({
        where: { id: productId },
        data: { stock: nextStock },
      });

      await tx.inventoryMovement.create({
        data: {
          productId,
          change: payload.change,
          reason: payload.reason,
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
    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        kind: { in: inventoryKinds },
        unit: { not: "servicio" },
      },
      orderBy: { name: "asc" },
    });

    const lowStockAlerts = products
      .map((product) => {
        const targetStock = product.minStock;
        return {
          ...product,
          targetStock,
          shortage: targetStock - product.stock,
        };
      })
      .filter((product) => product.stock <= product.targetStock)
      .sort((a, b) => b.shortage - a.shortage);

    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const expiringLimit = new Date(now.getTime() + expirationAlertDays * 24 * 60 * 60 * 1000);

    const expiringAlerts = products
      .filter((product) => product.kind === ProductKind.MEDICATION && !!product.expiresAt)
      .map((product) => {
        const expiryDate = new Date(product.expiresAt as Date);
        expiryDate.setHours(0, 0, 0, 0);
        const daysToExpire = Math.ceil(
          (expiryDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
        );

        return {
          id: product.id,
          sku: product.sku,
          name: product.name,
          commercialName: product.commercialName,
          category: product.category,
          expiresAt: (product.expiresAt as Date).toISOString(),
          daysToExpire,
          status: daysToExpire < 0 ? "EXPIRED" : "EXPIRING_SOON",
        };
      })
      .filter((product) => new Date(product.expiresAt) <= expiringLimit)
      .sort((a, b) => a.daysToExpire - b.daysToExpire);

    res.json({
      total: lowStockAlerts.length,
      alerts: lowStockAlerts,
      expiringTotal: expiringAlerts.length,
      expiringAlerts,
      expirationThresholdDays: expirationAlertDays,
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
        },
      });

      let subtotal = 0;

      for (const item of normalizedItems) {
        const product = productMap.get(item.productId);
        if (!product) {
          throw new ApiError(400, `Producto ${item.productId} no encontrado.`);
        }

        if (product.kind !== serviceKind) {
          const stockUpdated = await tx.product.updateMany({
            where: {
              id: product.id,
              stock: { gte: item.quantity },
            },
            data: {
              stock: {
                decrement: item.quantity,
              },
            },
          });

          if (stockUpdated.count === 0) {
            const stockSnapshot = await tx.product.findUnique({
              where: { id: product.id },
              select: { name: true, stock: true },
            });

            throw new ApiError(
              400,
              `Stock insuficiente para ${stockSnapshot?.name ?? product.name}. Disponible: ${stockSnapshot?.stock ?? 0}.`,
            );
          }
        }

        const lineTotal = roundMoney(item.quantity * product.price);
        subtotal += lineTotal;

        await tx.saleItem.create({
          data: {
            saleId: sale.id,
            productId: product.id,
            quantity: item.quantity,
            unitPrice: product.price,
            lineTotal,
          },
        });

        if (product.kind !== serviceKind) {
          await tx.inventoryMovement.create({
            data: {
              productId: product.id,
              change: -item.quantity,
              reason: `Venta #${sale.id}`,
            },
          });
        }
      }

      const total = roundMoney(Math.max(0, subtotal - payload.discount));

      return tx.sale.update({
        where: { id: sale.id },
        data: {
          subtotal: roundMoney(subtotal),
          total,
        },
        include: {
          items: {
            include: { product: true },
          },
        },
      });
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

    const appointment = await prisma.appointment.create({
      data: {
        patientName: payload.patientName,
        serviceType: payload.serviceType,
        notes: payload.notes,
        appointmentAt: appointmentDate,
      },
    });

    res.status(201).json(appointment);
  }),
);

app.patch(
  "/api/appointments/:id/status",
  asyncHandler(async (req, res) => {
    const appointmentId = parseId(req.params.id);
    const payload = appointmentStatusSchema.parse(req.body);

    const updatedAppointment = await prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: payload.status },
    });

    res.json(updatedAppointment);
  }),
);

app.get(
  "/api/analytics/dashboard",
  asyncHandler(async (_req, res) => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [
      todaySales,
      monthSales,
      totalProducts,
      inventorySnapshot,
      openAppointments,
      nextAppointments,
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
    ];

    const csvLines = report.sales.map((sale) =>
      [
        csvEscape(sale.id),
        csvEscape(sale.createdAt.toISOString()),
        csvEscape(sale.customerName),
        csvEscape(sale.subtotal),
        csvEscape(sale.discount),
        csvEscape(sale.total),
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
    const [salesReport, inventoryAlerts] = await Promise.all([
      buildSalesReport(daysAgo(30), new Date()),
      prisma.product.findMany({
        where: {
          isActive: true,
          kind: { in: inventoryKinds },
          unit: { not: "servicio" },
        },
        select: { id: true, name: true, stock: true, minStock: true },
      }),
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
      `Ingresos netos ultimos 30 dias: $${salesReport.totalRevenue.toFixed(2)} con ${salesReport.totalSales} ventas.`,
      `Descuentos acumulados: $${salesReport.totalDiscount.toFixed(2)} (${salesReport.discountRatePct.toFixed(2)}% del bruto).`,
      `Utilidad estimada: $${salesReport.estimatedGrossProfit.toFixed(2)} con margen estimado ${salesReport.estimatedMarginPct.toFixed(2)}%.`,
      `Producto mas vendido por unidades: ${topByUnits ? `${topByUnits.productName} (${topByUnits.quantity})` : "sin datos"}.`,
      `Producto de menor rotacion: ${leastByUnits ? `${leastByUnits.productName} (${leastByUnits.quantity})` : "sin datos"}.`,
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
