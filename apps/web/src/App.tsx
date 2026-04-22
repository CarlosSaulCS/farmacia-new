import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import "./App.css";

const defaultApiBaseUrl =
  window.location.protocol === "file:"
    ? "http://127.0.0.1:4000/api"
    : "http://localhost:4000/api";
const API_BASE_URL = import.meta.env.VITE_API_URL ?? defaultApiBaseUrl;
const brandLogoUrl = `${import.meta.env.BASE_URL}logo.png`;

type ModuleKey =
  | "dashboard"
  | "pos"
  | "inventory"
  | "services"
  | "alerts"
  | "appointments"
  | "reports";

type Product = {
  id: number;
  sku: string;
  name: string;
  commercialName: string | null;
  kind: "MEDICATION" | "MEDICAL_SUPPLY" | "MEDICAL_SERVICE";
  description: string | null;
  category: string | null;
  unit: string;
  cost: number;
  price: number;
  stock: number;
  minStock: number;
  expiresAt: string | null;
  isActive: boolean;
};

type SaleItem = {
  id: number;
  productId: number;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  product: Product;
};

type Sale = {
  id: number;
  createdAt: string;
  customerName: string | null;
  notes: string | null;
  subtotal: number;
  discount: number;
  total: number;
  items: SaleItem[];
};

type Appointment = {
  id: number;
  patientId?: number | null;
  patientName: string;
  patientPhone?: string | null;
  serviceType: string;
  notes?: string | null;
  appointmentAt: string;
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED";
  consultation?: {
    id: number;
    followUpAt?: string | null;
    followUpStatus?: "NONE" | "PENDING" | "COMPLETED" | "CANCELLED";
  } | null;
};

type Patient = {
  id: number;
  fullName: string;
  phone?: string | null;
  notes?: string | null;
  lastVisitAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

type Consultation = {
  id: number;
  patientId: number;
  appointmentId?: number | null;
  serviceProductId?: number | null;
  serviceType: string;
  summary?: string | null;
  diagnosis?: string | null;
  treatment?: string | null;
  observations?: string | null;
  followUpAt?: string | null;
  followUpStatus: "NONE" | "PENDING" | "COMPLETED" | "CANCELLED";
  createdAt: string;
  updatedAt: string;
  patient: Patient;
  appointment?: Appointment | null;
  serviceProduct?: Product | null;
};

type PendingFollowUp = {
  id: number;
  patientId: number;
  patientName: string;
  patientPhone?: string | null;
  serviceType: string;
  followUpAt?: string | null;
  status: "NONE" | "PENDING" | "COMPLETED" | "CANCELLED";
  summary?: string | null;
  appointmentId?: number | null;
};

type CashMovement = {
  id: number;
  sessionId: number;
  saleId?: number | null;
  type: "OPENING" | "SALE" | "INCOME" | "EXPENSE" | "ADJUSTMENT" | "CLOSING";
  amount: number;
  reason: string;
  createdAt: string;
};

type CashSession = {
  id: number;
  status: "OPEN" | "CLOSED";
  openingAmount: number;
  expectedAmount: number;
  countedAmount?: number | null;
  difference?: number | null;
  notes?: string | null;
  openedAt: string;
  closedAt?: string | null;
  movements: CashMovement[];
};

type CashOverview = {
  openSession: CashSession | null;
  lastClosedSession: CashSession | null;
};

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
  level: "info" | "warning" | "critical";
  title: string;
  message: string;
  module: "inventory" | "appointments" | "reports" | "pos";
  entityId?: number;
  entityType?: string;
};

type AuditLogEntry = {
  id: number;
  entityType: string;
  entityId?: number | null;
  action: string;
  message: string;
  payload?: unknown;
  createdAt: string;
};

type InventoryLot = {
  id: number;
  productId: number;
  lotCode: string;
  expiresAt?: string | null;
  quantity: number;
  cost: number;
  createdAt: string;
  updatedAt: string;
  product: Pick<Product, "id" | "sku" | "name" | "commercialName" | "kind">;
};

type AssistantResponse = {
  topic: string;
  title: string;
  summary: string;
  bullets: string[];
  records?: unknown;
};

type DashboardSummary = {
  salesToday: number;
  ticketsToday: number;
  sales30Days: number;
  tickets30Days: number;
  totalProducts: number;
  lowStockProducts: number;
  openAppointments: number;
  nextAppointments: Appointment[];
  pendingFollowUpsCount?: number;
  pendingFollowUps?: PendingFollowUp[];
  openCashSession?: CashSession | null;
  lastClosedCashSession?: CashSession | null;
  operationalAlerts?: OperationalAlert[];
};

type InventoryAlert = {
  id: number;
  sku: string;
  name: string;
  commercialName: string | null;
  category: string | null;
  stock: number;
  minStock: number;
  targetStock: number;
  shortage: number;
};

type ExpiryAlert = {
  id: number;
  productId?: number;
  sku: string;
  name: string;
  commercialName: string | null;
  category: string | null;
  lotCode?: string;
  quantity?: number;
  expiresAt: string;
  daysToExpire: number;
  status: "EXPIRED" | "EXPIRING_SOON";
};

type PriceSuggestion = {
  productId: number;
  productName?: string;
  suggestedPrice: number;
  reason: string;
  confidence: number;
  currentCost?: number;
  currentPrice?: number;
  marginPct?: number;
  trigger?: "manual" | "monthly-cutoff" | "cost-increase";
  source: "aion" | "local";
};

type SalesReportTopProduct = {
  productId: number;
  productName: string;
  productCommercialName?: string | null;
  quantity: number;
  revenue: number;
};

type SalesProductPerformance = {
  productId: number;
  sku: string;
  productName: string;
  productCommercialName?: string | null;
  quantity: number;
  revenue: number;
  estimatedCost: number;
  estimatedProfit: number;
  averageUnitPrice: number;
  marginPct: number;
};

type SalesTicketSummary = {
  saleId: number;
  createdAt: string;
  customerName: string | null;
  subtotal: number;
  discount: number;
  total: number;
  amountPaid: number;
  changeGiven: number;
  cashLinked: boolean;
  cashSessionId: number | null;
  itemCount: number;
};

type SalesReport = {
  range: {
    from: string;
    to: string;
  };
  totalSales: number;
  totalItemsSold: number;
  averageItemsPerSale: number;
  grossRevenue: number;
  totalDiscount: number;
  discountRatePct: number;
  totalRevenue: number;
  estimatedTotalCost: number;
  estimatedGrossProfit: number;
  estimatedMarginPct: number;
  averageTicket: number;
  dailySales: Array<{
    date: string;
    totalRevenue: number;
    totalSales: number;
  }>;
  anomalies: Array<{
    type: "SPIKE" | "DROP" | "DISCOUNT" | "LOW_ACTIVITY";
    message: string;
    severity: "info" | "warning" | "critical";
  }>;
  highlights: string[];
  topProducts: SalesReportTopProduct[];
  bestSellingProducts: SalesProductPerformance[];
  leastSellingProducts: SalesProductPerformance[];
  unsoldProducts: SalesProductPerformance[];
  productPerformance: SalesProductPerformance[];
  salesSummary: SalesTicketSummary[];
  cashReconciliation: {
    linkedSales: number;
    linkedSalesTotal: number;
    unlinkedSales: number;
    unlinkedSalesTotal: number;
    cashMovementTotal: number;
    hasDifferences: boolean;
  };
};

type InventoryMovementReportItem = {
  movementId: number;
  productId: number;
  productSku: string;
  productName: string;
  productCommercialName?: string | null;
  change: number;
  reason: string;
  lotCode?: string | null;
  createdAt: string;
  currentStock: number;
  minStock: number;
};

type ReorderPriority = "CRITICAL" | "HIGH" | "MEDIUM";

type ReorderItem = {
  productId: number;
  sku: string;
  name: string;
  commercialName?: string | null;
  kind: Product["kind"];
  category: string | null;
  stock: number;
  minStock: number;
  targetStock: number;
  suggestedOrder: number;
  soldInPeriod: number;
  dailyVelocity: number;
  priority: ReorderPriority;
  criticalityScore: number;
};

type ReorderReport = {
  generatedAt: string;
  range: {
    from: string;
    to: string;
  };
  periodDays: number;
  coverageDays: number;
  totalItems: number;
  totalUnitsSuggested: number;
  highlights: string[];
  items: ReorderItem[];
};

type Notice = {
  kind: "success" | "error" | "info";
  message: string;
};

type CartItem = {
  productId: number;
  sku: string;
  name: string;
  kind: Product["kind"];
  quantity: number;
  unitPrice: number;
  maxStock: number;
};

type MetricTile = {
  label: string;
  value: string;
  helper: string;
  tone?: "accent" | "success" | "warning" | "neutral";
};

const moneyFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 2,
});

const posMoneyFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const datetimeFormatter = new Intl.DateTimeFormat("es-MX", {
  dateStyle: "short",
  timeStyle: "short",
});

function formatProductLabel(name: string, commercialName?: string | null): string {
  const normalizedCommercialName = commercialName?.trim() ?? "";
  return normalizedCommercialName ? `${name} (${normalizedCommercialName})` : name;
}

function reorderPriorityLabel(priority: ReorderPriority): string {
  if (priority === "CRITICAL") {
    return "Critica";
  }
  if (priority === "HIGH") {
    return "Alta";
  }
  return "Media";
}

function normalizeReorderReportParams(days: string, coverage: string) {
  return {
    daysValue: Math.max(1, Math.min(120, parseIntSafe(days, 30))),
    coverageValue: Math.max(1, Math.min(60, parseIntSafe(coverage, 14))),
  };
}

async function exportRestockReportPdf(report: ReorderReport): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new jsPDF({
    orientation: "landscape",
    unit: "pt",
    format: "a4",
  });

  const generatedAtText = datetimeFormatter.format(new Date(report.generatedAt));
  const rangeFromText = report.range.from.slice(0, 10);
  const rangeToText = report.range.to.slice(0, 10);
  const medicationCount = report.items.filter((item) => item.kind === "MEDICATION").length;
  const supplyCount = report.items.filter((item) => item.kind === "MEDICAL_SUPPLY").length;
  const criticalCount = report.items.filter((item) => item.priority === "CRITICAL").length;

  doc.setFillColor(248, 252, 252);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 124, "F");
  doc.setTextColor(9, 47, 70);
  doc.setFontSize(16);
  doc.text("Informe de surtido actualizado", 40, 40);
  doc.setFontSize(10);
  doc.text("Medicamentos y material en stock minimo o por debajo, recalculados desde inventario local.", 40, 58);
  doc.text(`Generado: ${generatedAtText} | Datos recalculados al momento de exportar`, 40, 76);
  doc.text(`Rango analizado: ${rangeFromText} al ${rangeToText}`, 40, 92);
  doc.text(
    `Dias analizados: ${report.periodDays} | Cobertura deseada: ${report.coverageDays} dias`,
    40,
    108,
  );

  const summaryCards = [
    ["Productos", report.totalItems],
    ["Unidades", report.totalUnitsSuggested],
    ["Medicamentos", medicationCount],
    ["Material", supplyCount],
    ["Criticos", criticalCount],
  ];
  summaryCards.forEach(([label, value], index) => {
    const x = 420 + index * 76;
    doc.setDrawColor(207, 224, 229);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x, 34, 66, 50, 10, 10, "FD");
    doc.setFontSize(8);
    doc.setTextColor(91, 111, 127);
    doc.text(String(label), x + 8, 52);
    doc.setFontSize(14);
    doc.setTextColor(9, 47, 70);
    doc.text(String(value), x + 8, 72);
  });

  const bodyRows =
    report.items.length > 0
      ? report.items.map((item, index) => [
          String(index + 1),
          item.sku,
          formatProductLabel(item.name, item.commercialName),
          item.commercialName ?? "-",
          item.category ?? "-",
          productKindLabel(item.kind),
          String(item.stock),
          String(item.minStock),
          String(item.targetStock),
          String(item.suggestedOrder),
          String(item.soldInPeriod),
          item.dailyVelocity.toFixed(2),
          reorderPriorityLabel(item.priority),
        ])
      : [["-", "-", "Sin productos para surtir", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-"]];

  autoTable(doc, {
    startY: 138,
    head: [[
      "#",
      "SKU",
      "Producto",
      "Comercial",
      "Categoria",
      "Tipo",
      "Stock",
      "Min",
      "Objetivo",
      "Surtir",
      "Vend.",
      "Vel/Dia",
      "Prioridad",
    ]],
    body: bodyRows,
    theme: "striped",
    styles: {
      fontSize: 7.5,
      cellPadding: 4,
      overflow: "linebreak",
      textColor: [9, 47, 70],
      lineColor: [220, 232, 236],
    },
    headStyles: {
      fillColor: [10, 116, 142],
      textColor: [255, 255, 255],
      fontStyle: "bold",
    },
    alternateRowStyles: { fillColor: [248, 252, 252] },
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 64 },
      2: { cellWidth: 145 },
      3: { cellWidth: 80 },
      4: { cellWidth: 72 },
      5: { cellWidth: 58 },
      6: { cellWidth: 34, halign: "right" },
      7: { cellWidth: 30, halign: "right" },
      8: { cellWidth: 38, halign: "right" },
      9: { cellWidth: 38, halign: "right", fontStyle: "bold" },
      10: { cellWidth: 36, halign: "right" },
      11: { cellWidth: 38, halign: "right" },
      12: { cellWidth: 52 },
    },
    didDrawPage: ({ pageNumber }) => {
      doc.setFontSize(9);
      doc.setTextColor(91, 111, 127);
      doc.text(
        `Pagina ${pageNumber}`,
        doc.internal.pageSize.getWidth() - 90,
        doc.internal.pageSize.getHeight() - 16,
      );
    },
  });

  const tableFinalY =
    (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 138;
  const highlightsStartY = Math.min(tableFinalY + 24, doc.internal.pageSize.getHeight() - 84);
  if (report.highlights.length > 0 && highlightsStartY < doc.internal.pageSize.getHeight() - 44) {
    doc.setFontSize(10);
    doc.setTextColor(9, 47, 70);
    doc.text("Resumen operativo", 40, highlightsStartY);
    doc.setFontSize(8.5);
    doc.setTextColor(91, 111, 127);
    report.highlights.slice(0, 4).forEach((item, index) => {
      doc.text(`- ${item}`, 40, highlightsStartY + 16 + index * 13);
    });
  }

  const fileDate = new Date().toISOString().slice(0, 10);
  doc.save(`reporte-surtido-${fileDate}.pdf`);
}

const moduleOptions: Array<{
  key: ModuleKey;
  label: string;
  description: string;
}> = [
  {
    key: "dashboard",
    label: "Centro",
    description: "Estado operativo, ventas y lectura inteligente.",
  },
  {
    key: "pos",
    label: "Punto De Venta",
    description: "Cobro rapido con ticket, cambio y servicios.",
  },
  {
    key: "inventory",
    label: "Inventario",
    description: "Altas, ajustes y control de surtido con caducidad.",
  },
  {
    key: "services",
    label: "Servicios",
    description: "Servicios usados en POS y agenda clinica.",
  },
  {
    key: "alerts",
    label: "Alertas",
    description: "Faltantes y proximos vencimientos en un solo lugar.",
  },
  {
    key: "appointments",
    label: "Citas",
    description: "Programacion, seguimiento y cambio de estados.",
  },
  {
    key: "reports",
    label: "Reportes",
    description: "Ventas, surtido, exportaciones y respaldo local.",
  },
];

const medicationCategoryOptions = [
  "Antibioticos",
  "Cronicos",
  "Analgesicos y antiinflamatorios",
  "Alergias y respiratorio",
  "Gastrointestinal",
  "Medicamentos generales",
];

const medicationCategoryRank = new Map(
  medicationCategoryOptions.map((category, index) => [category, index]),
);

function MetricTiles({
  items,
  className = "",
}: {
  items: MetricTile[];
  className?: string;
}) {
  const classes = ["kpi-grid", className].filter(Boolean).join(" ");

  return (
    <div className={classes}>
      {items.map((item) => (
        <article
          key={item.label}
          className={`kpi-card ${item.tone ? `tone-${item.tone}` : ""}`}
        >
          <p className="kpi-label">{item.label}</p>
          <p className="kpi-value">{item.value}</p>
          <p className="kpi-helper">{item.helper}</p>
        </article>
      ))}
    </div>
  );
}

function productKindLabel(kind: Product["kind"]): string {
  if (kind === "MEDICAL_SUPPLY") {
    return "Material quirurgico";
  }
  if (kind === "MEDICAL_SERVICE") {
    return "Servicio medico";
  }
  return "Medicamento";
}

function appointmentStatusLabel(status: Appointment["status"]): string {
  if (status === "COMPLETED") {
    return "Completada";
  }
  if (status === "CANCELLED") {
    return "Cancelada";
  }
  return "Programada";
}

function defaultCategoryForKind(kind: Product["kind"]): string {
  if (kind === "MEDICAL_SUPPLY") {
    return "Material quirurgico";
  }
  if (kind === "MEDICAL_SERVICE") {
    return "Servicio medico";
  }
  return "Medicamentos generales";
}

function inferProductCategory(name: string, kind: Product["kind"]): string {
  if (kind !== "MEDICATION") {
    return defaultCategoryForKind(kind);
  }

  const normalized = normalizeText(name);
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

function productCategorySortValue(product: Product): number {
  if (product.kind === "MEDICAL_SUPPLY") {
    return medicationCategoryOptions.length + 1;
  }
  if (product.kind === "MEDICAL_SERVICE") {
    return medicationCategoryOptions.length + 2;
  }

  return medicationCategoryRank.get(product.category ?? "") ?? medicationCategoryOptions.length;
}

function defaultUnitForKind(kind: Product["kind"]): string {
  if (kind === "MEDICAL_SUPPLY") {
    return "pieza";
  }
  if (kind === "MEDICAL_SERVICE") {
    return "servicio";
  }
  return "caja";
}

function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeSkuToken(value: string): string {
  return stripDiacritics(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function skuPrefixForKind(kind: Product["kind"]): string {
  if (kind === "MEDICAL_SUPPLY") {
    return "INS";
  }
  if (kind === "MEDICAL_SERVICE") {
    return "SER";
  }
  return "MED";
}

function generateSkuSuggestion(name: string, kind: Product["kind"]): string {
  const tokens = stripDiacritics(name)
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) {
    return "";
  }

  const stem = [tokens[0]?.slice(0, 4), tokens[1]?.slice(0, 3), tokens[2]?.slice(0, 3)]
    .filter(Boolean)
    .join("-");

  return normalizeSkuToken(`${skuPrefixForKind(kind)}-${stem}`);
}

function normalizeText(value: string): string {
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
  if (!left) {
    return right.length;
  }
  if (!right) {
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

function inferSmartSearchIntent(query: string) {
  const normalized = normalizeText(query);
  const tokens = uniqueTokens(normalized.split(" "));
  const aliases = new Set<string>(tokens);
  const dictionary: Record<string, string[]> = {
    surtir: ["reabasto", "reponer", "faltante"],
    agotado: ["sin stock"],
    antibiotico: ["amoxicilina", "azitromicina"],
    curacion: ["gasas", "alcohol", "guantes", "jeringa", "inyeccion"],
    caducidad: ["caduca", "vencido", "vencimiento"],
    servicio: ["consulta", "curacion", "nebulizacion"],
  };

  for (const token of tokens) {
    for (const alias of dictionary[token] ?? []) {
      aliases.add(alias);
    }
  }

  return {
    wantsRestock:
      tokens.includes("surtir") || tokens.includes("reabasto") || tokens.includes("faltante"),
    wantsOutOfStock:
      tokens.includes("agotado") || (tokens.includes("sin") && tokens.includes("stock")),
    wantsServices:
      tokens.includes("servicio") || tokens.includes("consulta") || tokens.includes("curacion"),
    wantsExpiring:
      tokens.includes("caducidad") || tokens.includes("vencido") || tokens.includes("caduca"),
    aliases: [...aliases],
  };
}

function scoreProductMatch(product: Product, query: string): number {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) {
    return 0;
  }

  const intent = inferSmartSearchIntent(query);
  const haystack = uniqueTokens([
    normalizeText(product.name),
    normalizeText(product.commercialName ?? ""),
    normalizeText(product.sku),
    normalizeText(product.category ?? ""),
    normalizeText(productKindLabel(product.kind)),
  ]);
  const joined = haystack.join(" ");

  let score = 0;
  if (joined.startsWith(normalizedQuery)) score += 10;
  if (joined.includes(normalizedQuery)) score += 6;

  for (const token of intent.aliases) {
    if (!token) {
      continue;
    }
    if (joined.includes(token)) score += 3;

    for (const hay of haystack) {
      for (const candidate of hay.split(" ").filter(Boolean)) {
        if (candidate.length >= 4 && token.length >= 4 && levenshteinDistance(candidate, token) <= 1) {
          score += 2;
          break;
        }
      }
    }
  }

  if (intent.wantsRestock && product.kind !== "MEDICAL_SERVICE" && product.stock <= product.minStock) {
    score += 10;
  }
  if (intent.wantsOutOfStock && product.kind !== "MEDICAL_SERVICE" && product.stock === 0) {
    score += 12;
  }
  if (intent.wantsServices && product.kind === "MEDICAL_SERVICE") {
    score += 9;
  }
  if (intent.wantsExpiring && Boolean(product.expiresAt)) {
    score += 6;
  }

  return score;
}

function scorePatientMatch(patient: Patient, query: string): number {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) {
    return 0;
  }

  const haystack = `${normalizeText(patient.fullName)} ${normalizeText(patient.phone ?? "")} ${normalizeText(patient.notes ?? "")}`.trim();
  if (haystack.includes(normalizedQuery)) {
    return 8;
  }

  return haystack
    .split(" ")
    .filter(Boolean)
    .some((token) => token.length >= 4 && levenshteinDistance(token, normalizedQuery) <= 1)
    ? 4
    : 0;
}

function localDateTimeValue(date: Date): string {
  const localTimestamp = date.getTime() - date.getTimezoneOffset() * 60_000;
  return new Date(localTimestamp).toISOString().slice(0, 16);
}

function localDateValue(date: Date): string {
  const localTimestamp = date.getTime() - date.getTimezoneOffset() * 60_000;
  return new Date(localTimestamp).toISOString().slice(0, 10);
}

function parseIntSafe(value: string, fallback = 0): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseFloatSafe(value: string, fallback = 0): number {
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function roundToPosAmount(value: number): number {
  return Math.floor(Math.max(0, value));
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      ...init,
    });
  } catch {
    throw new Error(
      "No fue posible conectar con la API local. Reinicia la app de escritorio de Farmacia e intenta de nuevo.",
    );
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: "Error de red" }));
    throw new Error(body.message ?? "No se pudo completar la solicitud.");
  }

  return (await response.json()) as T;
}

function App() {
  const [activeModule, setActiveModule] = useState<ModuleKey>("dashboard");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [services, setServices] = useState<Product[]>([]);
  const [posItems, setPosItems] = useState<Product[]>([]);
  const [alerts, setAlerts] = useState<InventoryAlert[]>([]);
  const [expiryAlerts, setExpiryAlerts] = useState<ExpiryAlert[]>([]);
  const [expirationThresholdDays, setExpirationThresholdDays] = useState(45);
  const [appointmentReminderMinutes, setAppointmentReminderMinutes] = useState(60);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [inventoryLots, setInventoryLots] = useState<InventoryLot[]>([]);
  const [operationalAlerts, setOperationalAlerts] = useState<OperationalAlert[]>([]);
  const [cashOverview, setCashOverview] = useState<CashOverview>({
    openSession: null,
    lastClosedSession: null,
  });
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);

  const [insights, setInsights] = useState<string[]>([]);
  const [insightSource, setInsightSource] = useState<"aion" | "local">("local");
  const [marketShift, setMarketShift] = useState(0);
  const [suggestions, setSuggestions] = useState<PriceSuggestion[]>([]);
  const [suggestionSource, setSuggestionSource] = useState<"aion" | "local">("local");
  const [assistantQuery, setAssistantQuery] = useState("");
  const [assistantResponse, setAssistantResponse] = useState<AssistantResponse | null>(null);
  const [runningAssistant, setRunningAssistant] = useState(false);

  const [posSearch, setPosSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [saleNotes, setSaleNotes] = useState("");
  const [saleDiscountPercent, setSaleDiscountPercent] = useState("0");
  const [amountPaid, setAmountPaid] = useState("");
  const [submittingSale, setSubmittingSale] = useState(false);
  const [cashOpeningAmount, setCashOpeningAmount] = useState("0");
  const [cashOpeningNotes, setCashOpeningNotes] = useState("");
  const [cashMovementType, setCashMovementType] = useState<"INCOME" | "EXPENSE" | "ADJUSTMENT">("INCOME");
  const [cashMovementAmount, setCashMovementAmount] = useState("");
  const [cashMovementReason, setCashMovementReason] = useState("");
  const [cashCountedAmount, setCashCountedAmount] = useState("");
  const [cashClosingNotes, setCashClosingNotes] = useState("");
  const [processingCash, setProcessingCash] = useState(false);

  const [inventoryFilter, setInventoryFilter] = useState("");
  const [serviceFilter, setServiceFilter] = useState("");
  const [newProduct, setNewProduct] = useState({
    sku: "",
    name: "",
    commercialName: "",
    kind: "MEDICATION" as Product["kind"],
    unit: "caja",
    cost: "",
    price: "",
    stock: "",
    minStock: "",
    expiresAt: "",
    lotCode: "",
    category: "Medicamentos generales",
    description: "",
  });
  const [newProductSkuManuallyEdited, setNewProductSkuManuallyEdited] = useState(false);
  const [newService, setNewService] = useState({
    sku: "",
    name: "",
    price: "",
    description: "",
  });
  const [newServiceSkuManuallyEdited, setNewServiceSkuManuallyEdited] = useState(false);
  const [creatingProduct, setCreatingProduct] = useState(false);
  const [creatingService, setCreatingService] = useState(false);
  const [editServiceId, setEditServiceId] = useState("");
  const [editServicePrice, setEditServicePrice] = useState("");
  const [editServiceDescription, setEditServiceDescription] = useState("");
  const [editServiceActive, setEditServiceActive] = useState(true);
  const [savingServiceChanges, setSavingServiceChanges] = useState(false);
  const [serviceQuickId, setServiceQuickId] = useState("");
  const [serviceQuickPrice, setServiceQuickPrice] = useState("");
  const [updatingServiceQuick, setUpdatingServiceQuick] = useState(false);

  const [stockProductId, setStockProductId] = useState("");
  const [stockCost, setStockCost] = useState("");
  const [stockTarget, setStockTarget] = useState("");
  const [stockChange, setStockChange] = useState("");
  const [stockReason, setStockReason] = useState("Correccion de inventario fisico");
  const [stockLotCode, setStockLotCode] = useState("");
  const [stockLotExpiresAt, setStockLotExpiresAt] = useState("");
  const [adjustingStock, setAdjustingStock] = useState(false);

  const [editProductId, setEditProductId] = useState("");
  const [editProductName, setEditProductName] = useState("");
  const [editCommercialName, setEditCommercialName] = useState("");
  const [editCategory, setEditCategory] = useState("Medicamentos generales");
  const [editCost, setEditCost] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editMinStock, setEditMinStock] = useState("");
  const [editExpiresAt, setEditExpiresAt] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [savingProductChanges, setSavingProductChanges] = useState(false);
  const [deletingProduct, setDeletingProduct] = useState(false);
  const [runningMonthlyCutoff, setRunningMonthlyCutoff] = useState(false);

  const [appointmentStatusFilter, setAppointmentStatusFilter] = useState<
    "ALL" | "SCHEDULED" | "COMPLETED" | "CANCELLED"
  >("ALL");
  const [appointmentDateFilter, setAppointmentDateFilter] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [appointmentForm, setAppointmentForm] = useState({
    patientName: "",
    patientPhone: "",
    serviceType: "Consulta General",
    appointmentAt: localDateTimeValue(new Date(Date.now() + 60 * 60 * 1000)),
    notes: "",
  });
  const [savingAppointment, setSavingAppointment] = useState(false);
  const [patientSearch, setPatientSearch] = useState("");
  const [consultationForm, setConsultationForm] = useState({
    patientId: "",
    appointmentId: "",
    serviceProductId: "",
    serviceType: "Consulta General",
    summary: "",
    diagnosis: "",
    treatment: "",
    observations: "",
    followUpAt: "",
  });
  const [savingConsultation, setSavingConsultation] = useState(false);

  const [reportRange, setReportRange] = useState({
    from: localDateValue(daysAgo(30)),
    to: localDateValue(new Date()),
  });
  const [reportDays, setReportDays] = useState("30");
  const [coverageDays, setCoverageDays] = useState("14");
  const [loadingReports, setLoadingReports] = useState(false);
  const [generatingRestockPdf, setGeneratingRestockPdf] = useState(false);
  const [salesReport, setSalesReport] = useState<SalesReport | null>(null);
  const [reorderReport, setReorderReport] = useState<ReorderReport | null>(null);
  const [inventoryMovementsReport, setInventoryMovementsReport] = useState<
    InventoryMovementReportItem[]
  >([]);
  const [lastReportsLoadedAt, setLastReportsLoadedAt] = useState<Date | null>(null);
  const [lastBackupPath, setLastBackupPath] = useState("");
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);

  const deferredPosSearch = useDeferredValue(posSearch);
  const deferredInventoryFilter = useDeferredValue(inventoryFilter);
  const deferredServiceFilter = useDeferredValue(serviceFilter);

  function showError(error: unknown, fallback: string) {
    setNotice({
      kind: "error",
      message: error instanceof Error ? error.message : fallback,
    });
  }

  const refreshCoreData = useCallback(async () => {
    setLoadingData(true);
    try {
      const [
        dashboard,
        productsData,
        servicesData,
        posCatalog,
        inventoryAlerts,
        appointmentData,
        patientsData,
        consultationsData,
        lotsData,
        cashData,
      ] = await Promise.all([
        apiRequest<DashboardSummary>("/analytics/dashboard"),
        apiRequest<Product[]>("/products"),
        apiRequest<Product[]>("/products?kind=MEDICAL_SERVICE"),
        apiRequest<Product[]>("/pos/items"),
        apiRequest<{
          alerts: InventoryAlert[];
          expiringAlerts: ExpiryAlert[];
          expirationThresholdDays: number;
          appointmentReminderMinutes?: number;
          operationalAlerts?: OperationalAlert[];
        }>("/inventory/alerts"),
        apiRequest<Appointment[]>("/appointments"),
        apiRequest<Patient[]>("/patients"),
        apiRequest<Consultation[]>("/consultations"),
        apiRequest<InventoryLot[]>("/inventory/lots"),
        apiRequest<CashOverview>("/cash/current"),
      ]);
      const [operationsResult, insightsResult, pricingResult] = await Promise.allSettled([
        apiRequest<{ total: number; alerts: OperationalAlert[] }>("/operations/alerts"),
        apiRequest<{ source: "aion" | "local"; insights: string[] }>(
          "/ai/business-insights",
        ),
        apiRequest<{ source: "aion" | "local"; suggestions: PriceSuggestion[] }>(
          `/ai/price-adjustments?marketShift=${marketShift}`,
        ),
      ]);

      setSummary(dashboard);
      setProducts(productsData);
      setServices(servicesData);
      setPosItems(posCatalog);
      setAlerts(inventoryAlerts.alerts);
      setExpiryAlerts(inventoryAlerts.expiringAlerts);
      setExpirationThresholdDays(inventoryAlerts.expirationThresholdDays);
      setAppointmentReminderMinutes(inventoryAlerts.appointmentReminderMinutes ?? 60);
      setAppointments(appointmentData);
      if (insightsResult.status === "fulfilled") {
        setInsights(insightsResult.value.insights);
        setInsightSource(insightsResult.value.source);
      }
      setPatients(patientsData);
      setConsultations(consultationsData);
      setInventoryLots(lotsData);
      setOperationalAlerts(
        operationsResult.status === "fulfilled"
          ? operationsResult.value.alerts
          : dashboard.operationalAlerts ?? inventoryAlerts.operationalAlerts ?? [],
      );
      setCashOverview(cashData);
      if (pricingResult.status === "fulfilled") {
        setSuggestions(pricingResult.value.suggestions.slice(0, 10));
        setSuggestionSource(pricingResult.value.source);
      }
      setLastSyncAt(new Date());
    } catch (error) {
      showError(error, "No fue posible cargar la informacion principal.");
    } finally {
      setLoadingData(false);
    }
  }, [marketShift]);

  useEffect(() => {
    void refreshCoreData();
  }, [refreshCoreData]);

  useEffect(() => {
    if (!stockProductId && products.length > 0) {
      setStockProductId(String(products[0].id));
    }
    if (!editProductId && products.length > 0) {
      setEditProductId(String(products[0].id));
    }
  }, [products, stockProductId, editProductId]);

  useEffect(() => {
    if (!editServiceId && services.length > 0) {
      setEditServiceId(String(services[0].id));
    }
  }, [editServiceId, services]);

  useEffect(() => {
    if (!serviceQuickId && services.length > 0) {
      setServiceQuickId(String(services[0].id));
    }
  }, [serviceQuickId, services]);

  useEffect(() => {
    if (!consultationForm.patientId && patients.length > 0) {
      setConsultationForm((current) => ({
        ...current,
        patientId: String(patients[0].id),
      }));
    }
  }, [consultationForm.patientId, patients]);

  useEffect(() => {
    if (!consultationForm.serviceProductId && services.length > 0) {
      setConsultationForm((current) => ({
        ...current,
        serviceProductId: String(services[0].id),
      }));
    }
  }, [consultationForm.serviceProductId, services]);

  useEffect(() => {
    if (!editProductId) {
      return;
    }

    const selectedProduct = products.find((product) => product.id === Number(editProductId));
    if (!selectedProduct) {
      return;
    }

    setEditProductName(selectedProduct.name);
    setEditCommercialName(selectedProduct.commercialName ?? "");
    setEditCategory(
      selectedProduct.category ?? inferProductCategory(selectedProduct.name, selectedProduct.kind),
    );
    setEditCost(String(selectedProduct.cost));
    setEditPrice(String(selectedProduct.price));
    setEditMinStock(String(selectedProduct.minStock));
    setEditExpiresAt(selectedProduct.expiresAt ? selectedProduct.expiresAt.slice(0, 10) : "");
    setEditActive(selectedProduct.isActive);
  }, [editProductId, products]);

  useEffect(() => {
    if (!editServiceId) {
      return;
    }

    const selectedService = services.find((service) => service.id === Number(editServiceId));
    if (!selectedService) {
      return;
    }

    setEditServicePrice(String(selectedService.price));
    setEditServiceDescription(selectedService.description ?? "");
    setEditServiceActive(selectedService.isActive);
  }, [editServiceId, services]);

  useEffect(() => {
    if (!serviceQuickId) {
      return;
    }

    const selectedService = services.find((service) => service.id === Number(serviceQuickId));
    if (!selectedService) {
      return;
    }

    setServiceQuickPrice(String(selectedService.price));
  }, [serviceQuickId, services]);

  useEffect(() => {
    if (newProductSkuManuallyEdited) {
      return;
    }

    const suggestedSku = generateSkuSuggestion(newProduct.name, newProduct.kind);
    setNewProduct((current) => ({ ...current, sku: suggestedSku }));
  }, [newProduct.kind, newProduct.name, newProductSkuManuallyEdited]);

  useEffect(() => {
    if (newServiceSkuManuallyEdited) {
      return;
    }

    const suggestedSku = generateSkuSuggestion(newService.name, "MEDICAL_SERVICE");
    setNewService((current) => ({ ...current, sku: suggestedSku }));
  }, [newService.name, newServiceSkuManuallyEdited]);

  const totalShortage = useMemo(
    () => alerts.reduce((acc, item) => acc + Math.max(0, item.shortage), 0),
    [alerts],
  );

  const posProducts = useMemo(() => {
    const query = normalizeText(deferredPosSearch);
    const intent = inferSmartSearchIntent(deferredPosSearch);
    return posItems
      .filter((product) => product.isActive)
      .map((product) => ({
        product,
        relevance: query ? scoreProductMatch(product, deferredPosSearch) : 0,
      }))
      .filter(({ product, relevance }) => {
        if (!query) {
          return true;
        }
        if (intent.wantsServices) {
          return product.kind === "MEDICAL_SERVICE";
        }
        if (intent.wantsRestock) {
          return product.kind !== "MEDICAL_SERVICE" && product.stock <= product.minStock;
        }
        if (intent.wantsOutOfStock) {
          return product.kind !== "MEDICAL_SERVICE" && product.stock === 0;
        }
        return relevance > 0;
      })
      .sort((left, right) =>
        right.relevance - left.relevance ||
        productCategorySortValue(left.product) - productCategorySortValue(right.product) ||
        left.product.name.localeCompare(right.product.name),
      )
      .map(({ product }) => product);
  }, [deferredPosSearch, posItems]);

  const filteredInventory = useMemo(() => {
    const query = normalizeText(deferredInventoryFilter);
    const intent = inferSmartSearchIntent(deferredInventoryFilter);
    return products
      .map((product) => ({
        product,
        relevance: query ? scoreProductMatch(product, deferredInventoryFilter) : 0,
      }))
      .filter(({ product, relevance }) => {
        if (!query) {
          return true;
        }
        if (intent.wantsRestock) {
          return product.stock <= product.minStock;
        }
        if (intent.wantsOutOfStock) {
          return product.stock === 0;
        }
        if (intent.wantsExpiring) {
          return Boolean(product.expiresAt);
        }
        return relevance > 0;
      })
      .sort((left, right) =>
        right.relevance - left.relevance ||
        productCategorySortValue(left.product) - productCategorySortValue(right.product) ||
        left.product.name.localeCompare(right.product.name),
      )
      .map(({ product }) => product);
  }, [deferredInventoryFilter, products]);

  const filteredServices = useMemo(() => {
    const query = normalizeText(deferredServiceFilter);
    return services
      .map((product) => ({
        product,
        relevance: query ? scoreProductMatch(product, deferredServiceFilter) : 0,
      }))
      .filter(({ relevance }) => !query || relevance > 0)
      .sort((left, right) =>
        right.relevance - left.relevance || left.product.name.localeCompare(right.product.name),
      )
      .map(({ product }) => product);
  }, [deferredServiceFilter, services]);

  const filteredAppointments = useMemo(() => {
    return appointments
      .filter((appointment) => {
        if (appointmentStatusFilter === "ALL") {
          return true;
        }
        return appointment.status === appointmentStatusFilter;
      })
      .filter((appointment) => {
        if (!appointmentDateFilter) {
          return true;
        }
        return appointment.appointmentAt.slice(0, 10) === appointmentDateFilter;
      })
      .sort((a, b) => a.appointmentAt.localeCompare(b.appointmentAt));
  }, [appointments, appointmentDateFilter, appointmentStatusFilter]);

  const filteredPatients = useMemo(() => {
    const query = normalizeText(patientSearch);
    return patients
      .map((patient) => ({
        patient,
        relevance: query ? scorePatientMatch(patient, patientSearch) : 0,
      }))
      .filter(({ relevance }) => !query || relevance > 0)
      .sort((left, right) =>
        right.relevance - left.relevance || left.patient.fullName.localeCompare(right.patient.fullName),
      )
      .map(({ patient }) => patient);
  }, [patientSearch, patients]);

  const pendingFollowUps = useMemo(
    () =>
      consultations
        .filter((consultation) => consultation.followUpStatus === "PENDING" && consultation.followUpAt)
        .sort((a, b) => (a.followUpAt ?? "").localeCompare(b.followUpAt ?? "")),
    [consultations],
  );

  const selectedLots = useMemo(() => {
    if (!stockProductId) {
      return inventoryLots;
    }

    return inventoryLots.filter((lot) => lot.productId === Number(stockProductId));
  }, [inventoryLots, stockProductId]);

  const selectedStockProduct = useMemo(
    () => products.find((product) => product.id === Number(stockProductId)) ?? null,
    [products, stockProductId],
  );

  const selectedEditProduct = useMemo(
    () => products.find((product) => product.id === Number(editProductId)) ?? null,
    [editProductId, products],
  );

  const selectedEditService = useMemo(
    () => services.find((service) => service.id === Number(editServiceId)) ?? null,
    [editServiceId, services],
  );

  const selectedQuickService = useMemo(
    () => services.find((service) => service.id === Number(serviceQuickId)) ?? null,
    [serviceQuickId, services],
  );

  const cartSubtotalRaw = useMemo(
    () =>
      cart.reduce(
        (sum, item) => sum + item.unitPrice * item.quantity,
        0,
      ),
    [cart],
  );

  const cartSubtotal = roundToPosAmount(cartSubtotalRaw);

  const discountPercent = Math.min(
    100,
    Math.max(0, parseFloatSafe(saleDiscountPercent, 0)),
  );
  const discountValue = roundToPosAmount((cartSubtotal * discountPercent) / 100);
  const cartTotal = Math.max(0, cartSubtotal - discountValue);
  const amountPaidValue = roundToPosAmount(parseFloatSafe(amountPaid, 0));
  const changeDue = Math.max(0, amountPaidValue - cartTotal);
  const pendingAmount = Math.max(0, cartTotal - amountPaidValue);
  const backendDiscountValue = Number(
    Math.max(0, cartSubtotalRaw - cartTotal).toFixed(2),
  );

  const activeInventoryCount = useMemo(
    () => products.filter((product) => product.isActive).length,
    [products],
  );
  const activeServiceCount = useMemo(
    () => services.filter((service) => service.isActive).length,
    [services],
  );
  const expiredAlertsCount = useMemo(
    () => expiryAlerts.filter((alert) => alert.status === "EXPIRED").length,
    [expiryAlerts],
  );
  const todayDate = localDateValue(new Date());
  const todayAppointmentsCount = useMemo(
    () =>
      appointments.filter((appointment) => appointment.appointmentAt.slice(0, 10) === todayDate)
        .length,
    [appointments, todayDate],
  );
  const activeOperationalAlertsCount = operationalAlerts.length;
  const currentCashBalance = cashOverview.openSession?.expectedAmount ?? 0;
  const lastCashDifference = cashOverview.lastClosedSession?.difference ?? 0;

  function addProductToCart(product: Product) {
    const isService = product.kind === "MEDICAL_SERVICE";
    const productLabel = formatProductLabel(product.name, product.commercialName);

    if (!isService && product.stock <= 0) {
      setNotice({ kind: "error", message: `Sin stock disponible para ${productLabel}.` });
      return;
    }

    const existing = cart.find((item) => item.productId === product.id);
    if (!isService && existing && existing.quantity >= existing.maxStock) {
      setNotice({
        kind: "error",
        message: `No puedes superar el stock actual de ${productLabel}.`,
      });
      return;
    }

    setCart((current) => {
      const index = current.findIndex((item) => item.productId === product.id);
      if (index < 0) {
        return [
          ...current,
          {
            productId: product.id,
            sku: product.sku,
            name: productLabel,
            kind: product.kind,
            quantity: 1,
            unitPrice: product.price,
            maxStock: isService ? 999 : product.stock,
          },
        ];
      }

      const next = [...current];
      next[index] = {
        ...next[index],
        quantity: next[index].quantity + 1,
      };
      return next;
    });
  }

  function updateCartQuantity(productId: number, quantity: number) {
    setCart((current) =>
      current
        .map((item) => {
          if (item.productId !== productId) {
            return item;
          }
          const bounded = Math.max(1, Math.min(item.maxStock, quantity));
          return { ...item, quantity: bounded };
        })
        .filter((item) => item.quantity > 0),
    );
  }

  function removeFromCart(productId: number) {
    setCart((current) => current.filter((item) => item.productId !== productId));
  }

  async function submitSale(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (cart.length === 0) {
      setNotice({ kind: "error", message: "El ticket esta vacio." });
      return;
    }
    if (!cashOverview.openSession) {
      setNotice({
        kind: "error",
        message: "Abre caja antes de vender para que el ticket entre al corte.",
      });
      return;
    }
    if (pendingAmount > 0) {
      setNotice({
        kind: "error",
        message: `Falta pago por ${posMoneyFormatter.format(pendingAmount)}.`,
      });
      return;
    }

    setSubmittingSale(true);
    try {
      await apiRequest<Sale>("/sales", {
        method: "POST",
        body: JSON.stringify({
          customerName: customerName.trim() || undefined,
          notes: saleNotes.trim() || undefined,
          discount: backendDiscountValue,
          amountPaid: amountPaidValue,
          changeGiven: changeDue,
          items: cart.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
          })),
        }),
      });

      setCart([]);
      setCustomerName("");
      setSaleNotes("");
      setSaleDiscountPercent("0");
      setAmountPaid("");
      setNotice({ kind: "success", message: "Venta registrada correctamente." });
      await refreshCoreData();
    } catch (error) {
      showError(error, "No fue posible completar la venta.");
    } finally {
      setSubmittingSale(false);
    }
  }

  async function submitNewProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const kind = newProduct.kind;
    const cost = parseFloatSafe(newProduct.cost, NaN);
    const price = parseFloatSafe(newProduct.price, NaN);
    const stock = parseIntSafe(newProduct.stock, NaN);
    const minStock = parseIntSafe(newProduct.minStock, NaN);

    if (!newProduct.name.trim()) {
      setNotice({ kind: "error", message: "El nombre del producto es obligatorio." });
      return;
    }
    if (Number.isNaN(cost) || cost < 0) {
      setNotice({ kind: "error", message: "El costo debe ser un numero valido." });
      return;
    }
    if (Number.isNaN(price) || price <= 0) {
      setNotice({ kind: "error", message: "El precio al publico debe ser mayor a 0." });
      return;
    }
    if (price < cost) {
      setNotice({
        kind: "error",
        message: "El precio al publico no puede ser menor al costo.",
      });
      return;
    }
    if (Number.isNaN(stock) || Number.isNaN(minStock) || stock < 0 || minStock < 0) {
      setNotice({
        kind: "error",
        message: "Stock y stock minimo deben ser numeros validos.",
      });
      return;
    }
    if (kind === "MEDICATION" && !newProduct.expiresAt) {
      setNotice({
        kind: "error",
        message: "Debes indicar la fecha de caducidad del medicamento.",
      });
      return;
    }

    setCreatingProduct(true);
    try {
      const categoryCandidate = newProduct.category.trim();
      const inferredCategory = inferProductCategory(newProduct.name, kind);
      const category =
        kind === "MEDICATION" && categoryCandidate === defaultCategoryForKind(kind)
          ? inferredCategory
          : categoryCandidate || inferredCategory;

      await apiRequest<Product>("/products", {
        method: "POST",
        body: JSON.stringify({
          sku: newProduct.sku.trim() || undefined,
          name: newProduct.name.trim(),
          commercialName: newProduct.commercialName.trim() || undefined,
          kind,
          category,
          unit: newProduct.unit.trim() || defaultUnitForKind(kind),
          description: newProduct.description.trim() || undefined,
          cost,
          price,
          stock,
          minStock,
          expiresAt: kind === "MEDICATION" ? newProduct.expiresAt : undefined,
          lotCode: newProduct.lotCode.trim() || undefined,
          isActive: true,
        }),
      });

      setNewProduct({
        sku: "",
        name: "",
        commercialName: "",
        kind: "MEDICATION",
        unit: "caja",
        cost: "",
        price: "",
        stock: "",
        minStock: "",
        expiresAt: "",
        lotCode: "",
        category: "Medicamentos generales",
        description: "",
      });
      setNewProductSkuManuallyEdited(false);
      setNotice({ kind: "success", message: "Producto creado exitosamente." });
      await refreshCoreData();
    } catch (error) {
      showError(error, "No se pudo crear el producto.");
    } finally {
      setCreatingProduct(false);
    }
  }

  async function submitNewService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const price = parseFloatSafe(newService.price, NaN);
    if (!newService.name.trim()) {
      setNotice({ kind: "error", message: "El nombre del servicio es obligatorio." });
      return;
    }
    if (Number.isNaN(price) || price <= 0) {
      setNotice({ kind: "error", message: "El precio del servicio debe ser mayor a 0." });
      return;
    }

    setCreatingService(true);
    try {
      await apiRequest<Product>("/products", {
        method: "POST",
        body: JSON.stringify({
          sku: newService.sku.trim() || undefined,
          name: newService.name.trim(),
          kind: "MEDICAL_SERVICE",
          category: "Servicio medico",
          unit: "servicio",
          description: newService.description.trim() || undefined,
          cost: 0,
          price,
          stock: 0,
          minStock: 0,
          isActive: true,
        }),
      });

      setNewService({
        sku: "",
        name: "",
        price: "",
        description: "",
      });
      setNewServiceSkuManuallyEdited(false);
      setNotice({ kind: "success", message: "Servicio medico registrado." });
      await refreshCoreData();
    } catch (error) {
      showError(error, "No se pudo crear el servicio medico.");
    } finally {
      setCreatingService(false);
    }
  }

  async function submitServiceUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editServiceId) {
      setNotice({ kind: "error", message: "Selecciona un servicio para editar." });
      return;
    }

    const price = parseFloatSafe(editServicePrice, NaN);
    if (Number.isNaN(price) || price <= 0) {
      setNotice({ kind: "error", message: "El precio del servicio editado no es valido." });
      return;
    }

    setSavingServiceChanges(true);
    try {
      await apiRequest<Product>(`/products/${editServiceId}`, {
        method: "PUT",
        body: JSON.stringify({
          kind: "MEDICAL_SERVICE",
          unit: "servicio",
          price,
          description: editServiceDescription.trim() || null,
          isActive: editServiceActive,
        }),
      });

      setNotice({ kind: "success", message: "Servicio medico actualizado." });
      await refreshCoreData();
    } catch (error) {
      showError(error, "No se pudo actualizar el servicio medico.");
    } finally {
      setSavingServiceChanges(false);
    }
  }

  async function submitStockAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stockProductId) {
      setNotice({ kind: "error", message: "Selecciona un producto para ajustar." });
      return;
    }

    const selectedProduct = products.find((product) => product.id === Number(stockProductId));
    if (!selectedProduct) {
      setNotice({ kind: "error", message: "Producto no encontrado para ajuste rapido." });
      return;
    }

    const hasCost = stockCost.trim().length > 0;
    const hasTarget = stockTarget.trim().length > 0;
    const hasChange = stockChange.trim().length > 0;
    if (!hasCost && !hasTarget && !hasChange) {
      setNotice({
        kind: "error",
        message: "Ingresa al menos costo, stock fisico real o cambio de cantidad.",
      });
      return;
    }
    if (hasTarget && hasChange) {
      setNotice({
        kind: "error",
        message: "Usa stock fisico real o cambio por diferencia, no ambos al mismo tiempo.",
      });
      return;
    }

    const nextCost = hasCost ? parseFloatSafe(stockCost, NaN) : null;
    if (hasCost && (nextCost === null || Number.isNaN(nextCost) || nextCost < 0)) {
      setNotice({ kind: "error", message: "El costo rapido no es valido." });
      return;
    }

    const targetStock = hasTarget ? parseIntSafe(stockTarget, NaN) : null;
    if (hasTarget && (targetStock === null || Number.isNaN(targetStock) || targetStock < 0)) {
      setNotice({ kind: "error", message: "El stock fisico real debe ser un numero entero mayor o igual a 0." });
      return;
    }

    const change = hasChange ? parseIntSafe(stockChange, NaN) : 0;
    if (hasChange && (Number.isNaN(change) || change === 0)) {
      setNotice({ kind: "error", message: "El cambio de cantidad debe ser distinto de 0." });
      return;
    }
    const stockWillChange =
      hasTarget && targetStock !== null
        ? targetStock !== selectedProduct.stock
        : hasChange;
    if (!hasCost && hasTarget && targetStock === selectedProduct.stock) {
      setNotice({
        kind: "info",
        message: "El stock fisico ya coincide con el inventario registrado.",
      });
      return;
    }
    if (stockWillChange && !stockReason.trim()) {
      setNotice({ kind: "error", message: "Debes indicar un motivo del ajuste de stock." });
      return;
    }

    setAdjustingStock(true);
    try {
      let autoPriceAligned = false;

      if (hasCost && nextCost !== null) {
        const updatePayload: { cost: number; price?: number } = { cost: nextCost };
        if (selectedProduct.price < nextCost) {
          updatePayload.price = nextCost;
          autoPriceAligned = true;
        }

        await apiRequest<Product>(`/products/${stockProductId}`, {
          method: "PUT",
          body: JSON.stringify(updatePayload),
        });
      }

      if (stockWillChange) {
        await apiRequest<Product>(`/products/${stockProductId}/stock`, {
          method: "PATCH",
          body: JSON.stringify({
            ...(hasTarget && targetStock !== null ? { targetStock } : { change }),
            reason: stockReason.trim(),
            lotCode: stockLotCode.trim() || undefined,
            expiresAt: stockLotExpiresAt || undefined,
          }),
        });
      }

      setStockCost("");
      setStockTarget("");
      setStockChange("");
      setStockReason("Correccion de inventario fisico");
      setStockLotCode("");
      setStockLotExpiresAt("");
      setNotice({
        kind: "success",
        message: autoPriceAligned
          ? "Ajuste rapido aplicado. El precio publico se alineo automaticamente al nuevo costo."
          : "Ajuste rapido aplicado correctamente.",
      });
      await refreshCoreData();
    } catch (error) {
      showError(error, "No se pudo aplicar el ajuste rapido de inventario.");
    } finally {
      setAdjustingStock(false);
    }
  }

  async function submitQuickServiceUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!serviceQuickId) {
      setNotice({ kind: "error", message: "Selecciona un servicio para ajuste rapido." });
      return;
    }

    const selectedService = selectedQuickService;
    if (!selectedService) {
      setNotice({ kind: "error", message: "Servicio no encontrado para ajuste rapido." });
      return;
    }

    const hasPrice = serviceQuickPrice.trim().length > 0;
    if (!hasPrice) {
      setNotice({ kind: "error", message: "Ingresa el precio para actualizar el servicio." });
      return;
    }

    const price = parseFloatSafe(serviceQuickPrice, NaN);

    if (Number.isNaN(price) || price <= 0) {
      setNotice({ kind: "error", message: "El precio rapido del servicio no es valido." });
      return;
    }

    setUpdatingServiceQuick(true);
    try {
      await apiRequest<Product>(`/products/${serviceQuickId}`, {
        method: "PUT",
        body: JSON.stringify({
          kind: "MEDICAL_SERVICE",
          unit: "servicio",
          price,
        }),
      });

      setNotice({ kind: "success", message: "Ajuste rapido de servicio aplicado." });
      await refreshCoreData();
    } catch (error) {
      showError(error, "No se pudo aplicar el ajuste rapido del servicio.");
    } finally {
      setUpdatingServiceQuick(false);
    }
  }

  async function submitProductUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editProductId) {
      setNotice({ kind: "error", message: "Selecciona un producto para editar." });
      return;
    }

    const selectedProduct = products.find((product) => product.id === Number(editProductId));
    if (!selectedProduct) {
      setNotice({ kind: "error", message: "Producto seleccionado no disponible." });
      return;
    }

    const productName = editProductName.trim();
    if (productName.length < 2) {
      setNotice({
        kind: "error",
        message: "El nombre generico o compuesto activo debe tener al menos 2 caracteres.",
      });
      return;
    }

    const cost = parseFloatSafe(editCost, NaN);
    const price = parseFloatSafe(editPrice, NaN);
    const minStock = parseIntSafe(editMinStock, NaN);
    if (Number.isNaN(cost) || cost < 0) {
      setNotice({ kind: "error", message: "El costo editado no es valido." });
      return;
    }
    if (Number.isNaN(price) || price <= 0) {
      setNotice({ kind: "error", message: "El precio editado no es valido." });
      return;
    }
    if (price < cost) {
      setNotice({
        kind: "error",
        message: "El precio al publico no puede ser menor al costo.",
      });
      return;
    }
    if (Number.isNaN(minStock) || minStock < 0) {
      setNotice({ kind: "error", message: "El stock minimo editado no es valido." });
      return;
    }
    if (selectedProduct.kind === "MEDICATION" && !editExpiresAt) {
      setNotice({
        kind: "error",
        message: "La fecha de caducidad es obligatoria para medicamentos.",
      });
      return;
    }

    const costIncreased = cost > selectedProduct.cost;
    const categoryCandidate = editCategory.trim();
    const category =
      selectedProduct.kind === "MEDICATION" &&
      (categoryCandidate === defaultCategoryForKind(selectedProduct.kind) ||
        categoryCandidate === "Medicamento")
        ? inferProductCategory(productName, selectedProduct.kind)
        : categoryCandidate || inferProductCategory(productName, selectedProduct.kind);

    setSavingProductChanges(true);
    try {
      const updated = await apiRequest<
        Product & {
          costIncreaseDetected?: boolean;
          priceReview?: { suggestedPrice: number; reason: string } | null;
        }
      >(`/products/${editProductId}`, {
        method: "PUT",
        body: JSON.stringify({
          name: productName,
          commercialName: editCommercialName.trim() || null,
          category,
          cost,
          price,
          minStock,
          expiresAt:
            selectedProduct.kind === "MEDICATION" ? editExpiresAt : null,
          isActive: editActive,
        }),
      });

      if (updated.costIncreaseDetected && updated.priceReview) {
        setNotice({
          kind: "info",
          message:
            `Costo actualizado. Sugerencia IA: ${moneyFormatter.format(updated.priceReview.suggestedPrice)}. ` +
            updated.priceReview.reason,
        });
        await calculatePriceSuggestions("cost-increase");
      } else {
        setNotice({ kind: "success", message: "Configuracion de producto actualizada." });
      }

      if (costIncreased) {
        setMarketShift(0);
      }
      await refreshCoreData();
    } catch (error) {
      showError(error, "No fue posible actualizar el producto.");
    } finally {
      setSavingProductChanges(false);
    }
  }

  async function deleteSelectedProduct() {
    if (!editProductId) {
      setNotice({ kind: "error", message: "Selecciona un producto para eliminar." });
      return;
    }

    const selectedProduct = products.find((product) => product.id === Number(editProductId));
    if (!selectedProduct) {
      setNotice({ kind: "error", message: "Producto seleccionado no disponible." });
      return;
    }

    const confirmation = window.confirm(
      `Eliminar ${formatProductLabel(selectedProduct.name, selectedProduct.commercialName)}?\n\n` +
        "Si ya tiene ventas historicas, se archivara para conservar reportes y tickets.",
    );
    if (!confirmation) {
      return;
    }

    setDeletingProduct(true);
    try {
      const result = await apiRequest<{ mode: "deleted" | "archived"; message: string }>(
        `/products/${editProductId}`,
        {
          method: "DELETE",
        },
      );

      setNotice({ kind: "success", message: result.message });
      setEditProductId("");
      await refreshCoreData();
    } catch (error) {
      showError(error, "No fue posible eliminar el producto.");
    } finally {
      setDeletingProduct(false);
    }
  }

  async function createAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!appointmentForm.patientName.trim()) {
      setNotice({ kind: "error", message: "El nombre del paciente es obligatorio." });
      return;
    }
    if (!appointmentForm.serviceType.trim()) {
      setNotice({ kind: "error", message: "Debes indicar el tipo de servicio." });
      return;
    }

    const appointmentDate = new Date(appointmentForm.appointmentAt);
    if (Number.isNaN(appointmentDate.getTime())) {
      setNotice({ kind: "error", message: "Fecha y hora de cita invalidas." });
      return;
    }

    setSavingAppointment(true);
    try {
      await apiRequest<Appointment>("/appointments", {
        method: "POST",
        body: JSON.stringify({
          patientName: appointmentForm.patientName.trim(),
          patientPhone: appointmentForm.patientPhone.trim() || undefined,
          serviceType: appointmentForm.serviceType.trim(),
          notes: appointmentForm.notes.trim() || undefined,
          appointmentAt: appointmentDate.toISOString(),
        }),
      });

      setAppointmentForm({
        patientName: "",
        patientPhone: "",
        serviceType: "Consulta General",
        appointmentAt: localDateTimeValue(new Date(Date.now() + 60 * 60 * 1000)),
        notes: "",
      });
      setNotice({ kind: "success", message: "Cita agendada exitosamente." });
      await refreshCoreData();
    } catch (error) {
      showError(error, "No fue posible agendar la cita.");
    } finally {
      setSavingAppointment(false);
    }
  }

  async function updateAppointmentStatus(
    appointmentId: number,
    status: "SCHEDULED" | "COMPLETED" | "CANCELLED",
  ) {
    try {
      await apiRequest<Appointment>(`/appointments/${appointmentId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setNotice({ kind: "success", message: "Estado de cita actualizado." });
      await refreshCoreData();
    } catch (error) {
      showError(error, "No fue posible actualizar la cita.");
    }
  }

  async function createConsultation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!consultationForm.patientId) {
      setNotice({ kind: "error", message: "Selecciona un paciente para registrar la consulta." });
      return;
    }
    if (!consultationForm.serviceType.trim()) {
      setNotice({ kind: "error", message: "El tipo de servicio es obligatorio." });
      return;
    }

    setSavingConsultation(true);
    try {
      await apiRequest<Consultation>("/consultations", {
        method: "POST",
        body: JSON.stringify({
          patientId: Number(consultationForm.patientId),
          appointmentId: consultationForm.appointmentId
            ? Number(consultationForm.appointmentId)
            : undefined,
          serviceProductId: consultationForm.serviceProductId
            ? Number(consultationForm.serviceProductId)
            : undefined,
          serviceType: consultationForm.serviceType.trim(),
          summary: consultationForm.summary.trim() || undefined,
          diagnosis: consultationForm.diagnosis.trim() || undefined,
          treatment: consultationForm.treatment.trim() || undefined,
          observations: consultationForm.observations.trim() || undefined,
          followUpAt: consultationForm.followUpAt
            ? new Date(consultationForm.followUpAt).toISOString()
            : undefined,
        }),
      });

      setConsultationForm((current) => ({
        ...current,
        appointmentId: "",
        summary: "",
        diagnosis: "",
        treatment: "",
        observations: "",
        followUpAt: "",
      }));
      setNotice({ kind: "success", message: "Consulta registrada correctamente." });
      await refreshCoreData();
    } catch (error) {
      showError(error, "No fue posible registrar la consulta.");
    } finally {
      setSavingConsultation(false);
    }
  }

  async function updateConsultationFollowUpStatus(
    consultationId: number,
    status: "NONE" | "PENDING" | "COMPLETED" | "CANCELLED",
  ) {
    try {
      await apiRequest<Consultation>(`/consultations/${consultationId}/follow-up`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setNotice({ kind: "success", message: "Seguimiento actualizado." });
      await refreshCoreData();
    } catch (error) {
      showError(error, "No fue posible actualizar el seguimiento.");
    }
  }

  async function runAssistant(query = assistantQuery) {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      setNotice({ kind: "error", message: "Escribe una consulta para el asistente." });
      return;
    }

    setRunningAssistant(true);
    try {
      const response = await apiRequest<AssistantResponse>("/assistant/query", {
        method: "POST",
        body: JSON.stringify({ query: trimmedQuery }),
      });
      setAssistantQuery(trimmedQuery);
      setAssistantResponse(response);
    } catch (error) {
      showError(error, "No fue posible consultar el asistente interno.");
    } finally {
      setRunningAssistant(false);
    }
  }

  async function openCashSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const openingAmount = parseFloatSafe(cashOpeningAmount, NaN);
    if (Number.isNaN(openingAmount) || openingAmount < 0) {
      setNotice({ kind: "error", message: "El monto de apertura no es valido." });
      return;
    }

    setProcessingCash(true);
    try {
      await apiRequest<CashSession>("/cash/open", {
        method: "POST",
        body: JSON.stringify({
          openingAmount,
          notes: cashOpeningNotes.trim() || undefined,
        }),
      });
      setCashOpeningNotes("");
      setNotice({ kind: "success", message: "Caja abierta correctamente." });
      await refreshCoreData();
    } catch (error) {
      showError(error, "No fue posible abrir la caja.");
    } finally {
      setProcessingCash(false);
    }
  }

  async function registerCashMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = parseFloatSafe(cashMovementAmount, NaN);
    if (Number.isNaN(amount) || amount <= 0) {
      setNotice({ kind: "error", message: "El monto del movimiento no es valido." });
      return;
    }
    if (!cashMovementReason.trim()) {
      setNotice({ kind: "error", message: "Describe el motivo del movimiento." });
      return;
    }

    setProcessingCash(true);
    try {
      await apiRequest<CashMovement>("/cash/movements", {
        method: "POST",
        body: JSON.stringify({
          type: cashMovementType,
          amount,
          reason: cashMovementReason.trim(),
        }),
      });
      setCashMovementAmount("");
      setCashMovementReason("");
      setNotice({ kind: "success", message: "Movimiento de caja registrado." });
      await refreshCoreData();
    } catch (error) {
      showError(error, "No fue posible registrar el movimiento de caja.");
    } finally {
      setProcessingCash(false);
    }
  }

  async function closeCashSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const countedAmount = parseFloatSafe(cashCountedAmount, NaN);
    if (Number.isNaN(countedAmount) || countedAmount < 0) {
      setNotice({ kind: "error", message: "El monto contado no es valido." });
      return;
    }

    setProcessingCash(true);
    try {
      await apiRequest<CashSession>("/cash/close", {
        method: "POST",
        body: JSON.stringify({
          countedAmount,
          notes: cashClosingNotes.trim() || undefined,
        }),
      });
      setCashCountedAmount("");
      setCashClosingNotes("");
      setNotice({ kind: "success", message: "Caja cerrada correctamente." });
      await refreshCoreData();
    } catch (error) {
      showError(error, "No fue posible cerrar la caja.");
    } finally {
      setProcessingCash(false);
    }
  }

  async function calculatePriceSuggestions(
    trigger: "manual" | "monthly-cutoff" | "cost-increase" = "manual",
  ) {
    setLoadingSuggestions(true);
    try {
      const response = await apiRequest<{
        source: "aion" | "local";
        suggestions: PriceSuggestion[];
      }>("/ai/price-adjustments", {
        method: "POST",
        body: JSON.stringify({ marketShift, trigger }),
      });
      setSuggestions(response.suggestions.slice(0, 10));
      setSuggestionSource(response.source);
    } catch (error) {
      showError(error, "No fue posible calcular sugerencias de precio.");
    } finally {
      setLoadingSuggestions(false);
    }
  }

  async function runMonthlyPriceCutoff() {
    setRunningMonthlyCutoff(true);
    try {
      const response = await apiRequest<{
        source: "aion" | "local";
        suggestions: PriceSuggestion[];
      }>("/ai/price-adjustments/monthly", {
        method: "POST",
      });

      setSuggestions(response.suggestions.slice(0, 10));
      setSuggestionSource(response.source);
      setNotice({
        kind: "success",
        message: "Corte mensual de precios generado con IA.",
      });
    } catch (error) {
      showError(error, "No fue posible ejecutar el corte mensual de precios.");
    } finally {
      setRunningMonthlyCutoff(false);
    }
  }

  const loadReports = useCallback(async (): Promise<{
    salesReportData: SalesReport;
    reorderReportData: ReorderReport;
  } | null> => {
    const fromDate = new Date(`${reportRange.from}T00:00:00`);
    const toDate = new Date(`${reportRange.to}T23:59:59`);
    if (
      Number.isNaN(fromDate.getTime()) ||
      Number.isNaN(toDate.getTime()) ||
      fromDate > toDate
    ) {
      setNotice({
        kind: "error",
        message: "Rango de fechas invalido para generar reportes.",
      });
      return null;
    }

    const { daysValue, coverageValue } = normalizeReorderReportParams(
      reportDays,
      coverageDays,
    );

    setLoadingReports(true);
    try {
      const [salesReportData, reorderReportData, movementData, auditData] = await Promise.all([
        apiRequest<SalesReport>(
          `/reports/sales?from=${encodeURIComponent(fromDate.toISOString())}&to=${encodeURIComponent(toDate.toISOString())}`,
        ),
        apiRequest<ReorderReport>(
          `/reports/reorder?days=${daysValue}&coverageDays=${coverageValue}`,
        ),
        apiRequest<{ count: number; movements: InventoryMovementReportItem[] }>(
          "/inventory/movements?take=140",
        ),
        apiRequest<{ count: number; logs: AuditLogEntry[] }>("/audit-log?take=140"),
      ]);
      const aiInsightsResult = await Promise.allSettled([
        apiRequest<{ source: "aion" | "local"; insights: string[] }>(
          "/ai/business-insights",
        ),
      ]);

      setSalesReport(salesReportData);
      setReorderReport(reorderReportData);
      setInventoryMovementsReport(movementData.movements);
      setAuditLogs(auditData.logs);
      setReportDays(String(daysValue));
      setCoverageDays(String(coverageValue));
      if (aiInsightsResult[0].status === "fulfilled") {
        setInsights(aiInsightsResult[0].value.insights);
        setInsightSource(aiInsightsResult[0].value.source);
      }
      setLastReportsLoadedAt(new Date());

      return {
        salesReportData,
        reorderReportData,
      };
    } catch (error) {
      showError(error, "No fue posible generar los reportes solicitados.");
      return null;
    } finally {
      setLoadingReports(false);
    }
  }, [coverageDays, reportDays, reportRange.from, reportRange.to]);

  const loadFreshReorderReport = useCallback(async (): Promise<ReorderReport | null> => {
    const { daysValue, coverageValue } = normalizeReorderReportParams(
      reportDays,
      coverageDays,
    );

    try {
      const reorderReportData = await apiRequest<ReorderReport>(
        `/reports/reorder?days=${daysValue}&coverageDays=${coverageValue}`,
      );

      setReorderReport(reorderReportData);
      setReportDays(String(daysValue));
      setCoverageDays(String(coverageValue));
      setLastReportsLoadedAt(new Date());

      return reorderReportData;
    } catch (error) {
      showError(error, "No fue posible cargar el reporte actualizado de surtido.");
      return null;
    }
  }, [coverageDays, reportDays]);

  async function generateRestockReport() {
    setGeneratingRestockPdf(true);
    try {
      const reorderReportData = await loadFreshReorderReport();
      if (!reorderReportData) {
        return;
      }

      await exportRestockReportPdf(reorderReportData);
      setNotice({
        kind: "success",
        message: "PDF de surtido generado con datos actualizados.",
      });

      const reorderSection = document.getElementById("reorder-report-section");
      reorderSection?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      showError(error, "No fue posible generar el PDF de surtido.");
    } finally {
      setGeneratingRestockPdf(false);
    }
  }

  useEffect(() => {
    if (activeModule !== "reports") {
      return;
    }
    const needsInitialLoad = !salesReport || !reorderReport;
    const needsRefreshAfterSync =
      !!lastSyncAt && (!lastReportsLoadedAt || lastReportsLoadedAt.getTime() < lastSyncAt.getTime());

    if (!needsInitialLoad && !needsRefreshAfterSync) {
      return;
    }

    void loadReports();
  }, [activeModule, lastReportsLoadedAt, lastSyncAt, loadReports, reorderReport, salesReport]);

  function exportSalesCsv() {
    const fromDate = new Date(`${reportRange.from}T00:00:00`);
    const toDate = new Date(`${reportRange.to}T23:59:59`);
    if (
      Number.isNaN(fromDate.getTime()) ||
      Number.isNaN(toDate.getTime()) ||
      fromDate > toDate
    ) {
      setNotice({
        kind: "error",
        message: "Rango de fechas invalido para exportar CSV.",
      });
      return;
    }

    const url = `${API_BASE_URL}/reports/sales.csv?from=${encodeURIComponent(fromDate.toISOString())}&to=${encodeURIComponent(toDate.toISOString())}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function exportDatabaseBackup() {
    try {
      const result = await apiRequest<{ path: string; fileName: string }>(
        "/database/export",
        {
          method: "POST",
        },
      );
      setLastBackupPath(result.path);
      setNotice({
        kind: "success",
        message: `Respaldo generado: ${result.fileName}`,
      });
    } catch (error) {
      showError(error, "No fue posible exportar la base de datos.");
    }
  }

  const runtimeLabel =
    window.location.protocol === "file:" ? "escritorio local" : "vista web local";
  const intelligenceLabel =
    insightSource === "aion" || suggestionSource === "aion" ? "AION conectada" : "IA local";
  const dashboardKpis: MetricTile[] = [
    {
      label: "Ventas hoy",
      value: moneyFormatter.format(summary?.salesToday ?? 0),
      helper: `${summary?.ticketsToday ?? 0} tickets emitidos`,
      tone: "accent",
    },
    {
      label: "Stock critico",
      value: `${alerts.length}`,
      helper: `${totalShortage} unidades por reponer`,
      tone: alerts.length > 0 ? "warning" : "success",
    },
    {
      label: "Citas pendientes",
      value: `${summary?.openAppointments ?? 0}`,
      helper: "consultas y chequeos programados",
      tone: "neutral",
    },
    {
      label: "Seguimientos",
      value: `${summary?.pendingFollowUpsCount ?? pendingFollowUps.length}`,
      helper: "pacientes con revision pendiente",
      tone: (summary?.pendingFollowUpsCount ?? pendingFollowUps.length) > 0 ? "warning" : "success",
    },
    {
      label: "Caja activa",
      value: moneyFormatter.format(currentCashBalance),
      helper: cashOverview.openSession ? "monto esperado en caja" : "sin caja abierta",
      tone: cashOverview.openSession ? "accent" : "neutral",
    },
    {
      label: "Alertas globales",
      value: `${activeOperationalAlertsCount}`,
      helper:
        Math.abs(lastCashDifference) > 0
          ? `ultimo corte con diferencia ${moneyFormatter.format(lastCashDifference)}`
          : "sin descuadres recientes",
      tone: activeOperationalAlertsCount > 0 ? "warning" : "success",
    },
  ];

  return (
    <div className="app-shell">
      <header className="hero-panel">
        <div className="hero-brand">
          <img className="brand-logo" src={brandLogoUrl} alt="Logo de Farmacia" />
          <div className="hero-brand-copy">
            <h1>Farmacia</h1>
            <p className="hero-copy">
              Sistema local para venta, inventario, citas y reportes con una interfaz mas limpia.
            </p>
            <p className="sync-note">
              Ultima actualizacion: {lastSyncAt ? datetimeFormatter.format(lastSyncAt) : "sincronizando"}
            </p>
          </div>
        </div>
        <div className="hero-actions">
          <p className="hero-status">
            {runtimeLabel} · {intelligenceLabel}
          </p>
          <button
            className="refresh-button"
            type="button"
            onClick={() => {
              void refreshCoreData();
            }}
            disabled={loadingData}
          >
            {loadingData ? "Actualizando..." : "Actualizar"}
          </button>
        </div>
      </header>

      {notice && (
        <div className={`notice-banner ${notice.kind}`}>
          <span>{notice.message}</span>
          <button
            type="button"
            className="notice-close"
            onClick={() => setNotice(null)}
            aria-label="Cerrar mensaje"
          >
            x
          </button>
        </div>
      )}

      <div className="workspace-layout">
        <aside className="module-sidebar">
          <div className="sidebar-header">
            <p>Modulos</p>
            <h2>Navegacion</h2>
          </div>
          <nav className="module-nav" aria-label="Navegacion de modulos">
            {moduleOptions.map((module) => (
              <button
                key={module.key}
                type="button"
                className={`module-button ${activeModule === module.key ? "active" : ""}`}
                title={module.description}
                onClick={() => {
                  startTransition(() => setActiveModule(module.key));
                }}
              >
                <span>{module.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <main className="workspace-main">

      {activeModule === "dashboard" && (
        <section className="workspace">
          <div className="module-header">
            <h2>Centro de control</h2>
            <p>Lo esencial del dia en una sola vista.</p>
          </div>

          <MetricTiles items={dashboardKpis} className="module-kpi-grid dashboard-kpi-grid" />

          <div className="dashboard-grid dashboard-primary-grid">
            <article className="surface surface-spotlight">
              <div className="surface-head">
                <div>
                  <h3>Lectura del negocio</h3>
                </div>
                <span className={`status-pill ${insightSource === "aion" ? "accent" : "success"}`}>
                  {insightSource === "aion" ? "AION" : "LOCAL"}
                </span>
              </div>

              <ul className="insight-list spotlight-list">
                {insights.slice(0, 4).map((insight) => (
                  <li key={insight}>{insight}</li>
                ))}
                {insights.length === 0 && <li>Sin analisis disponible.</li>}
              </ul>

              <div className="assistant-panel">
                <div className="surface-head compact">
                  <div>
                    <h3>Asistente interno</h3>
                  </div>
                  <span className="status-pill neutral">LOCAL</span>
                </div>
                <div className="assistant-input-row">
                  <input
                    value={assistantQuery}
                    onChange={(event) => setAssistantQuery(event.target.value)}
                    placeholder="Pregunta algo como: que debo surtir hoy"
                  />
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={() => {
                      void runAssistant();
                    }}
                    disabled={runningAssistant}
                  >
                    {runningAssistant ? "Consultando..." : "Consultar"}
                  </button>
                </div>
                <div className="quick-chip-row">
                  {[
                    "¿Qué productos debo surtir hoy?",
                    "¿Cuáles fueron los más vendidos de la semana?",
                    "Muéstrame pacientes con seguimiento pendiente.",
                    "Resume las ventas del día.",
                  ].map((query) => (
                    <button
                      key={query}
                      type="button"
                      className="ghost-chip"
                      onClick={() => {
                        void runAssistant(query);
                      }}
                    >
                      {query}
                    </button>
                  ))}
                </div>
                {assistantResponse && (
                  <div className="assistant-response">
                    <strong>{assistantResponse.title}</strong>
                    <p>{assistantResponse.summary}</p>
                    <ul className="compact-bullet-list">
                      {assistantResponse.bullets.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <details className="compact-details">
                <summary>Sugerencias de precio</summary>
                <div className="details-content">
                  <div className="control-panel">
                    <p className="muted-line">
                      Ajuste de mercado actual: <strong>{Math.round(marketShift * 100)}%</strong>
                    </p>
                    <div className="range-box">
                      <label htmlFor="market-shift">Variacion esperada del mercado</label>
                      <input
                        id="market-shift"
                        type="range"
                        min={-0.15}
                        max={0.2}
                        step={0.01}
                        value={marketShift}
                        onChange={(event) => setMarketShift(Number(event.target.value))}
                      />
                      <button type="button" onClick={() => void calculatePriceSuggestions()}>
                        {loadingSuggestions ? "Calculando..." : "Calcular"}
                      </button>
                    </div>
                  </div>

                  <div className="suggestion-panel">
                    <div className="surface-head compact">
                      <div>
                        <h3>Sugerencias de margen</h3>
                      </div>
                      <span
                        className={`status-pill ${
                          suggestionSource === "aion" ? "accent" : "success"
                        }`}
                      >
                        {suggestionSource === "aion" ? "AION" : "LOCAL"}
                      </span>
                    </div>
                    <ul className="suggestion-list compact-list">
                      {suggestions.slice(0, 4).map((item) => (
                        <li key={`${item.productId}-${item.suggestedPrice}`}>
                          <div>
                            <strong>{item.productName ?? `Producto #${item.productId}`}</strong>
                            <small>{item.reason}</small>
                          </div>
                          <span>{moneyFormatter.format(item.suggestedPrice)}</span>
                        </li>
                      ))}
                      {suggestions.length === 0 && <li>Sin sugerencias aun.</li>}
                    </ul>
                  </div>
                </div>
              </details>
            </article>

            <article className="surface">
              <div className="surface-head compact">
                <div>
                  <h3>Alertas operativas</h3>
                </div>
              </div>
              <ul className="appointment-list compact-list">
                {operationalAlerts.slice(0, 5).map((alert) => (
                  <li key={alert.id}>
                    <div>
                      <strong>{alert.title}</strong>
                      <small>{alert.message}</small>
                    </div>
                    <span>{alert.level}</span>
                  </li>
                ))}
                {operationalAlerts.length === 0 && <li>Sin alertas por ahora.</li>}
              </ul>
            </article>

            <article className="surface">
              <div className="surface-head compact">
                <div>
                  <h3>Proximas citas</h3>
                </div>
              </div>
              <ul className="appointment-list compact-list">
                {(summary?.nextAppointments ?? []).map((appointment) => (
                  <li key={appointment.id}>
                    <div>
                      <strong>{appointment.patientName}</strong>
                      <small>{appointment.serviceType}</small>
                    </div>
                    <span>{datetimeFormatter.format(new Date(appointment.appointmentAt))}</span>
                  </li>
                ))}
                {(summary?.nextAppointments ?? []).length === 0 && (
                  <li>Sin citas programadas proximamente.</li>
                )}
              </ul>
            </article>

            <article className="surface">
              <div className="surface-head compact">
                <div>
                  <h3>Seguimientos pendientes</h3>
                </div>
              </div>
              <ul className="appointment-list compact-list">
                {pendingFollowUps.slice(0, 5).map((followUp) => (
                  <li key={followUp.id}>
                    <div>
                      <strong>{followUp.patient.fullName}</strong>
                      <small>{followUp.serviceType}</small>
                    </div>
                    <span>{followUp.followUpAt ? followUp.followUpAt.slice(0, 10) : "Pendiente"}</span>
                  </li>
                ))}
                {pendingFollowUps.length === 0 && <li>Sin seguimientos pendientes.</li>}
              </ul>
            </article>
          </div>
        </section>
      )}

      {activeModule === "pos" && (
        <section className="workspace">
          <div className="module-header">
            <h2>Punto de venta</h2>
            <p>Cobro rapido con catalogo y ticket en la misma vista.</p>
          </div>

          <div className="reports-mini-grid pos-cash-grid">
            <article className="surface">
              <div className="surface-head compact">
                <div>
                  <h3>Caja y corte</h3>
                </div>
                <span className={`status-pill ${cashOverview.openSession ? "accent" : "neutral"}`}>
                  {cashOverview.openSession ? "ABIERTA" : "CERRADA"}
                </span>
              </div>
              {cashOverview.openSession ? (
                <>
                  <div className="kpi-grid compact-kpi">
                    <article className="kpi-card">
                      <p className="kpi-label">Apertura</p>
                      <p className="kpi-value">
                        {moneyFormatter.format(cashOverview.openSession.openingAmount)}
                      </p>
                      <p className="kpi-helper">inicio de turno</p>
                    </article>
                    <article className="kpi-card">
                      <p className="kpi-label">Esperado</p>
                      <p className="kpi-value">
                        {moneyFormatter.format(cashOverview.openSession.expectedAmount)}
                      </p>
                      <p className="kpi-helper">monto actual en caja</p>
                    </article>
                  </div>

                  <div className="two-panel-inline">
                    <form className="field-grid" onSubmit={registerCashMovement}>
                      <div className="field-grid two-col">
                        <div className="field-group compact">
                          <label htmlFor="cash-movement-type">Movimiento</label>
                          <select
                            id="cash-movement-type"
                            value={cashMovementType}
                            onChange={(event) =>
                              setCashMovementType(
                                event.target.value as "INCOME" | "EXPENSE" | "ADJUSTMENT",
                              )
                            }
                          >
                            <option value="INCOME">Ingreso</option>
                            <option value="EXPENSE">Egreso</option>
                            <option value="ADJUSTMENT">Ajuste</option>
                          </select>
                        </div>
                        <div className="field-group compact">
                          <label htmlFor="cash-movement-amount">Monto</label>
                          <input
                            id="cash-movement-amount"
                            type="number"
                            min={0}
                            step="0.01"
                            value={cashMovementAmount}
                            onChange={(event) => setCashMovementAmount(event.target.value)}
                          />
                        </div>
                      </div>
                      <div className="field-group compact">
                        <label htmlFor="cash-movement-reason">Motivo</label>
                        <input
                          id="cash-movement-reason"
                          value={cashMovementReason}
                          onChange={(event) => setCashMovementReason(event.target.value)}
                          placeholder="Caja chica, retiro, ajuste..."
                        />
                      </div>
                      <button className="secondary-btn" type="submit" disabled={processingCash}>
                        {processingCash ? "Guardando..." : "Registrar Movimiento"}
                      </button>
                    </form>

                    <form className="field-grid" onSubmit={closeCashSession}>
                      <div className="field-group compact">
                        <label htmlFor="cash-counted">Monto contado</label>
                        <input
                          id="cash-counted"
                          type="number"
                          min={0}
                          step="0.01"
                          value={cashCountedAmount}
                          onChange={(event) => setCashCountedAmount(event.target.value)}
                        />
                      </div>
                      <div className="field-group compact">
                        <label htmlFor="cash-closing-notes">Notas de cierre</label>
                        <input
                          id="cash-closing-notes"
                          value={cashClosingNotes}
                          onChange={(event) => setCashClosingNotes(event.target.value)}
                          placeholder="Observaciones del corte"
                        />
                      </div>
                      <p className="muted-line">
                        Ultimos movimientos: {cashOverview.openSession.movements.length}
                      </p>
                      <button className="primary-btn" type="submit" disabled={processingCash}>
                        {processingCash ? "Cerrando..." : "Cerrar Caja"}
                      </button>
                    </form>
                  </div>
                </>
              ) : (
                <>
                  <p className="muted-line">
                    Abre una caja para llevar corte, detectar descuadres y registrar ingresos o egresos.
                  </p>
                  <form className="field-grid" onSubmit={openCashSession}>
                    <div className="field-grid two-col">
                      <div className="field-group compact">
                        <label htmlFor="cash-opening-amount">Monto inicial</label>
                        <input
                          id="cash-opening-amount"
                          type="number"
                          min={0}
                          step="0.01"
                          value={cashOpeningAmount}
                          onChange={(event) => setCashOpeningAmount(event.target.value)}
                        />
                      </div>
                      <div className="field-group compact">
                        <label htmlFor="cash-opening-notes">Notas</label>
                        <input
                          id="cash-opening-notes"
                          value={cashOpeningNotes}
                          onChange={(event) => setCashOpeningNotes(event.target.value)}
                          placeholder="Turno matutino, fondo inicial..."
                        />
                      </div>
                    </div>
                    <button className="primary-btn" type="submit" disabled={processingCash}>
                      {processingCash ? "Abriendo..." : "Abrir Caja"}
                    </button>
                  </form>
                  {cashOverview.lastClosedSession && (
                    <p className="muted-line">
                      Ultimo corte:
                      {" "}
                      {cashOverview.lastClosedSession.closedAt
                        ? datetimeFormatter.format(new Date(cashOverview.lastClosedSession.closedAt))
                        : "sin fecha"}
                      {" · diferencia "}
                      {moneyFormatter.format(cashOverview.lastClosedSession.difference ?? 0)}
                    </p>
                  )}
                </>
              )}
            </article>
          </div>

          <div className="pos-grid">
            <article className="surface">
              <div className="surface-head compact">
                <div>
                  <h3>Catalogo</h3>
                </div>
              </div>
              <div className="inline-toolbar">
                <label htmlFor="pos-search">Buscar</label>
                <input
                  id="pos-search"
                  value={posSearch}
                  onChange={(event) => setPosSearch(event.target.value)}
                  placeholder="Nombre generico/comercial, SKU o categoria"
                />
              </div>
              <div className="catalog-scroll">
                {posProducts.map((product) => (
                  <div key={product.id} className="catalog-item">
                    <div>
                      <strong>{formatProductLabel(product.name, product.commercialName)}</strong>
                      <small>
                        {product.sku} | {productKindLabel(product.kind)}
                        {product.kind === "MEDICAL_SERVICE"
                          ? ""
                          : ` | stock ${product.stock}`}
                      </small>
                    </div>
                    <div className="catalog-meta">
                      <span>{posMoneyFormatter.format(roundToPosAmount(product.price))}</span>
                      <button
                        type="button"
                        onClick={() => addProductToCart(product)}
                        disabled={product.kind !== "MEDICAL_SERVICE" && product.stock <= 0}
                      >
                        {product.kind !== "MEDICAL_SERVICE" && product.stock <= 0 ? "Sin stock" : "Agregar"}
                      </button>
                    </div>
                  </div>
                ))}
                {posProducts.length === 0 && (
                  <p className="empty-cell">No se encontraron productos activos.</p>
                )}
              </div>
            </article>

            <article className="surface ticket-panel">
              <div className="surface-head compact">
                <div>
                  <h3>Ticket actual</h3>
                </div>
              </div>
              <form className="ticket-form" onSubmit={submitSale}>
                <div className="field-grid two-col">
                  <div className="field-group">
                    <label htmlFor="sale-customer">Cliente</label>
                    <input
                      id="sale-customer"
                      value={customerName}
                      onChange={(event) => setCustomerName(event.target.value)}
                      placeholder="Opcional"
                    />
                  </div>
                  <div className="field-group">
                    <label htmlFor="sale-discount">Descuento (%)</label>
                    <input
                      id="sale-discount"
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={saleDiscountPercent}
                      onChange={(event) => setSaleDiscountPercent(event.target.value)}
                    />
                  </div>
                </div>
                <details className="compact-details">
                  <summary>Notas opcionales</summary>
                  <div className="field-group details-content">
                    <label htmlFor="sale-notes">Notas</label>
                    <textarea
                      id="sale-notes"
                      value={saleNotes}
                      onChange={(event) => setSaleNotes(event.target.value)}
                      rows={2}
                      placeholder="Observaciones del ticket"
                    />
                  </div>
                </details>

                <div className="cart-list">
                  {cart.map((item) => (
                    <div key={item.productId} className="cart-item">
                      <div>
                        <strong>{item.name}</strong>
                        <small>
                          {item.sku} | {productKindLabel(item.kind)}
                        </small>
                      </div>
                      <div className="cart-actions">
                        <input
                          type="number"
                          min={1}
                          max={item.maxStock}
                          aria-label={`Cantidad para ${item.name}`}
                          value={item.quantity}
                          onChange={(event) =>
                            updateCartQuantity(
                              item.productId,
                              parseIntSafe(event.target.value, item.quantity),
                            )
                          }
                        />
                        <span>
                          {posMoneyFormatter.format(
                            roundToPosAmount(item.quantity * item.unitPrice),
                          )}
                        </span>
                        <button
                          className="ghost-btn"
                          type="button"
                          onClick={() => removeFromCart(item.productId)}
                        >
                          Quitar
                        </button>
                      </div>
                    </div>
                  ))}
                  {cart.length === 0 && <p className="empty-cell">Sin items en ticket.</p>}
                </div>

                <div className="field-grid two-col payment-grid">
                  <div className="field-group">
                    <label htmlFor="amount-paid">Pago Con</label>
                    <input
                      id="amount-paid"
                      type="number"
                      min={0}
                      step={1}
                      value={amountPaid}
                      onChange={(event) => setAmountPaid(event.target.value)}
                      placeholder="0"
                    />
                  </div>
                  <div className="field-group">
                    <label htmlFor="change-due">Cambio</label>
                    <input
                      id="change-due"
                      value={posMoneyFormatter.format(changeDue)}
                      readOnly
                    />
                  </div>
                </div>

                <div className="inline-toolbar payment-toolbar">
                  <button
                    className="ghost-btn"
                    type="button"
                    onClick={() => setAmountPaid(String(cartTotal))}
                    disabled={cart.length === 0}
                  >
                    Pago Exacto
                  </button>
                  <p className="muted-line">
                    {pendingAmount > 0
                      ? `Faltan ${posMoneyFormatter.format(pendingAmount)} para completar.`
                      : `Cambio a entregar: ${posMoneyFormatter.format(changeDue)}`}
                  </p>
                </div>

                <div className="totals-box">
                  <p>
                    Subtotal <strong>{posMoneyFormatter.format(cartSubtotal)}</strong>
                  </p>
                  <p>
                    Descuento ({discountPercent.toFixed(0)}%)
                    <strong>-{posMoneyFormatter.format(discountValue)}</strong>
                  </p>
                  <p>
                    Total <strong>{posMoneyFormatter.format(cartTotal)}</strong>
                  </p>
                </div>
                <p className="muted-line compact-note">Totales en pesos enteros (sin centavos).</p>

                <button
                  className="primary-btn"
                  type="submit"
                  disabled={
                    submittingSale ||
                    pendingAmount > 0 ||
                    cart.length === 0 ||
                    !cashOverview.openSession
                  }
                >
                  {submittingSale ? "Procesando venta..." : "Cobrar Y Registrar"}
                </button>
                {!cashOverview.openSession && (
                  <p className="muted-line compact-note">
                    Abre caja antes de cobrar para que la venta quede ligada al corte.
                  </p>
                )}
              </form>
            </article>
          </div>
        </section>
      )}

      {activeModule === "inventory" && (
        <section className="workspace">
          <div className="module-header">
            <h2>Inventario</h2>
            <p>{activeInventoryCount} productos activos para surtido y control.</p>
          </div>

          <div className="inventory-grid">
            <article className="surface">
              <h3>Nuevo producto</h3>
              <form className="field-grid" onSubmit={submitNewProduct}>
                <div className="field-grid two-col">
                  <div className="field-group">
                    <label htmlFor="new-sku">SKU (autogenerado inteligente)</label>
                    <div className="inline-toolbar compact-inline">
                      <input
                        id="new-sku"
                        value={newProduct.sku}
                        onChange={(event) => {
                          const nextSku = event.target.value;
                          setNewProduct((current) => ({ ...current, sku: nextSku }));
                          setNewProductSkuManuallyEdited(nextSku.trim().length > 0);
                        }}
                        placeholder="Se genera con el nombre"
                      />
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => {
                          const suggestedSku = generateSkuSuggestion(newProduct.name, newProduct.kind);
                          setNewProductSkuManuallyEdited(false);
                          setNewProduct((current) => ({ ...current, sku: suggestedSku }));
                        }}
                      >
                        Generar
                      </button>
                    </div>
                  </div>
                  <div className="field-group">
                    <label htmlFor="new-name">Nombre Generico / Composicion</label>
                    <input
                      id="new-name"
                      value={newProduct.name}
                      onChange={(event) => {
                        const nextName = event.target.value;
                        setNewProduct((current) => {
                          const wasAutomaticCategory =
                            current.category === inferProductCategory(current.name, current.kind) ||
                            current.category === defaultCategoryForKind(current.kind);

                          return {
                            ...current,
                            name: nextName,
                            category:
                              current.kind === "MEDICATION" && wasAutomaticCategory
                                ? inferProductCategory(nextName, current.kind)
                                : current.category,
                          };
                        });
                      }}
                      placeholder="Paracetamol 500mg"
                    />
                  </div>
                </div>

                <div className="field-group">
                  <label htmlFor="new-commercial-name">Nombre Comercial (opcional)</label>
                  <input
                    id="new-commercial-name"
                    value={newProduct.commercialName}
                    onChange={(event) =>
                      setNewProduct((current) => ({
                        ...current,
                        commercialName: event.target.value,
                      }))
                    }
                    placeholder="Tempra, Advil, etc."
                  />
                </div>

                <div className="field-grid two-col">
                  <div className="field-group">
                    <label htmlFor="new-kind">Tipo</label>
                    <select
                      id="new-kind"
                      value={newProduct.kind}
                      onChange={(event) => {
                        const kind = event.target.value as Product["kind"];
                        setNewProduct((current) => ({
                          ...current,
                          kind,
                          category:
                            kind === "MEDICATION"
                              ? inferProductCategory(current.name, kind)
                              : defaultCategoryForKind(kind),
                          unit: defaultUnitForKind(kind),
                          expiresAt:
                            kind === "MEDICATION" ? current.expiresAt : "",
                        }));
                      }}
                    >
                      <option value="MEDICATION">Medicamento</option>
                      <option value="MEDICAL_SUPPLY">Material quirurgico</option>
                    </select>
                  </div>
                  <div className="field-group">
                    <label htmlFor="new-unit">Unidad</label>
                    <input
                      id="new-unit"
                      value={newProduct.unit}
                      onChange={(event) =>
                        setNewProduct((current) => ({ ...current, unit: event.target.value }))
                      }
                    />
                  </div>
                </div>

                <div className="field-group">
                  <label htmlFor="new-category">Categoria operativa</label>
                  <select
                    id="new-category"
                    value={newProduct.category}
                    onChange={(event) =>
                      setNewProduct((current) => ({
                        ...current,
                        category: event.target.value,
                      }))
                    }
                    disabled={newProduct.kind !== "MEDICATION"}
                  >
                    {newProduct.kind === "MEDICATION" ? (
                      medicationCategoryOptions.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))
                    ) : (
                      <option value={defaultCategoryForKind(newProduct.kind)}>
                        {defaultCategoryForKind(newProduct.kind)}
                      </option>
                    )}
                  </select>
                </div>

                <div className="field-grid two-col">
                  <div className="field-group">
                    <label htmlFor="new-cost">Costo</label>
                    <input
                      id="new-cost"
                      type="number"
                      min={0}
                      step="0.01"
                      value={newProduct.cost}
                      onChange={(event) =>
                        setNewProduct((current) => ({
                          ...current,
                          cost: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="field-group">
                    <label htmlFor="new-price">Precio Al Publico</label>
                    <input
                      id="new-price"
                      type="number"
                      min={0}
                      step="0.01"
                      value={newProduct.price}
                      onChange={(event) =>
                        setNewProduct((current) => ({
                          ...current,
                          price: event.target.value,
                        }))
                      }
                    />
                  </div>
                </div>

                <div className="field-grid two-col">
                  <div className="field-group">
                    <label htmlFor="new-stock">Stock Inicial</label>
                    <input
                      id="new-stock"
                      type="number"
                      min={0}
                      step={1}
                      value={newProduct.stock}
                      onChange={(event) =>
                        setNewProduct((current) => ({
                          ...current,
                          stock: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="field-group">
                    <label htmlFor="new-min-stock">Stock Minimo</label>
                    <input
                      id="new-min-stock"
                      type="number"
                      min={0}
                      step={1}
                      value={newProduct.minStock}
                      onChange={(event) =>
                        setNewProduct((current) => ({
                          ...current,
                          minStock: event.target.value,
                        }))
                      }
                    />
                  </div>
                </div>

                <div className="field-group">
                  <label htmlFor="new-lot-code">Lote inicial (opcional)</label>
                  <input
                    id="new-lot-code"
                    value={newProduct.lotCode}
                    onChange={(event) =>
                      setNewProduct((current) => ({
                        ...current,
                        lotCode: event.target.value,
                      }))
                    }
                    placeholder="LOTE-2026-01"
                  />
                </div>

                {newProduct.kind === "MEDICATION" && (
                  <div className="field-group">
                    <label htmlFor="new-expires-at">Caducidad</label>
                    <input
                      id="new-expires-at"
                      type="date"
                      value={newProduct.expiresAt}
                      onChange={(event) =>
                        setNewProduct((current) => ({
                          ...current,
                          expiresAt: event.target.value,
                        }))
                      }
                    />
                  </div>
                )}

                <div className="field-group">
                  <label htmlFor="new-description">Descripcion</label>
                  <input
                    id="new-description"
                    value={newProduct.description}
                    onChange={(event) =>
                      setNewProduct((current) => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                    placeholder="Opcional"
                  />
                </div>

                <button className="primary-btn" type="submit" disabled={creatingProduct}>
                  {creatingProduct ? "Guardando..." : "Registrar Producto"}
                </button>
              </form>

              <details className="compact-details">
                <summary>Ajustar stock o costo</summary>
                <form className="field-grid details-content" onSubmit={submitStockAdjustment}>
                  <div className="field-group">
                    <label htmlFor="stock-product">Producto</label>
                    <select
                      id="stock-product"
                      value={stockProductId}
                      onChange={(event) => setStockProductId(event.target.value)}
                    >
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {formatProductLabel(product.name, product.commercialName)} ({product.sku})
                        </option>
                      ))}
                    </select>
                  </div>
                  {selectedStockProduct && (
                    <p className="muted-line compact-note stock-current-note">
                      Stock registrado: <strong>{selectedStockProduct.stock}</strong>
                      {" | "}
                      Minimo: <strong>{selectedStockProduct.minStock}</strong>
                      {" | "}
                      Producto: <strong>{formatProductLabel(selectedStockProduct.name, selectedStockProduct.commercialName)}</strong>
                    </p>
                  )}
                  <div className="field-grid two-col">
                    <div className="field-group">
                      <label htmlFor="stock-cost">Nuevo Costo (opcional)</label>
                      <input
                        id="stock-cost"
                        type="number"
                        min={0}
                        step="0.01"
                        value={stockCost}
                        onChange={(event) => setStockCost(event.target.value)}
                      />
                    </div>
                    <div className="field-group">
                      <label htmlFor="stock-target">Stock fisico real (recomendado)</label>
                      <input
                        id="stock-target"
                        type="number"
                        min={0}
                        step={1}
                        value={stockTarget}
                        onChange={(event) => {
                          setStockTarget(event.target.value);
                          if (event.target.value.trim()) {
                            setStockChange("");
                          }
                        }}
                        placeholder="Ej. 4"
                      />
                    </div>
                  </div>
                  <div className="field-group">
                    <label htmlFor="stock-change">Cambio por diferencia (+/- avanzado)</label>
                    <input
                      id="stock-change"
                      type="number"
                      step={1}
                      value={stockChange}
                      onChange={(event) => {
                        setStockChange(event.target.value);
                        if (event.target.value.trim()) {
                          setStockTarget("");
                        }
                      }}
                      placeholder="Ej. -13 si quieres bajar de 17 a 4"
                    />
                  </div>
                  <div className="field-group">
                    <label htmlFor="stock-reason">Motivo del ajuste</label>
                    <input
                      id="stock-reason"
                      value={stockReason}
                      onChange={(event) => setStockReason(event.target.value)}
                      placeholder="Conteo fisico, merma, entrada de compra..."
                    />
                  </div>
                  <div className="field-grid two-col">
                    <div className="field-group">
                      <label htmlFor="stock-lot-code">Lote (opcional para entradas)</label>
                      <input
                        id="stock-lot-code"
                        value={stockLotCode}
                        onChange={(event) => setStockLotCode(event.target.value)}
                        placeholder="LOTE-2026-01"
                      />
                    </div>
                    <div className="field-group">
                      <label htmlFor="stock-lot-expiry">Caducidad del lote (entradas)</label>
                      <input
                        id="stock-lot-expiry"
                        type="date"
                        value={stockLotExpiresAt}
                        onChange={(event) => setStockLotExpiresAt(event.target.value)}
                      />
                    </div>
                  </div>
                  <p className="muted-line compact-note">
                    Para corregir Amoxicilina de 17 a 4, escribe 4 en stock fisico real.
                    Si el costo supera el precio publico, el sistema alinea el precio automaticamente.
                  </p>
                  <button className="secondary-btn" type="submit" disabled={adjustingStock}>
                    {adjustingStock ? "Aplicando..." : "Aplicar Ajuste"}
                  </button>
                </form>
              </details>
            </article>

            <article className="surface">
              <div className="surface-head compact">
                <div>
                  <h3>Inventario</h3>
                </div>
              </div>
              <div className="inline-toolbar">
                <label htmlFor="inventory-filter">Buscar</label>
                <input
                  id="inventory-filter"
                  value={inventoryFilter}
                  onChange={(event) => setInventoryFilter(event.target.value)}
                  placeholder="Nombre generico/comercial, SKU, tipo"
                />
              </div>

              <div className="data-table-wrap tall">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th>Categoria</th>
                      <th>Tipo</th>
                      <th>SKU</th>
                      <th>Stock</th>
                      <th>Min</th>
                      <th>Caducidad</th>
                      <th>Costo</th>
                      <th>Precio Publico</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredInventory.map((product) => (
                      <tr key={product.id}>
                        <td>{formatProductLabel(product.name, product.commercialName)}</td>
                        <td>{product.category ?? defaultCategoryForKind(product.kind)}</td>
                        <td>{productKindLabel(product.kind)}</td>
                        <td>{product.sku}</td>
                        <td>{product.stock}</td>
                        <td>{product.minStock}</td>
                        <td>{product.expiresAt ? product.expiresAt.slice(0, 10) : "--"}</td>
                        <td>{moneyFormatter.format(product.cost)}</td>
                        <td>{moneyFormatter.format(product.price)}</td>
                        <td>
                          <span className={`status-chip ${product.isActive ? "ok" : "mute"}`}>
                            {product.isActive ? "Activo" : "Inactivo"}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {filteredInventory.length === 0 && (
                      <tr>
                        <td colSpan={10} className="empty-cell">
                          No hay coincidencias.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <details className="compact-details">
                <summary>Editar configuracion de producto</summary>
                <form className="field-grid details-content" onSubmit={submitProductUpdate}>
                  <div className="field-group">
                    <label htmlFor="edit-product">Producto</label>
                    <select
                      id="edit-product"
                      value={editProductId}
                      onChange={(event) => setEditProductId(event.target.value)}
                    >
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {formatProductLabel(product.name, product.commercialName)} ({product.sku})
                        </option>
                      ))}
                    </select>
                  </div>

                  {selectedEditProduct && (
                    <p className="muted-line compact-note">
                      Tipo: <strong>{productKindLabel(selectedEditProduct.kind)}</strong>
                      {" | "}
                      Nombre: <strong>{formatProductLabel(selectedEditProduct.name, selectedEditProduct.commercialName)}</strong>
                    </p>
                  )}

                  <div className="field-group">
                    <label htmlFor="edit-product-name">Nombre Generico / Composicion</label>
                    <input
                      id="edit-product-name"
                      value={editProductName}
                      onChange={(event) => {
                        const nextName = event.target.value;
                        if (selectedEditProduct?.kind === "MEDICATION") {
                          const wasAutomaticCategory =
                            editCategory ===
                              inferProductCategory(editProductName, selectedEditProduct.kind) ||
                            editCategory === defaultCategoryForKind(selectedEditProduct.kind) ||
                            editCategory === "Medicamento";

                          if (wasAutomaticCategory) {
                            setEditCategory(
                              inferProductCategory(nextName, selectedEditProduct.kind),
                            );
                          }
                        }
                        setEditProductName(nextName);
                      }}
                      placeholder="Paracetamol 500 mg, Amoxicilina 500 mg..."
                    />
                  </div>

                  <div className="field-group">
                    <label htmlFor="edit-commercial-name">Nombre Comercial (opcional)</label>
                    <input
                      id="edit-commercial-name"
                      value={editCommercialName}
                      onChange={(event) => setEditCommercialName(event.target.value)}
                      placeholder="Tempra, Advil, etc."
                    />
                  </div>

                  <div className="field-group">
                    <label htmlFor="edit-category">Categoria operativa</label>
                    <select
                      id="edit-category"
                      value={editCategory}
                      onChange={(event) => setEditCategory(event.target.value)}
                      disabled={selectedEditProduct?.kind !== "MEDICATION"}
                    >
                      {selectedEditProduct?.kind === "MEDICATION" ? (
                        medicationCategoryOptions.map((category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ))
                      ) : (
                        <option value={defaultCategoryForKind(selectedEditProduct?.kind ?? "MEDICAL_SUPPLY")}>
                          {defaultCategoryForKind(selectedEditProduct?.kind ?? "MEDICAL_SUPPLY")}
                        </option>
                      )}
                    </select>
                  </div>

                  <div className="field-grid two-col">
                    <div className="field-group">
                      <label htmlFor="edit-cost">Costo</label>
                      <input
                        id="edit-cost"
                        type="number"
                        min={0}
                        step="0.01"
                        value={editCost}
                        onChange={(event) => setEditCost(event.target.value)}
                      />
                    </div>
                    <div className="field-group">
                      <label htmlFor="edit-price">Precio Al Publico</label>
                      <input
                        id="edit-price"
                        type="number"
                        min={0}
                        step="0.01"
                        value={editPrice}
                        onChange={(event) => setEditPrice(event.target.value)}
                      />
                    </div>
                  </div>
                  <div className="field-group">
                    <label htmlFor="edit-min">Stock Minimo</label>
                    <input
                      id="edit-min"
                      type="number"
                      min={0}
                      step={1}
                      value={editMinStock}
                      onChange={(event) => setEditMinStock(event.target.value)}
                    />
                  </div>

                  {selectedEditProduct?.kind === "MEDICATION" && (
                    <div className="field-group">
                      <label htmlFor="edit-expires-at">Caducidad</label>
                      <input
                        id="edit-expires-at"
                        type="date"
                        value={editExpiresAt}
                        onChange={(event) => setEditExpiresAt(event.target.value)}
                      />
                    </div>
                  )}

                  <div className="field-group checkbox-line">
                    <input
                      id="edit-active"
                      type="checkbox"
                      checked={editActive}
                      onChange={(event) => setEditActive(event.target.checked)}
                    />
                    <label htmlFor="edit-active">Producto activo para venta</label>
                  </div>

                  <div className="button-row split-actions">
                    <button
                      className="danger-btn"
                      type="button"
                      onClick={() => void deleteSelectedProduct()}
                      disabled={deletingProduct || savingProductChanges || !selectedEditProduct}
                    >
                      {deletingProduct ? "Eliminando..." : "Eliminar Producto"}
                    </button>
                    <button
                      className="secondary-btn"
                      type="submit"
                      disabled={savingProductChanges || deletingProduct}
                    >
                      {savingProductChanges ? "Guardando..." : "Guardar Cambios"}
                    </button>
                  </div>
                </form>
              </details>

              <details className="compact-details">
                <summary>Lotes y caducidades</summary>
                <div className="details-content">
                  <p className="muted-line">
                    Lotes visibles para el producto seleccionado: <strong>{selectedLots.length}</strong>
                  </p>
                  <div className="data-table-wrap medium">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Lote</th>
                          <th>Producto</th>
                          <th>Cantidad</th>
                          <th>Caducidad</th>
                          <th>Costo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedLots.map((lot) => (
                          <tr key={lot.id}>
                            <td>{lot.lotCode}</td>
                            <td>{formatProductLabel(lot.product.name, lot.product.commercialName)}</td>
                            <td>{lot.quantity}</td>
                            <td>{lot.expiresAt ? lot.expiresAt.slice(0, 10) : "--"}</td>
                            <td>{moneyFormatter.format(lot.cost)}</td>
                          </tr>
                        ))}
                        {selectedLots.length === 0 && (
                          <tr>
                            <td colSpan={5} className="empty-cell">
                              No hay lotes registrados para este producto.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </details>
            </article>
          </div>
        </section>
      )}

      {activeModule === "services" && (
        <section className="workspace">
          <div className="module-header">
            <h2>Servicios medicos</h2>
            <p>{activeServiceCount} servicios activos para POS y agenda.</p>
          </div>

          <div className="inventory-grid">
            <article className="surface">
              <h3>Nuevo Servicio</h3>
              <form className="field-grid" onSubmit={submitNewService}>
                <div className="field-grid two-col">
                  <div className="field-group">
                    <label htmlFor="new-service-sku">Codigo (autogenerado)</label>
                    <div className="inline-toolbar compact-inline">
                      <input
                        id="new-service-sku"
                        value={newService.sku}
                        onChange={(event) => {
                          const nextSku = event.target.value;
                          setNewService((current) => ({
                            ...current,
                            sku: nextSku,
                          }));
                          setNewServiceSkuManuallyEdited(nextSku.trim().length > 0);
                        }}
                        placeholder="Se genera con el nombre"
                      />
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => {
                          const suggestedSku = generateSkuSuggestion(
                            newService.name,
                            "MEDICAL_SERVICE",
                          );
                          setNewServiceSkuManuallyEdited(false);
                          setNewService((current) => ({ ...current, sku: suggestedSku }));
                        }}
                      >
                        Generar
                      </button>
                    </div>
                  </div>
                  <div className="field-group">
                    <label htmlFor="new-service-name">Nombre</label>
                    <input
                      id="new-service-name"
                      value={newService.name}
                      onChange={(event) =>
                        setNewService((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      placeholder="Consulta Especializada"
                    />
                  </div>
                </div>

                <div className="field-group">
                  <label htmlFor="new-service-price">Precio al publico</label>
                  <input
                    id="new-service-price"
                    type="number"
                    min={0}
                    step="0.01"
                    value={newService.price}
                    onChange={(event) =>
                      setNewService((current) => ({
                        ...current,
                        price: event.target.value,
                      }))
                    }
                  />
                </div>

                <div className="field-group">
                  <label htmlFor="new-service-description">Descripcion</label>
                  <input
                    id="new-service-description"
                    value={newService.description}
                    onChange={(event) =>
                      setNewService((current) => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                    placeholder="Opcional"
                  />
                </div>

                <button className="primary-btn" type="submit" disabled={creatingService}>
                  {creatingService ? "Guardando..." : "Registrar Servicio"}
                </button>
              </form>

              <details className="compact-details">
                <summary>Ajustar precio</summary>
                <form className="field-grid details-content" onSubmit={submitQuickServiceUpdate}>
                  <div className="field-group">
                    <label htmlFor="quick-service">Servicio</label>
                    <select
                      id="quick-service"
                      value={serviceQuickId}
                      onChange={(event) => setServiceQuickId(event.target.value)}
                    >
                      {services.map((service) => (
                        <option key={service.id} value={service.id}>
                          {service.name} ({service.sku})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="field-group">
                    <label htmlFor="quick-service-price">Precio al publico</label>
                    <input
                      id="quick-service-price"
                      type="number"
                      min={0}
                      step="0.01"
                      value={serviceQuickPrice}
                      onChange={(event) => setServiceQuickPrice(event.target.value)}
                    />
                  </div>

                  {selectedQuickService && (
                    <p className="muted-line compact-note">
                      Servicio seleccionado: <strong>{selectedQuickService.name}</strong>
                    </p>
                  )}

                  <button className="secondary-btn" type="submit" disabled={updatingServiceQuick}>
                    {updatingServiceQuick ? "Aplicando..." : "Aplicar Ajuste"}
                  </button>
                </form>
              </details>

              <details className="compact-details">
                <summary>Editar servicio</summary>
                <form className="field-grid details-content" onSubmit={submitServiceUpdate}>
                  <div className="field-group">
                    <label htmlFor="edit-service">Servicio</label>
                    <select
                      id="edit-service"
                      value={editServiceId}
                      onChange={(event) => setEditServiceId(event.target.value)}
                    >
                      {services.map((service) => (
                        <option key={service.id} value={service.id}>
                          {service.name} ({service.sku})
                        </option>
                      ))}
                    </select>
                  </div>

                  {selectedEditService && (
                    <p className="muted-line compact-note">
                      Estado actual: <strong>{selectedEditService.isActive ? "Activo" : "Inactivo"}</strong>
                    </p>
                  )}

                  <div className="field-group">
                    <label htmlFor="edit-service-price">Precio al publico</label>
                    <input
                      id="edit-service-price"
                      type="number"
                      min={0}
                      step="0.01"
                      value={editServicePrice}
                      onChange={(event) => setEditServicePrice(event.target.value)}
                    />
                  </div>

                  <div className="field-group">
                    <label htmlFor="edit-service-description">Descripcion</label>
                    <input
                      id="edit-service-description"
                      value={editServiceDescription}
                      onChange={(event) => setEditServiceDescription(event.target.value)}
                      placeholder="Opcional"
                    />
                  </div>

                  <div className="field-group checkbox-line">
                    <input
                      id="edit-service-active"
                      type="checkbox"
                      checked={editServiceActive}
                      onChange={(event) => setEditServiceActive(event.target.checked)}
                    />
                    <label htmlFor="edit-service-active">Servicio activo en POS</label>
                  </div>

                  <button
                    className="secondary-btn"
                    type="submit"
                    disabled={savingServiceChanges}
                  >
                    {savingServiceChanges ? "Guardando..." : "Guardar Servicio"}
                  </button>
                </form>
              </details>
            </article>

            <article className="surface">
              <div className="surface-head compact">
                <div>
                  <h3>Servicios</h3>
                </div>
              </div>
              <div className="inline-toolbar">
                <label htmlFor="service-filter">Buscar</label>
                <input
                  id="service-filter"
                  value={serviceFilter}
                  onChange={(event) => setServiceFilter(event.target.value)}
                  placeholder="Nombre o codigo"
                />
              </div>

              <div className="data-table-wrap tall">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Servicio</th>
                      <th>Codigo</th>
                      <th>Precio</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredServices.map((service) => (
                      <tr key={service.id}>
                        <td>{service.name}</td>
                        <td>{service.sku}</td>
                        <td>{moneyFormatter.format(service.price)}</td>
                        <td>
                          <span className={`status-chip ${service.isActive ? "ok" : "mute"}`}>
                            {service.isActive ? "Activo" : "Inactivo"}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {filteredServices.length === 0 && (
                      <tr>
                        <td colSpan={4} className="empty-cell">
                          No hay servicios registrados.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </article>
          </div>
        </section>
      )}

      {activeModule === "alerts" && (
        <section className="workspace">
          <div className="module-header">
            <h2>Alertas</h2>
            <p>
              {alerts.length} alertas activas, {expiredAlertsCount} vencidos y vigilancia de
              caducidad con {expirationThresholdDays} dias de anticipacion; citas con aviso
              {` ${appointmentReminderMinutes} min antes.`}
            </p>
          </div>

          <div className="reports-mini-grid alerts-grid">
            <article className="surface">
              <div className="surface-head compact">
                <div>
                  <h3>Motor de alertas</h3>
                </div>
              </div>
              <p className="muted-line">
                Alertas unificadas: <strong>{operationalAlerts.length}</strong>
              </p>
              <div className="data-table-wrap tall">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Tipo</th>
                      <th>Severidad</th>
                      <th>Detalle</th>
                      <th>Modulo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {operationalAlerts.map((alert) => (
                      <tr key={alert.id}>
                        <td>{alert.title}</td>
                        <td>
                          <span className={`status-chip ${alert.level === "critical" ? "cancelled" : alert.level === "warning" ? "high" : "scheduled"}`}>
                            {alert.level}
                          </span>
                        </td>
                        <td>{alert.message}</td>
                        <td>{alert.module}</td>
                      </tr>
                    ))}
                    {operationalAlerts.length === 0 && (
                      <tr>
                        <td colSpan={4} className="empty-cell">
                          Sin alertas operativas activas.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="surface">
              <div className="surface-head compact">
                <div>
                  <h3>Stock critico</h3>
                </div>
              </div>
              <p className="muted-line">
                Faltantes totales: <strong>{totalShortage}</strong> unidades.
              </p>

              <div className="data-table-wrap tall">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th>SKU</th>
                      <th>Stock Actual</th>
                      <th>Stock Minimo</th>
                      <th>Faltante</th>
                      <th>Accion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alerts.map((alert) => (
                      <tr key={alert.id}>
                        <td>{formatProductLabel(alert.name, alert.commercialName)}</td>
                        <td>{alert.sku}</td>
                        <td>{alert.stock}</td>
                        <td>{alert.minStock}</td>
                        <td>{Math.max(0, alert.shortage)}</td>
                        <td>
                          <button
                            type="button"
                            className="ghost-btn"
                            onClick={() => {
                              startTransition(() => setActiveModule("inventory"));
                              setStockProductId(String(alert.id));
                              setStockChange(String(Math.max(1, alert.shortage)));
                              setStockReason("Reposicion por alerta");
                            }}
                          >
                            Reponer
                          </button>
                        </td>
                      </tr>
                    ))}
                    {alerts.length === 0 && (
                      <tr>
                        <td colSpan={6} className="empty-cell">
                          Sin alertas de inventario por ahora.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="surface">
              <div className="surface-head compact">
                <div>
                  <h3>Proximos a caducar</h3>
                </div>
              </div>
              <p className="muted-line">
                Medicamentos con vencimiento cercano o vencidos: <strong>{expiryAlerts.length}</strong>
              </p>

              <div className="data-table-wrap tall">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Medicamento</th>
                      <th>SKU</th>
                      <th>Lote</th>
                      <th>Caduca</th>
                      <th>Dias</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expiryAlerts.map((alert) => (
                      <tr key={alert.id}>
                        <td>{formatProductLabel(alert.name, alert.commercialName)}</td>
                        <td>{alert.sku}</td>
                        <td>{alert.lotCode ?? "--"}</td>
                        <td>{alert.expiresAt.slice(0, 10)}</td>
                        <td>{alert.daysToExpire}</td>
                        <td>
                          <span
                            className={`status-chip ${
                              alert.status === "EXPIRED" ? "cancelled" : "high"
                            }`}
                          >
                            {alert.status === "EXPIRED" ? "Vencido" : "Proximo"}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {expiryAlerts.length === 0 && (
                      <tr>
                        <td colSpan={6} className="empty-cell">
                          Sin medicamentos proximos a caducar.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </article>
          </div>
        </section>
      )}

      {activeModule === "appointments" && (
        <section className="workspace">
          <div className="module-header">
            <h2>Citas</h2>
            <p>{todayAppointmentsCount} citas registradas para hoy.</p>
          </div>

          <div className="appointments-grid">
            <article className="surface">
              <h3>Nueva Cita</h3>
              <form className="field-grid" onSubmit={createAppointment}>
                <div className="field-grid two-col">
                  <div className="field-group">
                    <label htmlFor="appointment-name">Paciente</label>
                    <input
                      id="appointment-name"
                      value={appointmentForm.patientName}
                      onChange={(event) =>
                        setAppointmentForm((current) => ({
                          ...current,
                          patientName: event.target.value,
                        }))
                      }
                      placeholder="Nombre completo"
                    />
                  </div>
                  <div className="field-group">
                    <label htmlFor="appointment-phone">Telefono</label>
                    <input
                      id="appointment-phone"
                      value={appointmentForm.patientPhone}
                      onChange={(event) =>
                        setAppointmentForm((current) => ({
                          ...current,
                          patientPhone: event.target.value,
                        }))
                      }
                      placeholder="Opcional"
                    />
                  </div>
                </div>

                <div className="field-group">
                  <label htmlFor="appointment-service">Servicio</label>
                  <input
                    id="appointment-service"
                    list="services-catalog"
                    value={appointmentForm.serviceType}
                    onChange={(event) =>
                      setAppointmentForm((current) => ({
                        ...current,
                        serviceType: event.target.value,
                      }))
                    }
                    placeholder="Consulta general"
                  />
                  <datalist id="services-catalog">
                    {services.filter((service) => service.isActive).map((service) => (
                      <option key={service.id} value={service.name} />
                    ))}
                  </datalist>
                </div>

                <div className="field-group">
                  <label htmlFor="appointment-date">Fecha y Hora</label>
                  <input
                    id="appointment-date"
                    type="datetime-local"
                    value={appointmentForm.appointmentAt}
                    onChange={(event) =>
                      setAppointmentForm((current) => ({
                        ...current,
                        appointmentAt: event.target.value,
                      }))
                    }
                  />
                </div>

                <div className="field-group">
                  <label htmlFor="appointment-notes">Notas</label>
                  <textarea
                    id="appointment-notes"
                    rows={3}
                    value={appointmentForm.notes}
                    onChange={(event) =>
                      setAppointmentForm((current) => ({
                        ...current,
                        notes: event.target.value,
                      }))
                    }
                    placeholder="Indicaciones previas de consulta"
                  />
                </div>

                <button className="primary-btn" type="submit" disabled={savingAppointment}>
                  {savingAppointment ? "Agendando..." : "Agendar Cita"}
                </button>
              </form>
            </article>

            <article className="surface">
              <div className="surface-head compact">
                <div>
                  <h3>Agenda</h3>
                </div>
              </div>
              <div className="inline-toolbar stack-mobile">
                <div className="field-group compact">
                  <label htmlFor="date-filter">Fecha</label>
                  <input
                    id="date-filter"
                    type="date"
                    value={appointmentDateFilter}
                    onChange={(event) => setAppointmentDateFilter(event.target.value)}
                  />
                </div>
                <div className="field-group compact">
                  <label htmlFor="status-filter">Estado</label>
                  <select
                    id="status-filter"
                    value={appointmentStatusFilter}
                    onChange={(event) =>
                      setAppointmentStatusFilter(
                        event.target.value as
                          | "ALL"
                          | "SCHEDULED"
                          | "COMPLETED"
                          | "CANCELLED",
                      )
                    }
                  >
                    <option value="ALL">Todos</option>
                    <option value="SCHEDULED">Programada</option>
                    <option value="COMPLETED">Completada</option>
                    <option value="CANCELLED">Cancelada</option>
                  </select>
                </div>
              </div>

              <div className="agenda-list">
                {filteredAppointments.map((appointment) => (
                  <div key={appointment.id} className="agenda-item">
                    <div>
                      <strong>{appointment.patientName}</strong>
                      <p>{appointment.serviceType}</p>
                      <small>{datetimeFormatter.format(new Date(appointment.appointmentAt))}</small>
                    </div>
                    <div className="agenda-actions">
                      <span className={`status-chip ${appointment.status.toLowerCase()}`}>
                        {appointmentStatusLabel(appointment.status)}
                      </span>
                      <div className="field-group compact agenda-status-field">
                        <label htmlFor={`appointment-status-${appointment.id}`}>Estado</label>
                        <select
                          id={`appointment-status-${appointment.id}`}
                          value={appointment.status}
                          onChange={(event) =>
                            void updateAppointmentStatus(
                              appointment.id,
                              event.target.value as Appointment["status"],
                            )
                          }
                        >
                          <option value="SCHEDULED">Programada</option>
                          <option value="COMPLETED">Completada</option>
                          <option value="CANCELLED">Cancelada</option>
                        </select>
                      </div>
                    </div>
                  </div>
                ))}
                {filteredAppointments.length === 0 && (
                  <p className="empty-cell">Sin citas para el filtro seleccionado.</p>
                )}
              </div>
            </article>

            <article className="surface">
              <div className="surface-head compact">
                <div>
                  <h3>Pacientes y seguimiento</h3>
                </div>
              </div>
              <div className="inline-toolbar">
                <label htmlFor="patient-search">Buscar</label>
                <input
                  id="patient-search"
                  value={patientSearch}
                  onChange={(event) => setPatientSearch(event.target.value)}
                  placeholder="Nombre, telefono o nota"
                />
              </div>

              <div className="agenda-list compact-list">
                {filteredPatients.slice(0, 6).map((patient) => (
                  <div key={patient.id} className="agenda-item">
                    <div>
                      <strong>{patient.fullName}</strong>
                      <p>{patient.phone ?? "Sin telefono"}</p>
                      <small>
                        Ultima visita: {patient.lastVisitAt ? patient.lastVisitAt.slice(0, 10) : "--"}
                      </small>
                    </div>
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={() =>
                        setConsultationForm((current) => ({
                          ...current,
                          patientId: String(patient.id),
                        }))
                      }
                    >
                      Usar en consulta
                    </button>
                  </div>
                ))}
                {filteredPatients.length === 0 && (
                  <p className="empty-cell">Sin pacientes para el filtro actual.</p>
                )}
              </div>

              <details className="compact-details">
                <summary>Seguimientos pendientes</summary>
                <div className="details-content">
                  <div className="agenda-list compact-list">
                    {pendingFollowUps.slice(0, 8).map((consultation) => (
                      <div key={consultation.id} className="agenda-item">
                        <div>
                          <strong>{consultation.patient.fullName}</strong>
                          <p>{consultation.serviceType}</p>
                          <small>
                            {consultation.followUpAt
                              ? consultation.followUpAt.slice(0, 10)
                              : "Sin fecha"}
                          </small>
                        </div>
                        <div className="agenda-actions">
                          <span className="status-chip scheduled">
                            {consultation.followUpStatus}
                          </span>
                          <button
                            type="button"
                            className="ghost-btn"
                            onClick={() => {
                              void updateConsultationFollowUpStatus(
                                consultation.id,
                                "COMPLETED",
                              );
                            }}
                          >
                            Marcar resuelto
                          </button>
                        </div>
                      </div>
                    ))}
                    {pendingFollowUps.length === 0 && (
                      <p className="empty-cell">Sin seguimientos pendientes.</p>
                    )}
                  </div>
                </div>
              </details>
            </article>

            <article className="surface">
              <div className="surface-head compact">
                <div>
                  <h3>Consulta y servicio medico</h3>
                </div>
              </div>
              <form className="field-grid" onSubmit={createConsultation}>
                <div className="field-grid two-col">
                  <div className="field-group">
                    <label htmlFor="consultation-patient">Paciente</label>
                    <select
                      id="consultation-patient"
                      value={consultationForm.patientId}
                      onChange={(event) =>
                        setConsultationForm((current) => ({
                          ...current,
                          patientId: event.target.value,
                        }))
                      }
                    >
                      {patients.map((patient) => (
                        <option key={patient.id} value={patient.id}>
                          {patient.fullName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field-group">
                    <label htmlFor="consultation-appointment">Cita asociada</label>
                    <select
                      id="consultation-appointment"
                      value={consultationForm.appointmentId}
                      onChange={(event) =>
                        setConsultationForm((current) => ({
                          ...current,
                          appointmentId: event.target.value,
                        }))
                      }
                    >
                      <option value="">Sin cita asociada</option>
                      {appointments.map((appointment) => (
                        <option key={appointment.id} value={appointment.id}>
                          {appointment.patientName} · {appointment.serviceType}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="field-grid two-col">
                  <div className="field-group">
                    <label htmlFor="consultation-service-product">Servicio catalogado</label>
                    <select
                      id="consultation-service-product"
                      value={consultationForm.serviceProductId}
                      onChange={(event) =>
                        setConsultationForm((current) => ({
                          ...current,
                          serviceProductId: event.target.value,
                          serviceType:
                            services.find((service) => service.id === Number(event.target.value))
                              ?.name ?? current.serviceType,
                        }))
                      }
                    >
                      {services.map((service) => (
                        <option key={service.id} value={service.id}>
                          {service.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field-group">
                    <label htmlFor="consultation-service-type">Tipo de servicio</label>
                    <input
                      id="consultation-service-type"
                      value={consultationForm.serviceType}
                      onChange={(event) =>
                        setConsultationForm((current) => ({
                          ...current,
                          serviceType: event.target.value,
                        }))
                      }
                    />
                  </div>
                </div>

                <div className="field-group">
                  <label htmlFor="consultation-summary">Resumen ejecutivo</label>
                  <textarea
                    id="consultation-summary"
                    rows={2}
                    value={consultationForm.summary}
                    onChange={(event) =>
                      setConsultationForm((current) => ({
                        ...current,
                        summary: event.target.value,
                      }))
                    }
                    placeholder="Resumen corto para el administrador"
                  />
                </div>

                <div className="field-grid two-col">
                  <div className="field-group">
                    <label htmlFor="consultation-diagnosis">Diagnostico / hallazgo</label>
                    <textarea
                      id="consultation-diagnosis"
                      rows={3}
                      value={consultationForm.diagnosis}
                      onChange={(event) =>
                        setConsultationForm((current) => ({
                          ...current,
                          diagnosis: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="field-group">
                    <label htmlFor="consultation-treatment">Tratamiento / accion</label>
                    <textarea
                      id="consultation-treatment"
                      rows={3}
                      value={consultationForm.treatment}
                      onChange={(event) =>
                        setConsultationForm((current) => ({
                          ...current,
                          treatment: event.target.value,
                        }))
                      }
                    />
                  </div>
                </div>

                <div className="field-group">
                  <label htmlFor="consultation-observations">Observaciones</label>
                  <textarea
                    id="consultation-observations"
                    rows={3}
                    value={consultationForm.observations}
                    onChange={(event) =>
                      setConsultationForm((current) => ({
                        ...current,
                        observations: event.target.value,
                      }))
                    }
                    placeholder="Notas clinicas o administrativas"
                  />
                </div>

                <div className="field-group">
                  <label htmlFor="consultation-follow-up">Seguimiento para</label>
                  <input
                    id="consultation-follow-up"
                    type="datetime-local"
                    value={consultationForm.followUpAt}
                    onChange={(event) =>
                      setConsultationForm((current) => ({
                        ...current,
                        followUpAt: event.target.value,
                      }))
                    }
                  />
                </div>

                <button className="primary-btn" type="submit" disabled={savingConsultation}>
                  {savingConsultation ? "Guardando..." : "Registrar Consulta"}
                </button>
              </form>
            </article>
          </div>
        </section>
      )}

      {activeModule === "reports" && (
        <section className="workspace">
          <div className="module-header">
            <h2>Reportes</h2>
            <p>Ventas, surtido y exportaciones desde el sistema local.</p>
          </div>

          <article className="surface">
            <div className="surface-head compact">
              <div>
                <h3>Configuracion</h3>
              </div>
            </div>
            <form
              className="report-config-form"
              onSubmit={(event) => {
                event.preventDefault();
                void loadReports();
              }}
            >
              <div className="report-filter-grid">
                <div className="field-group compact">
                  <label htmlFor="report-from">Desde</label>
                  <input
                    id="report-from"
                    type="date"
                    value={reportRange.from}
                    onChange={(event) =>
                      setReportRange((current) => ({
                        ...current,
                        from: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="field-group compact">
                  <label htmlFor="report-to">Hasta</label>
                  <input
                    id="report-to"
                    type="date"
                    value={reportRange.to}
                    onChange={(event) =>
                      setReportRange((current) => ({ ...current, to: event.target.value }))
                    }
                  />
                </div>
                <div className="field-group compact">
                  <label htmlFor="report-days">Dias analizados</label>
                  <input
                    id="report-days"
                    type="number"
                    min={1}
                    max={120}
                    value={reportDays}
                    onChange={(event) => setReportDays(event.target.value)}
                  />
                </div>
                <div className="field-group compact">
                  <label htmlFor="coverage-days">Cobertura deseada</label>
                  <input
                    id="coverage-days"
                    type="number"
                    min={1}
                    max={60}
                    value={coverageDays}
                    onChange={(event) => setCoverageDays(event.target.value)}
                  />
                </div>
              </div>

              <div className="report-action-stack">
                <button
                  className="primary-btn report-refresh-btn"
                  type="submit"
                  disabled={loadingReports || generatingRestockPdf}
                >
                  {loadingReports ? "Actualizando..." : "Actualizar reportes"}
                </button>
                <button
                  className="secondary-btn report-pdf-btn"
                  type="button"
                  onClick={() => {
                    void generateRestockReport();
                  }}
                  disabled={generatingRestockPdf || loadingReports}
                >
                  {generatingRestockPdf ? "Generando PDF..." : "Exportar PDF de surtido"}
                </button>
              </div>
            </form>
            <p className="muted-line report-config-note">
              Ventas usa Desde/Hasta. El reporte de surtido y su PDF usan Dias analizados y
              Cobertura deseada.
            </p>

            <details className="compact-details">
              <summary>Acciones avanzadas</summary>
              <div className="reports-action-row details-content">
                <button
                  className="secondary-btn"
                  type="button"
                  onClick={() => void runMonthlyPriceCutoff()}
                  disabled={runningMonthlyCutoff}
                >
                  {runningMonthlyCutoff
                    ? "Generando corte..."
                    : "Corte mensual de precios"}
                </button>
                <button className="secondary-btn" type="button" onClick={exportSalesCsv}>
                  Exportar ventas CSV
                </button>
                <button
                  className="secondary-btn"
                  type="button"
                  onClick={() => void exportDatabaseBackup()}
                >
                  Exportar base de datos
                </button>
              </div>
            </details>
            {lastBackupPath && (
              <p className="muted-line">Ultimo respaldo guardado en: {lastBackupPath}</p>
            )}
          </article>

          <div className="reports-grid">
            <article className="surface">
              <div className="surface-head compact">
                <div>
                  <h3>Reporte de ventas</h3>
                </div>
              </div>
              {loadingReports && <p className="muted-line">Generando reporte...</p>}
              {!loadingReports && salesReport && (
                <>
                  <p className="muted-line">
                    Este reporte desglosa cada ticket con su ID, ingresos, costos estimados,
                    descuentos aplicados y productos mas/menos vendidos.
                  </p>

                  <div className="insight-inline-card">
                    <strong>Lectura ejecutiva</strong>
                    <ul className="compact-bullet-list">
                      {salesReport.highlights.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>

                  {salesReport.anomalies.length > 0 && (
                    <div className="quick-chip-row">
                      {salesReport.anomalies.map((anomaly) => (
                        <span key={anomaly.message} className={`status-pill ${anomaly.severity}`}>
                          {anomaly.type}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="kpi-grid compact-kpi report-kpis-expanded">
                    <article className="kpi-card">
                      <p className="kpi-label">Total Ventas</p>
                      <p className="kpi-value">{salesReport.totalSales}</p>
                      <p className="kpi-helper">tickets en el periodo</p>
                    </article>
                    <article className="kpi-card">
                      <p className="kpi-label">Unidades Vendidas</p>
                      <p className="kpi-value">{salesReport.totalItemsSold}</p>
                      <p className="kpi-helper">
                        promedio {salesReport.averageItemsPerSale.toFixed(2)} por ticket
                      </p>
                    </article>
                    <article className="kpi-card">
                      <p className="kpi-label">Ingresos Brutos</p>
                      <p className="kpi-value">{moneyFormatter.format(salesReport.grossRevenue)}</p>
                      <p className="kpi-helper">antes de descuentos</p>
                    </article>
                    <article className="kpi-card">
                      <p className="kpi-label">Descuentos</p>
                      <p className="kpi-value">{moneyFormatter.format(salesReport.totalDiscount)}</p>
                      <p className="kpi-helper">{salesReport.discountRatePct.toFixed(2)}% sobre bruto</p>
                    </article>
                    <article className="kpi-card">
                      <p className="kpi-label">Ingreso Neto</p>
                      <p className="kpi-value">{moneyFormatter.format(salesReport.totalRevenue)}</p>
                      <p className="kpi-helper">facturacion acumulada</p>
                    </article>
                    <article className="kpi-card">
                      <p className="kpi-label">Costo Estimado</p>
                      <p className="kpi-value">
                        {moneyFormatter.format(salesReport.estimatedTotalCost)}
                      </p>
                      <p className="kpi-helper">base costo actual por producto</p>
                    </article>
                    <article className="kpi-card">
                      <p className="kpi-label">Utilidad Estimada</p>
                      <p
                        className={`kpi-value ${
                          salesReport.estimatedGrossProfit >= 0 ? "value-positive" : "value-negative"
                        }`}
                      >
                        {moneyFormatter.format(salesReport.estimatedGrossProfit)}
                      </p>
                      <p className="kpi-helper">
                        margen {salesReport.estimatedMarginPct.toFixed(2)}%
                      </p>
                    </article>
                    <article className="kpi-card">
                      <p className="kpi-label">Ticket Promedio</p>
                      <p className="kpi-value">{moneyFormatter.format(salesReport.averageTicket)}</p>
                      <p className="kpi-helper">por venta</p>
                    </article>
                  </div>

                  <div className="insight-inline-card">
                    <strong>Reconciliacion con caja</strong>
                    <p className="muted-line compact-note">
                      {salesReport.cashReconciliation.linkedSales} de {salesReport.totalSales} tickets
                      ligados a caja. Ventas en corte:{" "}
                      <strong>
                        {moneyFormatter.format(salesReport.cashReconciliation.cashMovementTotal)}
                      </strong>
                      .
                    </p>
                    {salesReport.cashReconciliation.hasDifferences ? (
                      <p className="muted-line compact-note">
                        Revisar: {salesReport.cashReconciliation.unlinkedSales} tickets por{" "}
                        {moneyFormatter.format(salesReport.cashReconciliation.unlinkedSalesTotal)} no
                        tienen movimiento de caja asociado.
                      </p>
                    ) : (
                      <p className="muted-line compact-note">
                        Ventas y movimientos de caja estan sincronizados para este periodo.
                      </p>
                    )}
                  </div>

                  <h4 className="subsection-title">Productos Mas Vendidos Y Menos Vendidos</h4>
                  <div className="reports-mini-grid">
                    <div className="data-table-wrap tall">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Mas Vendido</th>
                            <th>ID</th>
                            <th>Unidades</th>
                            <th>Ingreso</th>
                          </tr>
                        </thead>
                        <tbody>
                          {salesReport.bestSellingProducts.map((item) => (
                            <tr key={`best-${item.productId}`}>
                              <td>{formatProductLabel(item.productName, item.productCommercialName)}</td>
                              <td>{item.productId}</td>
                              <td>{item.quantity}</td>
                              <td>{moneyFormatter.format(item.revenue)}</td>
                            </tr>
                          ))}
                          {salesReport.bestSellingProducts.length === 0 && (
                            <tr>
                              <td colSpan={4} className="empty-cell">
                                No hay datos para el periodo seleccionado.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    <div className="data-table-wrap tall">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Menos Vendido</th>
                            <th>ID</th>
                            <th>Unidades</th>
                            <th>Ingreso</th>
                          </tr>
                        </thead>
                        <tbody>
                          {salesReport.leastSellingProducts.map((item) => (
                            <tr key={`least-${item.productId}`}>
                              <td>{formatProductLabel(item.productName, item.productCommercialName)}</td>
                              <td>{item.productId}</td>
                              <td>{item.quantity}</td>
                              <td>{moneyFormatter.format(item.revenue)}</td>
                            </tr>
                          ))}
                          {salesReport.leastSellingProducts.length === 0 && (
                            <tr>
                              <td colSpan={4} className="empty-cell">
                                No hay datos para el periodo seleccionado.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <p className="muted-line">
                    Productos sin venta en el periodo: <strong>{salesReport.unsoldProducts.length}</strong>
                  </p>

                  <details className="compact-details">
                    <summary>Desglose por producto</summary>
                    <div className="details-content">
                      <div className="data-table-wrap tall">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>Producto</th>
                              <th>ID</th>
                              <th>SKU</th>
                              <th>Unidades</th>
                              <th>Ingreso</th>
                              <th>Costo Est.</th>
                              <th>Utilidad Est.</th>
                              <th>Margen</th>
                            </tr>
                          </thead>
                          <tbody>
                            {salesReport.productPerformance.map((item) => (
                              <tr key={item.productId}>
                                <td>{formatProductLabel(item.productName, item.productCommercialName)}</td>
                                <td>{item.productId}</td>
                                <td>{item.sku}</td>
                                <td>{item.quantity}</td>
                                <td>{moneyFormatter.format(item.revenue)}</td>
                                <td>{moneyFormatter.format(item.estimatedCost)}</td>
                                <td
                                  className={
                                    item.estimatedProfit >= 0 ? "value-positive" : "value-negative"
                                  }
                                >
                                  {moneyFormatter.format(item.estimatedProfit)}
                                </td>
                                <td>{item.marginPct.toFixed(2)}%</td>
                              </tr>
                            ))}
                            {salesReport.productPerformance.length === 0 && (
                              <tr>
                                <td colSpan={8} className="empty-cell">
                                  No hay datos para el periodo seleccionado.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </details>

                  <details className="compact-details">
                    <summary>Tickets registrados</summary>
                    <div className="details-content">
                      <div className="data-table-wrap tall">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>Ticket ID</th>
                              <th>Fecha</th>
                              <th>Cliente</th>
                              <th>Subtotal</th>
                              <th>Descuento</th>
                              <th>Total</th>
                              <th>Pago</th>
                              <th>Cambio</th>
                              <th>Caja</th>
                              <th>Items</th>
                            </tr>
                          </thead>
                          <tbody>
                            {salesReport.salesSummary.map((sale) => (
                              <tr key={sale.saleId}>
                                <td>#{sale.saleId}</td>
                                <td>{datetimeFormatter.format(new Date(sale.createdAt))}</td>
                                <td>{sale.customerName ?? "Mostrador"}</td>
                                <td>{moneyFormatter.format(sale.subtotal)}</td>
                                <td>{moneyFormatter.format(sale.discount)}</td>
                                <td>{moneyFormatter.format(sale.total)}</td>
                                <td>{moneyFormatter.format(sale.amountPaid)}</td>
                                <td>{moneyFormatter.format(sale.changeGiven)}</td>
                                <td>
                                  <span className={`status-chip ${sale.cashLinked ? "ok" : "high"}`}>
                                    {sale.cashLinked
                                      ? `Caja #${sale.cashSessionId ?? "-"}`
                                      : "Revisar"}
                                  </span>
                                </td>
                                <td>{sale.itemCount}</td>
                              </tr>
                            ))}
                            {salesReport.salesSummary.length === 0 && (
                              <tr>
                                <td colSpan={10} className="empty-cell">
                                  Sin tickets para el periodo seleccionado.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </details>

                  <details className="compact-details">
                    <summary>Movimientos de inventario</summary>
                    <div className="details-content">
                      <div className="data-table-wrap tall">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>Mov ID</th>
                              <th>Producto ID</th>
                              <th>Producto</th>
                              <th>Lote</th>
                              <th>Cambio</th>
                              <th>Stock Actual</th>
                              <th>Min.</th>
                              <th>Motivo</th>
                              <th>Fecha</th>
                            </tr>
                          </thead>
                          <tbody>
                            {inventoryMovementsReport.map((movement) => (
                              <tr key={movement.movementId}>
                                <td>{movement.movementId}</td>
                                <td>{movement.productId}</td>
                                <td>
                                  {formatProductLabel(
                                    movement.productName,
                                    movement.productCommercialName,
                                  )}
                                  <small>{movement.productSku}</small>
                                </td>
                                <td>{movement.lotCode || "--"}</td>
                                <td className={movement.change < 0 ? "value-negative" : "value-positive"}>
                                  {movement.change > 0 ? `+${movement.change}` : movement.change}
                                </td>
                                <td>{movement.currentStock}</td>
                                <td>{movement.minStock}</td>
                                <td>{movement.reason}</td>
                                <td>{datetimeFormatter.format(new Date(movement.createdAt))}</td>
                              </tr>
                            ))}
                            {inventoryMovementsReport.length === 0 && (
                              <tr>
                                <td colSpan={9} className="empty-cell">
                                  Sin movimientos de inventario registrados.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </details>
                </>
              )}
            </article>

            <article className="surface" id="reorder-report-section">
              <div className="surface-head compact">
                <div>
                  <h3>Stock minimo para surtir</h3>
                </div>
              </div>
              {loadingReports && <p className="muted-line">Calculando necesidad de reposicion...</p>}
              {!loadingReports && reorderReport && (
                <>
                  <p className="muted-line">
                    {reorderReport.totalItems} productos estan en stock minimo o por debajo. Unidades sugeridas:
                    <strong> {reorderReport.totalUnitsSuggested}</strong>
                  </p>
                  <div className="data-table-wrap tall">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Producto</th>
                          <th>Categoria</th>
                          <th>Tipo</th>
                          <th>Stock</th>
                          <th>Objetivo</th>
                          <th>Sugerido</th>
                          <th>Vendido</th>
                          <th>Puntaje</th>
                          <th>Prioridad</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reorderReport.items.map((item) => (
                          <tr key={item.productId}>
                            <td>
                              {formatProductLabel(item.name, item.commercialName)}
                              <small>{item.sku}</small>
                            </td>
                            <td>{item.category ?? "-"}</td>
                            <td>{productKindLabel(item.kind)}</td>
                            <td>{item.stock}</td>
                            <td>{item.targetStock}</td>
                            <td>{item.suggestedOrder}</td>
                            <td>{item.soldInPeriod}</td>
                            <td>{item.criticalityScore.toFixed(1)}</td>
                            <td>
                              <span className={`status-chip ${item.priority.toLowerCase()}`}>
                                {reorderPriorityLabel(item.priority)}
                              </span>
                            </td>
                          </tr>
                        ))}
                        {reorderReport.items.length === 0 && (
                          <tr>
                            <td colSpan={9} className="empty-cell">
                              No hay medicamentos ni material en stock minimo en este momento.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <ul className="compact-bullet-list muted-bullets">
                    {reorderReport.highlights.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </>
              )}
            </article>

            <article className="surface">
              <div className="surface-head compact">
                <div>
                  <h3>Analisis operativo</h3>
                </div>
                <span className={`status-pill ${insightSource === "aion" ? "accent" : "success"}`}>
                  {insightSource}
                </span>
              </div>
              <ul className="insight-list">
                {insights.map((insight) => (
                  <li key={insight}>{insight}</li>
                ))}
                {insights.length === 0 && <li>Sin analisis disponible.</li>}
              </ul>
            </article>

            <article className="surface">
              <div className="surface-head compact">
                <div>
                  <h3>Bitacora y caja</h3>
                </div>
              </div>
              <p className="muted-line">
                Caja actual:
                {" "}
                {cashOverview.openSession
                  ? moneyFormatter.format(cashOverview.openSession.expectedAmount)
                  : "sin caja abierta"}
              </p>
              <details className="compact-details" open>
                <summary>Bitacora reciente</summary>
                <div className="details-content">
                  <div className="data-table-wrap medium">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Fecha</th>
                          <th>Entidad</th>
                          <th>Accion</th>
                          <th>Mensaje</th>
                        </tr>
                      </thead>
                      <tbody>
                        {auditLogs.map((log) => (
                          <tr key={log.id}>
                            <td>{datetimeFormatter.format(new Date(log.createdAt))}</td>
                            <td>{log.entityType}</td>
                            <td>{log.action}</td>
                            <td>{log.message}</td>
                          </tr>
                        ))}
                        {auditLogs.length === 0 && (
                          <tr>
                            <td colSpan={4} className="empty-cell">
                              Sin movimientos en bitacora.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </details>
            </article>
          </div>
        </section>
      )}
        </main>
      </div>
    </div>
  );
}

export default App;
