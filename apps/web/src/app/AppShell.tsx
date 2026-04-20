import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import "../App.css";
import brandLogo from "../assets/brand-logo.png";
import type {
  Appointment,
  CartItem,
  DashboardSummary,
  ExpiryAlert,
  InventoryAlert,
  InventoryMovementReportItem,
  ModuleKey,
  Notice,
  PriceSuggestion,
  Product,
  ReorderReport,
  Sale,
  SalesReport,
} from "./types";
import {
  apiRequest,
  calculatePriceSuggestions,
  datetimeFormatter,
  daysAgo,
  defaultCategoryForKind,
  defaultUnitForKind,
  exportRestockReportPdf,
  formatProductLabel,
  generateSkuSuggestion,
  localDateTimeValue,
  localDateValue,
  moneyFormatter,
  normalizeText,
  parseFloatSafe,
  parseIntSafe,
  posMoneyFormatter,
  productKindLabel,
  roundToPosAmount,
} from "./utils";

const moduleOptions: Array<{ key: ModuleKey; label: string }> = [
  { key: "dashboard", label: "Centro" },
  { key: "pos", label: "Punto De Venta" },
  { key: "inventory", label: "Inventario" },
  { key: "services", label: "Servicios" },
  { key: "alerts", label: "Alertas" },
  { key: "appointments", label: "Citas" },
  { key: "reports", label: "Reportes" },
];

function AppShell() {
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

  async function runPriceSuggestions(trigger: "manual" | "monthly-cutoff" | "cost-increase" = "manual") {
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

  async function exportDatabaseBackup() {
    try {
      const result = await apiRequest<{ path: string; fileName: string }>("/database/export", {
        method: "POST",
      });
      setLastBackupPath(result.path);
      setNotice({ kind: "success", message: `Respaldo generado: ${result.fileName}` });
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
        <button type="button" className="refresh-button" onClick={() => void refreshCoreData()} disabled={loadingData}>
          {loadingData ? "Sincronizando..." : "Sincronizar Datos"}
        </button>
      </header>

      <p className="sync-note">
        Ultima actualizacion: {lastSyncAt ? datetimeFormatter.format(lastSyncAt) : "sincronizando"}
      </p>

      {notice && (
        <div className={`notice-banner ${notice.kind}`}>
          <span>{notice.message}</span>
          <button type="button" className="notice-close" onClick={() => setNotice(null)} aria-label="Cerrar mensaje">
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
              <button key={module.key} type="button" className={`module-button ${activeModule === module.key ? "active" : ""}`} onClick={() => setActiveModule(module.key)}>
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
                  <p className="muted-line">Alertas activas: <strong>{alerts.length}</strong></p>
                  <ul className="appointment-list">
                    {alerts.slice(0, 6).map((alert) => (
                      <li key={alert.id}>
                        <div>
                          <strong>{formatProductLabel(alert.name, alert.commercialName)}</strong>
                          <small>{alert.sku}</small>
                        </div>
                        <span>{alert.stock}/{alert.minStock}</span>
                      </li>
                    ))}
                    {alerts.length === 0 && <li>Sin alertas por ahora.</li>}
                  </ul>

                  <details className="compact-details">
                    <summary>Ver analisis IA</summary>
                    <p className="muted-line">Fuente: {insightSource.toUpperCase()}</p>
                    <ul className="insight-list">
                      {insights.map((insight) => <li key={insight}>{insight}</li>)}
                      {insights.length === 0 && <li>Sin analisis disponible.</li>}
                    </ul>
                    <p className="muted-line">Ajuste de mercado: <strong>{Math.round(marketShift * 100)}%</strong></p>
                    <div className="range-box">
                      <label htmlFor="market-shift">Variacion esperada del mercado</label>
                      <input id="market-shift" type="range" min={-0.15} max={0.2} step={0.01} value={marketShift} onChange={(event) => setMarketShift(Number(event.target.value))} />
                      <button type="button" onClick={() => void runPriceSuggestions()}>
                        {loadingSuggestions ? "Calculando..." : "Calcular"}
                      </button>
                    </div>
                    <p className="muted-line">Fuente sugerencias: {suggestionSource.toUpperCase()}</p>
                    <ul className="suggestion-list">
                      {suggestions.slice(0, 5).map((item) => (
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
                            <td colSpan={3} className="empty-cell">Sin ventas registradas.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </article>
              </div>
            </section>
          )}

          {activeModule !== "dashboard" && (
            <section className="workspace">
              <div className="module-header">
                <h2>{moduleOptions.find((module) => module.key === activeModule)?.label}</h2>
                <p>
                  Este modulo se mantiene operativo en la version actual y sera dividido en componentes dedicados durante la refactorizacion V2.
                </p>
              </div>
              <article className="surface">
                <p className="muted-line">
                  La base ya fue preparada para extraer tipos, utilidades y estructura de shell sin dejar archivos duplicados ni contenido huérfano.
                </p>
                <div className="reports-action-row">
                  <button className="secondary-btn" type="button" onClick={() => void runPriceSuggestions()}>
                    Recalcular sugerencias IA
                  </button>
                  <button className="secondary-btn" type="button" onClick={() => void exportDatabaseBackup()}>
                    Exportar base de datos
                  </button>
                  <button
                    className="secondary-btn"
                    type="button"
                    onClick={() => {
                      if (reorderReport) {
                        exportRestockReportPdf(reorderReport);
                        return;
                      }
                      setNotice({ kind: "info", message: "Genera primero el reporte de surtido desde el modulo Reportes en la siguiente iteracion." });
                    }}
                  >
                    Exportar reporte de surtido
                  </button>
                </div>
                {lastBackupPath && <p className="muted-line">Ultimo respaldo guardado en: {lastBackupPath}</p>}
              </article>
            </section>
          )}
        </main>
      </div>

      <footer className="app-credit">Power by Code Solutions Studio</footer>
    </div>
  );
}

export default AppShell;
