export type ModuleKey =
  | "dashboard"
  | "pos"
  | "inventory"
  | "services"
  | "alerts"
  | "appointments"
  | "reports";

export type Product = {
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

export type SaleItem = {
  id: number;
  productId: number;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  product: Product;
};

export type Sale = {
  id: number;
  createdAt: string;
  customerName: string | null;
  notes: string | null;
  subtotal: number;
  discount: number;
  total: number;
  items: SaleItem[];
};

export type Appointment = {
  id: number;
  patientName: string;
  serviceType: string;
  notes?: string | null;
  appointmentAt: string;
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED";
};

export type DashboardSummary = {
  salesToday: number;
  ticketsToday: number;
  sales30Days: number;
  tickets30Days: number;
  totalProducts: number;
  lowStockProducts: number;
  openAppointments: number;
  nextAppointments: Appointment[];
};

export type InventoryAlert = {
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

export type ExpiryAlert = {
  id: number;
  sku: string;
  name: string;
  commercialName: string | null;
  category: string | null;
  expiresAt: string;
  daysToExpire: number;
  status: "EXPIRED" | "EXPIRING_SOON";
};

export type PriceSuggestion = {
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

export type SalesReportTopProduct = {
  productId: number;
  productName: string;
  productCommercialName?: string | null;
  quantity: number;
  revenue: number;
};

export type SalesProductPerformance = {
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

export type SalesTicketSummary = {
  saleId: number;
  createdAt: string;
  customerName: string | null;
  subtotal: number;
  discount: number;
  total: number;
  itemCount: number;
};

export type SalesReport = {
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

export type InventoryMovementReportItem = {
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

export type ReorderPriority = "CRITICAL" | "HIGH" | "MEDIUM";

export type ReorderItem = {
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

export type ReorderReport = {
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

export type Notice = {
  kind: "success" | "error" | "info";
  message: string;
};

export type CartItem = {
  productId: number;
  sku: string;
  name: string;
  kind: Product["kind"];
  quantity: number;
  unitPrice: number;
  maxStock: number;
};
