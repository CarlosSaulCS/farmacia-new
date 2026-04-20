import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import "./App.css";
import brandLogo from "./assets/brand-logo.png";

const defaultApiBaseUrl =
  window.location.protocol === "file:"
    ? "http://127.0.0.1:4000/api"
    : "http://localhost:4000/api";
const API_BASE_URL = import.meta.env.VITE_API_URL ?? defaultApiBaseUrl;

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
  patientName: string;
  serviceType: string;
  notes?: string | null;
  appointmentAt: string;
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED";
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
  sku: string;
  name: string;
  commercialName: string | null;
  category: string | null;
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
  topProducts: SalesReportTopProduct[];
  bestSellingProducts: SalesProductPerformance[];
  leastSellingProducts: SalesProductPerformance[];
  unsoldProducts: SalesProductPerformance[];
  productPerformance: SalesProductPerformance[];
  salesSummary: SalesTicketSummary[];
};

type InventoryMovementReportItem = {
  movementId: number;
  productId: number;
  productSku: string;
  productName: string;
  productCommercialName?: string | null;
  change: number;
  reason: string;
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
  category: string | null;
  stock: number;
  minStock: number;
  targetStock: number;
  suggestedOrder: number;
  soldInPeriod: number;
  dailyVelocity: number;
  priority: ReorderPriority;
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

function exportRestockReportPdf(report: ReorderReport): void {
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "pt",
    format: "a4",
  });

  const generatedAtText = datetimeFormatter.format(new Date(report.generatedAt));
  const rangeFromText = report.range.from.slice(0, 10);
  const rangeToText = report.range.to.slice(0, 10);

  doc.setFontSize(16);
  doc.text("Reporte De Surtido (Medicamento Y Material Quirurgico)", 40, 40);
  doc.setFontSize(10);
  doc.text(`Generado: ${generatedAtText}`, 40, 58);
  doc.text(`Rango: ${rangeFromText} al ${rangeToText}`, 40, 74);
  doc.text(
    `Dias analizados: ${report.periodDays} | Cobertura deseada: ${report.coverageDays}`,
    40,
    90,
  );
  doc.text(
    `Productos a surtir: ${report.totalItems} | Unidades sugeridas: ${report.totalUnitsSuggested}`,
    40,
    106,
  );

  const bodyRows =
    report.items.length > 0
      ? report.items.map((item, index) => [
          String(index + 1),
          String(item.productId),
          item.sku,
          formatProductLabel(item.name, item.commercialName),
          item.category ?? "-",
          String(item.stock),
          String(item.minStock),
          String(item.targetStock),
          String(item.suggestedOrder),
          item.dailyVelocity.toFixed(2),
          item.priority,
        ])
      : [["-", "-", "-", "Sin productos para surtir", "-", "-", "-", "-", "-", "-", "-"]];

  autoTable(doc, {
    startY: 122,
    head: [["#", "ID", "SKU", "Producto", "Categoria", "Stock", "Min", "Objetivo", "Sugerido", "Vel/Dia", "Prioridad"]],
    body: bodyRows,
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [11, 111, 144] },
    columnStyles: {
      0: { cellWidth: 28 },
      1: { cellWidth: 34 },
      2: { cellWidth: 92 },
      3: { cellWidth: 170 },
      4: { cellWidth: 86 },
      5: { cellWidth: 40 },
      6: { cellWidth: 34 },
      7: { cellWidth: 52 },
      8: { cellWidth: 54 },
      9: { cellWidth: 50 },
      10: { cellWidth: 56 },
    },
    didDrawPage: ({ pageNumber }) => {
      doc.setFontSize(9);
      doc.text(
        `Pagina ${pageNumber}`,
        doc.internal.pageSize.getWidth() - 90,
        doc.internal.pageSize.getHeight() - 16,
      );
    },
  });

  const fileDate = new Date().toISOString().slice(0, 10);
  doc.save(`reporte-surtido-${fileDate}.pdf`);
}

const moduleOptions: Array<{ key: ModuleKey; label: string }> = [
  { key: "dashboard", label: "Centro" },
  { key: "pos", label: "Punto De Venta" },
  { key: "inventory", label: "Inventario" },
  { key: "services", label: "Servicios" },
  { key: "alerts", label: "Alertas" },
  { key: "appointments", label: "Citas" },
  { key: "reports", label: "Reportes" },
];

function productKindLabel(kind: Product["kind"]): string {
  if (kind === "MEDICAL_SUPPLY") {
    return "Material quirurgico";
  }
  if (kind === "MEDICAL_SERVICE") {
    return "Servicio medico";
  }
  return "Medicamento";
}

function defaultCategoryForKind(kind: Product["kind"]): string {
  if (kind === "MEDICAL_SUPPLY") {
    return "Material quirurgico";
  }
  if (kind === "MEDICAL_SERVICE") {
    return "Servicio medico";
  }
  return "Medicamento";
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
  return value.toLowerCase().trim();
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
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);

  const [insights, setInsights] = useState<string[]>([]);
  const [insightSource, setInsightSource] = useState<"aion" | "local">("local");
  const [marketShift, setMarketShift] = useState(0);
  const [suggestions, setSuggestions] = useState<PriceSuggestion[]>([]);
  const [suggestionSource, setSuggestionSource] = useState<"aion" | "local">("local");

  const [posSearch, setPosSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [saleNotes, setSaleNotes] = useState("");
  const [saleDiscountPercent, setSaleDiscountPercent] = useState("0");
  const [amountPaid, setAmountPaid] = useState("");
  const [submittingSale, setSubmittingSale] = useState(false);

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
    description: "",
  });
  const [newProductSkuManuallyEdited, setNewProductSkuManuallyEdited] = useState(false);
  const [newService, setNewService] = useState({
    sku: "",
    name: "",
    cost: "",
    price: "",
    description: "",
  });
  const [newServiceSkuManuallyEdited, setNewServiceSkuManuallyEdited] = useState(false);
  const [creatingProduct, setCreatingProduct] = useState(false);
  const [creatingService, setCreatingService] = useState(false);
  const [editServiceId, setEditServiceId] = useState("");
  const [editServiceCost, setEditServiceCost] = useState("");
  const [editServicePrice, setEditServicePrice] = useState("");
  const [editServiceDescription, setEditServiceDescription] = useState("");
  const [editServiceActive, setEditServiceActive] = useState(true);
  const [savingServiceChanges, setSavingServiceChanges] = useState(false);
  const [serviceQuickId, setServiceQuickId] = useState("");
  const [serviceQuickCost, setServiceQuickCost] = useState("");
  const [serviceQuickPrice, setServiceQuickPrice] = useState("");
  const [updatingServiceQuick, setUpdatingServiceQuick] = useState(false);

  const [stockProductId, setStockProductId] = useState("");
  const [stockCost, setStockCost] = useState("");
  const [stockChange, setStockChange] = useState("");
  const [stockReason, setStockReason] = useState("Ajuste rapido");
  const [adjustingStock, setAdjustingStock] = useState(false);

  const [editProductId, setEditProductId] = useState("");
  const [editCommercialName, setEditCommercialName] = useState("");
  const [editCost, setEditCost] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editMinStock, setEditMinStock] = useState("");
  const [editExpiresAt, setEditExpiresAt] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [savingProductChanges, setSavingProductChanges] = useState(false);
  const [runningMonthlyCutoff, setRunningMonthlyCutoff] = useState(false);

  const [appointmentStatusFilter, setAppointmentStatusFilter] = useState<
    "ALL" | "SCHEDULED" | "COMPLETED" | "CANCELLED"
  >("ALL");
  const [appointmentDateFilter, setAppointmentDateFilter] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [appointmentForm, setAppointmentForm] = useState({
    patientName: "",
    serviceType: "Consulta General",
    appointmentAt: localDateTimeValue(new Date(Date.now() + 60 * 60 * 1000)),
    notes: "",
  });
  const [savingAppointment, setSavingAppointment] = useState(false);

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
  const [lastBackupPath, setLastBackupPath] = useState("");
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);

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
        recentSales,
        aiInsights,
      ] = await Promise.all([
        apiRequest<DashboardSummary>("/analytics/dashboard"),
        apiRequest<Product[]>("/products"),
        apiRequest<Product[]>("/products?kind=MEDICAL_SERVICE"),
        apiRequest<Product[]>("/pos/items"),
        apiRequest<{
          alerts: InventoryAlert[];
          expiringAlerts: ExpiryAlert[];
          expirationThresholdDays: number;
        }>("/inventory/alerts"),
        apiRequest<Appointment[]>("/appointments"),
        apiRequest<Sale[]>("/sales"),
        apiRequest<{ source: "aion" | "local"; insights: string[] }>(
          "/ai/business-insights",
        ),
      ]);

      setSummary(dashboard);
      setProducts(productsData);
      setServices(servicesData);
      setPosItems(posCatalog);
      setAlerts(inventoryAlerts.alerts);
      setExpiryAlerts(inventoryAlerts.expiringAlerts);
      setExpirationThresholdDays(inventoryAlerts.expirationThresholdDays);
      setAppointments(appointmentData);
      setSales(recentSales);
      setInsights(aiInsights.insights);
      setInsightSource(aiInsights.source);
      setLastSyncAt(new Date());
    } catch (error) {
      showError(error, "No fue posible cargar la informacion principal.");
    } finally {
      setLoadingData(false);
    }
  }, []);

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
    if (!editProductId) {
      return;
    }

    const selectedProduct = products.find((product) => product.id === Number(editProductId));
    if (!selectedProduct) {
      return;
    }

    setEditCommercialName(selectedProduct.commercialName ?? "");
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
    setEditServiceCost(String(selectedService.cost));
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

    setServiceQuickCost(String(selectedService.cost));
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
    const query = normalizeText(posSearch);
    return posItems
      .filter((product) => product.isActive)
      .filter((product) => {
        if (!query) {
          return true;
        }
        return (
          normalizeText(product.name).includes(query) ||
          normalizeText(product.commercialName ?? "").includes(query) ||
          normalizeText(product.sku).includes(query) ||
          normalizeText(product.category ?? "").includes(query) ||
          normalizeText(productKindLabel(product.kind)).includes(query)
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [posItems, posSearch]);

  const filteredInventory = useMemo(() => {
    const query = normalizeText(inventoryFilter);
    return products
      .filter((product) => {
        if (!query) {
          return true;
        }
        return (
          normalizeText(product.name).includes(query) ||
          normalizeText(product.commercialName ?? "").includes(query) ||
          normalizeText(product.sku).includes(query) ||
          normalizeText(product.category ?? "").includes(query) ||
          normalizeText(productKindLabel(product.kind)).includes(query)
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [inventoryFilter, products]);

  const filteredServices = useMemo(() => {
    const query = normalizeText(serviceFilter);
    return services
      .filter((product) => {
        if (!query) {
          return true;
        }
        return (
          normalizeText(product.name).includes(query) ||
          normalizeText(product.commercialName ?? "").includes(query) ||
          normalizeText(product.sku).includes(query) ||
          normalizeText(product.category ?? "").includes(query)
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [serviceFilter, services]);

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
      await apiRequest<Product>("/products", {
        method: "POST",
        body: JSON.stringify({
          sku: newProduct.sku.trim() || undefined,
          name: newProduct.name.trim(),
          commercialName: newProduct.commercialName.trim() || undefined,
          kind,
          category: defaultCategoryForKind(kind),
          unit: newProduct.unit.trim() || defaultUnitForKind(kind),
          description: newProduct.description.trim() || undefined,
          cost,
          price,
          stock,
          minStock,
          expiresAt: kind === "MEDICATION" ? newProduct.expiresAt : undefined,
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

    const cost = parseFloatSafe(newService.cost, NaN);
    const price = parseFloatSafe(newService.price, NaN);
    if (!newService.name.trim()) {
      setNotice({ kind: "error", message: "El nombre del servicio es obligatorio." });
      return;
    }
    if (Number.isNaN(cost) || cost < 0) {
      setNotice({ kind: "error", message: "El costo del servicio no es valido." });
      return;
    }
    if (Number.isNaN(price) || price <= 0) {
      setNotice({ kind: "error", message: "El precio del servicio debe ser mayor a 0." });
      return;
    }
    if (price < cost) {
      setNotice({ kind: "error", message: "El precio del servicio no puede ser menor al costo." });
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
          cost,
          price,
          stock: 0,
          minStock: 0,
          isActive: true,
        }),
      });

      setNewService({
        sku: "",
        name: "",
        cost: "",
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

    const cost = parseFloatSafe(editServiceCost, NaN);
    const price = parseFloatSafe(editServicePrice, NaN);
    if (Number.isNaN(cost) || cost < 0) {
      setNotice({ kind: "error", message: "El costo del servicio editado no es valido." });
      return;
    }
    if (Number.isNaN(price) || price <= 0) {
      setNotice({ kind: "error", message: "El precio del servicio editado no es valido." });
      return;
    }
    if (price < cost) {
      setNotice({ kind: "error", message: "El precio del servicio no puede ser menor al costo." });
      return;
    }

    setSavingServiceChanges(true);
    try {
      await apiRequest<Product>(`/products/${editServiceId}`, {
        method: "PUT",
        body: JSON.stringify({
          kind: "MEDICAL_SERVICE",
          unit: "servicio",
          cost,
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
    const hasChange = stockChange.trim().length > 0;
    if (!hasCost && !hasChange) {
      setNotice({
        kind: "error",
        message: "Ingresa al menos costo o cambio de cantidad para aplicar ajuste rapido.",
      });
      return;
    }

    const nextCost = hasCost ? parseFloatSafe(stockCost, NaN) : null;
    if (hasCost && (nextCost === null || Number.isNaN(nextCost) || nextCost < 0)) {
      setNotice({ kind: "error", message: "El costo rapido no es valido." });
      return;
    }

    const change = hasChange ? parseIntSafe(stockChange, NaN) : 0;
    if (hasChange && (Number.isNaN(change) || change === 0)) {
      setNotice({ kind: "error", message: "El cambio de cantidad debe ser distinto de 0." });
      return;
    }
    if (hasChange && !stockReason.trim()) {
      setNotice({ kind: "error", message: "Debes indicar un motivo del ajuste de cantidad." });
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

      if (hasChange) {
        await apiRequest<Product>(`/products/${stockProductId}/stock`, {
          method: "PATCH",
          body: JSON.stringify({
            change,
            reason: stockReason.trim(),
          }),
        });
      }

      setStockCost("");
      setStockChange("");
      setStockReason("Ajuste rapido");
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

    const hasCost = serviceQuickCost.trim().length > 0;
    const hasPrice = serviceQuickPrice.trim().length > 0;
    if (!hasCost && !hasPrice) {
      setNotice({ kind: "error", message: "Ingresa costo o precio para actualizar el servicio." });
      return;
    }

    const cost = hasCost ? parseFloatSafe(serviceQuickCost, NaN) : selectedService.cost;
    const price = hasPrice ? parseFloatSafe(serviceQuickPrice, NaN) : selectedService.price;

    if (Number.isNaN(cost) || cost < 0) {
      setNotice({ kind: "error", message: "El costo rapido del servicio no es valido." });
      return;
    }
    if (Number.isNaN(price) || price <= 0) {
      setNotice({ kind: "error", message: "El precio rapido del servicio no es valido." });
      return;
    }
    if (price < cost) {
      setNotice({ kind: "error", message: "El precio del servicio no puede quedar menor al costo." });
      return;
    }

    setUpdatingServiceQuick(true);
    try {
      await apiRequest<Product>(`/products/${serviceQuickId}`, {
        method: "PUT",
        body: JSON.stringify({
          kind: "MEDICAL_SERVICE",
          unit: "servicio",
          cost,
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
          commercialName: editCommercialName.trim() || null,
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
          serviceType: appointmentForm.serviceType.trim(),
          notes: appointmentForm.notes.trim() || undefined,
          appointmentAt: appointmentDate.toISOString(),
        }),
      });

      setAppointmentForm({
        patientName: "",
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

    const daysValue = Math.max(1, Math.min(120, parseIntSafe(reportDays, 30)));
    const coverageValue = Math.max(1, Math.min(60, parseIntSafe(coverageDays, 14)));

    setLoadingReports(true);
    try {
      const [salesReportData, reorderReportData, movementData, aiInsights] = await Promise.all([
        apiRequest<SalesReport>(
          `/reports/sales?from=${encodeURIComponent(fromDate.toISOString())}&to=${encodeURIComponent(toDate.toISOString())}`,
        ),
        apiRequest<ReorderReport>(
          `/reports/reorder?days=${daysValue}&coverageDays=${coverageValue}`,
        ),
        apiRequest<{ count: number; movements: InventoryMovementReportItem[] }>(
          "/inventory/movements?take=140",
        ),
        apiRequest<{ source: "aion" | "local"; insights: string[] }>(
          "/ai/business-insights",
        ),
      ]);

      setSalesReport(salesReportData);
      setReorderReport(reorderReportData);
      setInventoryMovementsReport(movementData.movements);
      setReportDays(String(daysValue));
      setCoverageDays(String(coverageValue));
      setInsights(aiInsights.insights);
      setInsightSource(aiInsights.source);

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

  async function generateRestockReport() {
    setGeneratingRestockPdf(true);
    try {
      const reportsData = await loadReports();
      if (!reportsData) {
        return;
      }

      exportRestockReportPdf(reportsData.reorderReportData);
      setNotice({
        kind: "success",
        message: "Reporte de surtido en PDF generado.",
      });

      const reorderSection = document.getElementById("reorder-report-section");
      reorderSection?.scrollIntoView({ behavior: "smooth", block: "start" });
    } finally {
      setGeneratingRestockPdf(false);
    }
  }

  useEffect(() => {
    if (activeModule !== "reports") {
      return;
    }
    if (salesReport && reorderReport) {
      return;
    }

    void loadReports();
  }, [activeModule, loadReports, salesReport, reorderReport]);

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

  const kpis = [
    {
      label: "Ventas hoy",
      value: moneyFormatter.format(summary?.salesToday ?? 0),
      helper: `${summary?.ticketsToday ?? 0} tickets emitidos`,
    },
    {
      label: "Stock critico",
      value: `${alerts.length}`,
      helper: `${totalShortage} unidades por reponer`,
    },
    {
      label: "Citas pendientes",
      value: `${summary?.openAppointments ?? 0}`,
      helper: "consultas y chequeos programados",
    },
    {
      label: "Ventas 30 dias",
      value: moneyFormatter.format(summary?.sales30Days ?? 0),
      helper: `${summary?.tickets30Days ?? 0} transacciones`,
    },
  ];

  return (
    <div className="app-shell">
      <header className="hero-panel">
        <div className="hero-brand">
          <img className="brand-logo" src={brandLogo} alt="Logo de Farmacia" />
          <div className="hero-brand-copy">
            <p className="hero-tag">SISTEMA PARA FARMACIA</p>
            <h1>Farmacia</h1>
            <p className="hero-copy">
              Punto de venta, inventario, citas y reportes en un solo sistema local.
            </p>
          </div>
        </div>
        <button
          className="refresh-button"
          type="button"
          onClick={() => {
            void refreshCoreData();
          }}
          disabled={loadingData}
        >
          {loadingData ? "Sincronizando..." : "Sincronizar Datos"}
        </button>
      </header>
      <p className="sync-note">
        Ultima actualizacion: {lastSyncAt ? datetimeFormatter.format(lastSyncAt) : "sincronizando"}
      </p>

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
            <p>Panel Operativo</p>
            <h2>Farmacia</h2>
          </div>
          <nav className="module-nav" aria-label="Navegacion de modulos">
            {moduleOptions.map((module) => (
              <button
                key={module.key}
                type="button"
                className={`module-button ${activeModule === module.key ? "active" : ""}`}
                onClick={() => setActiveModule(module.key)}
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
            <h2>Centro De Control</h2>
            <p>Resumen ejecutivo de ventas, alertas, citas e inteligencia operativa.</p>
          </div>

          <div className="kpi-grid">
            {kpis.map((item) => (
              <article key={item.label} className="kpi-card">
                <p className="kpi-label">{item.label}</p>
                <p className="kpi-value">{item.value}</p>
                <p className="kpi-helper">{item.helper}</p>
              </article>
            ))}
          </div>

          <div className="dashboard-grid">
            <article className="surface">
              <h3>Stock Critico</h3>
              <p className="muted-line">
                Alertas activas: <strong>{alerts.length}</strong>
              </p>
              <ul className="appointment-list">
                {alerts.slice(0, 6).map((alert) => (
                  <li key={alert.id}>
                    <div>
                      <strong>{formatProductLabel(alert.name, alert.commercialName)}</strong>
                      <small>{alert.sku}</small>
                    </div>
                    <span>
                      {alert.stock}/{alert.minStock}
                    </span>
                  </li>
                ))}
                {alerts.length === 0 && <li>Sin alertas por ahora.</li>}
              </ul>

              <details className="compact-details">
                <summary>Ver analisis IA</summary>
                <p className="muted-line">Fuente: {insightSource.toUpperCase()}</p>
                <ul className="insight-list">
                  {insights.map((insight) => (
                    <li key={insight}>{insight}</li>
                  ))}
                  {insights.length === 0 && <li>Sin analisis disponible.</li>}
                </ul>
                <p className="muted-line">
                  Ajuste de mercado: <strong>{Math.round(marketShift * 100)}%</strong>
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
                <p className="muted-line">
                  Fuente sugerencias: {suggestionSource.toUpperCase()}
                </p>
                <ul className="suggestion-list">
                  {suggestions.slice(0, 5).map((item) => (
                    <li key={`${item.productId}-${item.suggestedPrice}`}>
                      <div>
                        <strong>{item.productName ?? `Producto #${item.productId}`}</strong>
                        <small>
                          {item.reason}
                          {typeof item.currentCost === "number" &&
                            typeof item.currentPrice === "number" && (
                              <>
                                {` | Costo: ${moneyFormatter.format(item.currentCost)} | `}
                                {`Publico actual: ${moneyFormatter.format(item.currentPrice)}`}
                              </>
                            )}
                        </small>
                      </div>
                      <span>{moneyFormatter.format(item.suggestedPrice)}</span>
                    </li>
                  ))}
                  {suggestions.length === 0 && <li>Sin sugerencias aun.</li>}
                </ul>
              </details>
            </article>

            <article className="surface">
              <h3>Ventas Recientes</h3>
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Ticket</th>
                      <th>Cliente</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sales.slice(0, 6).map((sale) => (
                      <tr key={sale.id}>
                        <td>#{sale.id}</td>
                        <td>{sale.customerName ?? "Mostrador"}</td>
                        <td>{moneyFormatter.format(sale.total)}</td>
                      </tr>
                    ))}
                    {sales.length === 0 && (
                      <tr>
                        <td colSpan={3} className="empty-cell">
                          Sin ventas registradas.
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

      {activeModule === "pos" && (
        <section className="workspace">
          <div className="module-header">
            <h2>Punto De Venta</h2>
            <p>Cobro rapido con busqueda de productos y servicios medicos.</p>
          </div>

          <div className="pos-grid">
            <article className="surface">
              <div className="inline-toolbar">
                <label htmlFor="pos-search">Buscar producto o servicio</label>
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
                      <button type="button" onClick={() => addProductToCart(product)}>
                        Agregar
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
              <h3>Ticket Actual</h3>
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
                  disabled={submittingSale || pendingAmount > 0}
                >
                  {submittingSale ? "Procesando venta..." : "Cobrar Y Registrar"}
                </button>
              </form>
            </article>
          </div>
        </section>
      )}

      {activeModule === "inventory" && (
        <section className="workspace">
          <div className="module-header">
            <h2>Inventario</h2>
            <p>
              Registro exclusivo para medicamento y material quirurgico para surtir, con control de
              caducidad (servicios en modulo Servicios/Citas).
            </p>
          </div>

          <div className="inventory-grid">
            <article className="surface">
              <h3>Registro Para Surtir (Medicamento y Material Quirurgico)</h3>
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
                      onChange={(event) =>
                        setNewProduct((current) => ({ ...current, name: event.target.value }))
                      }
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

              <h3>Ajuste Rapido De Costo y Cantidad</h3>
              <form className="field-grid" onSubmit={submitStockAdjustment}>
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
                    <label htmlFor="stock-change">Cambio Cantidad (+/- opcional)</label>
                    <input
                      id="stock-change"
                      type="number"
                      step={1}
                      value={stockChange}
                      onChange={(event) => setStockChange(event.target.value)}
                    />
                  </div>
                </div>
                <div className="field-group">
                  <label htmlFor="stock-reason">Motivo (si cambias cantidad)</label>
                  <input
                    id="stock-reason"
                    value={stockReason}
                    onChange={(event) => setStockReason(event.target.value)}
                  />
                </div>
                <p className="muted-line compact-note">
                  Si el costo supera el precio publico, el sistema alinea el precio automaticamente.
                </p>
                <button className="secondary-btn" type="submit" disabled={adjustingStock}>
                  {adjustingStock ? "Aplicando..." : "Aplicar Ajuste Rapido"}
                </button>
              </form>
            </article>

            <article className="surface">
              <h3>Catalogo De Inventario</h3>
              <div className="inline-toolbar">
                <label htmlFor="inventory-filter">Filtrar</label>
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
                        <td colSpan={9} className="empty-cell">
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
                    <label htmlFor="edit-commercial-name">Nombre Comercial (opcional)</label>
                    <input
                      id="edit-commercial-name"
                      value={editCommercialName}
                      onChange={(event) => setEditCommercialName(event.target.value)}
                      placeholder="Tempra, Advil, etc."
                    />
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

                  <button className="secondary-btn" type="submit" disabled={savingProductChanges}>
                    {savingProductChanges ? "Guardando..." : "Guardar Cambios"}
                  </button>
                </form>
              </details>
            </article>
          </div>
        </section>
      )}

      {activeModule === "services" && (
        <section className="workspace">
          <div className="module-header">
            <h2>Servicios Medicos</h2>
            <p>
              Alta y configuracion de servicios para mostrarlos en Punto de Venta y
              utilizarlos en Citas.
            </p>
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

                <div className="field-grid two-col">
                  <div className="field-group">
                    <label htmlFor="new-service-cost">Costo</label>
                    <input
                      id="new-service-cost"
                      type="number"
                      min={0}
                      step="0.01"
                      value={newService.cost}
                      onChange={(event) =>
                        setNewService((current) => ({
                          ...current,
                          cost: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="field-group">
                    <label htmlFor="new-service-price">Precio Al Publico</label>
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

              <h3>Ajuste Rapido De Servicio (Costo y Precio)</h3>
              <form className="field-grid" onSubmit={submitQuickServiceUpdate}>
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

                <div className="field-grid two-col">
                  <div className="field-group">
                    <label htmlFor="quick-service-cost">Costo</label>
                    <input
                      id="quick-service-cost"
                      type="number"
                      min={0}
                      step="0.01"
                      value={serviceQuickCost}
                      onChange={(event) => setServiceQuickCost(event.target.value)}
                    />
                  </div>
                  <div className="field-group">
                    <label htmlFor="quick-service-price">Precio Al Publico</label>
                    <input
                      id="quick-service-price"
                      type="number"
                      min={0}
                      step="0.01"
                      value={serviceQuickPrice}
                      onChange={(event) => setServiceQuickPrice(event.target.value)}
                    />
                  </div>
                </div>

                {selectedQuickService && (
                  <p className="muted-line compact-note">
                    Servicio seleccionado: <strong>{selectedQuickService.name}</strong>
                  </p>
                )}

                <button className="secondary-btn" type="submit" disabled={updatingServiceQuick}>
                  {updatingServiceQuick ? "Aplicando..." : "Aplicar Ajuste Rapido"}
                </button>
              </form>

              <details className="compact-details">
                <summary>Editar servicio existente</summary>
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

                  <div className="field-grid two-col">
                    <div className="field-group">
                      <label htmlFor="edit-service-cost">Costo</label>
                      <input
                        id="edit-service-cost"
                        type="number"
                        min={0}
                        step="0.01"
                        value={editServiceCost}
                        onChange={(event) => setEditServiceCost(event.target.value)}
                      />
                    </div>
                    <div className="field-group">
                      <label htmlFor="edit-service-price">Precio Al Publico</label>
                      <input
                        id="edit-service-price"
                        type="number"
                        min={0}
                        step="0.01"
                        value={editServicePrice}
                        onChange={(event) => setEditServicePrice(event.target.value)}
                      />
                    </div>
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
              <h3>Catalogo De Servicios</h3>
              <div className="inline-toolbar">
                <label htmlFor="service-filter">Filtrar</label>
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
            <h2>Alertas De Stock</h2>
            <p>
              Cada alerta se calcula por producto cuando el stock actual es menor o
              igual al stock minimo configurado en Inventario, y tambien por
              medicamentos proximos a caducar.
            </p>
          </div>

          <article className="surface">
            <p className="muted-line">
              Alertas activas: <strong>{alerts.length}</strong> | Faltantes totales:
              <strong> {totalShortage}</strong> unidades.
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
                            setActiveModule("inventory");
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

            <h3>Proximos A Caducar ({expirationThresholdDays} dias)</h3>
            <p className="muted-line">
              Medicamentos con vencimiento cercano o vencidos: <strong>{expiryAlerts.length}</strong>
            </p>

            <div className="data-table-wrap tall">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Medicamento</th>
                    <th>SKU</th>
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
                      <td colSpan={5} className="empty-cell">
                        Sin medicamentos proximos a caducar.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>
        </section>
      )}

      {activeModule === "appointments" && (
        <section className="workspace">
          <div className="module-header">
            <h2>Gestion De Citas Y Horarios</h2>
            <p>Agenda de consultas y chequeos con control de estado por paciente.</p>
          </div>

          <div className="appointments-grid">
            <article className="surface">
              <h3>Nueva Cita</h3>
              <form className="field-grid" onSubmit={createAppointment}>
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
              <h3>Agenda Del Dia</h3>
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
                        {appointment.status}
                      </span>
                      <div className="button-row">
                        <button
                          className="ghost-btn"
                          type="button"
                          onClick={() =>
                            void updateAppointmentStatus(appointment.id, "SCHEDULED")
                          }
                        >
                          Programada
                        </button>
                        <button
                          className="ghost-btn"
                          type="button"
                          onClick={() =>
                            void updateAppointmentStatus(appointment.id, "COMPLETED")
                          }
                        >
                          Completar
                        </button>
                        <button
                          className="ghost-btn"
                          type="button"
                          onClick={() =>
                            void updateAppointmentStatus(appointment.id, "CANCELLED")
                          }
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {filteredAppointments.length === 0 && (
                  <p className="empty-cell">Sin citas para el filtro seleccionado.</p>
                )}
              </div>
            </article>
          </div>
        </section>
      )}

      {activeModule === "reports" && (
        <section className="workspace">
          <div className="module-header">
            <h2>Reportes Y Analisis</h2>
            <p>
              Reporte de ventas por periodo, listado de medicamentos necesarios y
              exportaciones operativas.
            </p>
          </div>

          <article className="surface">
            <h3>Configuracion Del Reporte</h3>
            <form
              className="inline-toolbar stack-mobile"
              onSubmit={(event) => {
                event.preventDefault();
                void generateRestockReport();
              }}
            >
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
              <button
                className="primary-btn"
                type="submit"
                disabled={generatingRestockPdf || loadingReports}
              >
                {generatingRestockPdf
                  ? "Generando PDF..."
                  : "Generar Reporte De Surtido PDF"}
              </button>
            </form>

            <p className="muted-line">
              Este boton genera y descarga el PDF de surtido para medicamento y material quirurgico.
            </p>

            <div className="reports-action-row">
              <button
                className="secondary-btn"
                type="button"
                onClick={() => void runMonthlyPriceCutoff()}
                disabled={runningMonthlyCutoff}
              >
                {runningMonthlyCutoff
                  ? "Generando Corte Mensual..."
                  : "Corte De Caja Mensual (IA Precios)"}
              </button>
              <button className="secondary-btn" type="button" onClick={exportSalesCsv}>
                Exportar Ventas CSV
              </button>
              <button className="secondary-btn" type="button" onClick={() => void exportDatabaseBackup()}>
                Exportar Base De Datos
              </button>
            </div>
            {lastBackupPath && (
              <p className="muted-line">Ultimo respaldo guardado en: {lastBackupPath}</p>
            )}
          </article>

          <div className="reports-grid">
            <article className="surface">
              <h3>Reporte De Ventas</h3>
              {loadingReports && <p className="muted-line">Generando reporte...</p>}
              {!loadingReports && salesReport && (
                <>
                  <p className="muted-line">
                    Este reporte desglosa cada ticket con su ID, ingresos, costos estimados,
                    descuentos aplicados y productos mas/menos vendidos.
                  </p>

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

                  <h4 className="subsection-title">Tickets Registrados Con ID</h4>
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
                            <td>{sale.itemCount}</td>
                          </tr>
                        ))}
                        {salesReport.salesSummary.length === 0 && (
                          <tr>
                            <td colSpan={7} className="empty-cell">
                              Sin tickets para el periodo seleccionado.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <h4 className="subsection-title">Movimientos De Inventario (Con ID)</h4>
                  <div className="data-table-wrap tall">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Mov ID</th>
                          <th>Producto ID</th>
                          <th>Producto</th>
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
                            <td colSpan={8} className="empty-cell">
                              Sin movimientos de inventario registrados.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </article>

            <article className="surface" id="reorder-report-section">
              <h3>Productos Necesarios (Reposicion)</h3>
              {loadingReports && <p className="muted-line">Calculando necesidad de reposicion...</p>}
              {!loadingReports && reorderReport && (
                <>
                  <p className="muted-line">
                    {reorderReport.totalItems} productos necesitan reposicion. Unidades sugeridas:
                    <strong> {reorderReport.totalUnitsSuggested}</strong>
                  </p>
                  <div className="data-table-wrap tall">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Producto</th>
                          <th>Stock</th>
                          <th>Objetivo</th>
                          <th>Sugerido</th>
                          <th>Velocidad Dia</th>
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
                            <td>{item.stock}</td>
                            <td>{item.targetStock}</td>
                            <td>{item.suggestedOrder}</td>
                            <td>{item.dailyVelocity.toFixed(2)}</td>
                            <td>
                              <span className={`status-chip ${item.priority.toLowerCase()}`}>
                                {item.priority}
                              </span>
                            </td>
                          </tr>
                        ))}
                        {reorderReport.items.length === 0 && (
                          <tr>
                            <td colSpan={6} className="empty-cell">
                              No hay faltantes de medicamento en este momento.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </article>

            <article className="surface">
              <h3>Analisis Operativo</h3>
              <p className="muted-line">Fuente: {insightSource.toUpperCase()}</p>
              <ul className="insight-list">
                {insights.map((insight) => (
                  <li key={insight}>{insight}</li>
                ))}
                {insights.length === 0 && <li>Sin analisis disponible.</li>}
              </ul>
            </article>
          </div>
        </section>
      )}
        </main>
      </div>

      <footer className="app-credit">Power by Code Solutions Studio</footer>
    </div>
  );
}

export default App;
