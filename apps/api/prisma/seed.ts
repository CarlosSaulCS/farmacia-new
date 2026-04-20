import prismaClientPackage from "@prisma/client";
import type { ProductKind as ProductKindCode } from "@prisma/client";

const {
  PrismaClient,
  ProductKind,
  UserRole,
  CashSessionStatus,
  PurchaseStatus,
  AppointmentStatus,
  AlertSeverity,
  AlertStatus,
} = prismaClientPackage;

const prisma = new PrismaClient();
const DEFAULT_PASSWORD_HASH = "CHANGE_ME_BEFORE_PRODUCTION";

type CatalogProduct = {
  sku: string;
  name: string;
  commercialName?: string;
  kind: ProductKindCode;
  category: string;
  unit: string;
  cost: number;
  price: number;
  stock: number;
  minStock: number;
  expiresAt?: Date;
};

async function cleanupDemoRecords() {
  await prisma.consultationSupplyUsage.deleteMany();
  await prisma.consultation.deleteMany({
    where: {
      patient: {
        fullName: {
          startsWith: "Paciente Base",
        },
      },
    },
  });

  await prisma.appointment.deleteMany({
    where: {
      OR: [
        {
          patientName: {
            startsWith: "Paciente Base",
          },
        },
        {
          patient: {
            fullName: {
              startsWith: "Paciente Base",
            },
          },
        },
      ],
    },
  });

  await prisma.patient.deleteMany({
    where: {
      fullName: {
        startsWith: "Paciente Base",
      },
    },
  });

  await prisma.sale.deleteMany({
    where: {
      customerName: {
        startsWith: "Cliente Base",
      },
    },
  });

  await prisma.purchase.deleteMany({
    where: {
      reference: {
        startsWith: "BASE-",
      },
    },
  });

  await prisma.alert.deleteMany({
    where: {
      code: {
        startsWith: "BASE-",
      },
    },
  });
}

async function normalizeLegacyServiceRecords() {
  await prisma.product.updateMany({
    where: {
      unit: "servicio",
      NOT: {
        kind: ProductKind.MEDICAL_SERVICE,
      },
    },
    data: {
      kind: ProductKind.MEDICAL_SERVICE,
      category: "Servicio medico",
      stock: 0,
      minStock: 0,
      expiresAt: null,
    },
  });
}

async function seedUsersAndCash() {
  const admin = await prisma.user.upsert({
    where: { username: "admin" },
    update: {
      fullName: "Administrador General",
      passwordHash: DEFAULT_PASSWORD_HASH,
      role: UserRole.ADMIN,
      isActive: true,
    },
    create: {
      fullName: "Administrador General",
      username: "admin",
      passwordHash: DEFAULT_PASSWORD_HASH,
      role: UserRole.ADMIN,
      isActive: true,
    },
  });

  const cashier = await prisma.user.upsert({
    where: { username: "cajero" },
    update: {
      fullName: "Caja Principal",
      passwordHash: DEFAULT_PASSWORD_HASH,
      role: UserRole.CASHIER,
      isActive: true,
    },
    create: {
      fullName: "Caja Principal",
      username: "cajero",
      passwordHash: DEFAULT_PASSWORD_HASH,
      role: UserRole.CASHIER,
      isActive: true,
    },
  });

  const doctor = await prisma.user.upsert({
    where: { username: "doctor" },
    update: {
      fullName: "Medico Responsable",
      passwordHash: DEFAULT_PASSWORD_HASH,
      role: UserRole.DOCTOR,
      isActive: true,
    },
    create: {
      fullName: "Medico Responsable",
      username: "doctor",
      passwordHash: DEFAULT_PASSWORD_HASH,
      role: UserRole.DOCTOR,
      isActive: true,
    },
  });

  const register = await prisma.cashRegister.upsert({
    where: { id: 1 },
    update: {
      name: "Caja Principal",
      isActive: true,
    },
    create: {
      id: 1,
      name: "Caja Principal",
      isActive: true,
    },
  });

  const openSession = await prisma.cashSession.findFirst({
    where: {
      cashRegisterId: register.id,
      status: CashSessionStatus.OPEN,
    },
  });

  if (!openSession) {
    await prisma.cashSession.create({
      data: {
        cashRegisterId: register.id,
        openedById: cashier.id,
        openingAmount: 1500,
        status: CashSessionStatus.OPEN,
      },
    });
  }

  return { admin, doctor };
}

async function seedProducts() {
  const catalogProducts: CatalogProduct[] = [
    {
      sku: "MED-PAR-500",
      name: "Paracetamol 500mg Tabletas",
      commercialName: "Tempra",
      kind: ProductKind.MEDICATION,
      category: "Medicamento",
      unit: "caja",
      cost: 2.8,
      price: 4.5,
      stock: 120,
      minStock: 30,
      expiresAt: new Date("2027-03-31T00:00:00.000Z"),
    },
    {
      sku: "MED-IBU-400",
      name: "Ibuprofeno 400mg Tabletas",
      commercialName: "Advil",
      kind: ProductKind.MEDICATION,
      category: "Medicamento",
      unit: "caja",
      cost: 3.9,
      price: 6.25,
      stock: 85,
      minStock: 25,
      expiresAt: new Date("2027-01-15T00:00:00.000Z"),
    },
    {
      sku: "MED-AMP-500",
      name: "Amoxicilina 500mg Capsulas",
      kind: ProductKind.MEDICATION,
      category: "Medicamento",
      unit: "caja",
      cost: 5.4,
      price: 8.9,
      stock: 40,
      minStock: 20,
      expiresAt: new Date("2026-11-30T00:00:00.000Z"),
    },
    {
      sku: "MED-OME-20",
      name: "Omeprazol 20mg",
      commercialName: "Losec",
      kind: ProductKind.MEDICATION,
      category: "Medicamento",
      unit: "caja",
      cost: 3.4,
      price: 5.9,
      stock: 110,
      minStock: 30,
      expiresAt: new Date("2027-08-31T00:00:00.000Z"),
    },
    {
      sku: "MED-MET-500",
      name: "Metformina 500mg",
      kind: ProductKind.MEDICATION,
      category: "Medicamento",
      unit: "caja",
      cost: 4.9,
      price: 7.9,
      stock: 130,
      minStock: 35,
      expiresAt: new Date("2027-12-31T00:00:00.000Z"),
    },
    {
      sku: "INS-GUA-100",
      name: "Guantes Desechables",
      kind: ProductKind.MEDICAL_SUPPLY,
      category: "Insumo medico",
      unit: "caja",
      cost: 1.4,
      price: 2.5,
      stock: 160,
      minStock: 45,
    },
    {
      sku: "INS-JER-003",
      name: "Jeringa 3ml",
      kind: ProductKind.MEDICAL_SUPPLY,
      category: "Insumo medico",
      unit: "pieza",
      cost: 0.45,
      price: 1.1,
      stock: 260,
      minStock: 80,
    },
    {
      sku: "INS-GASA-100",
      name: "Gasas Esteriles Paquete",
      kind: ProductKind.MEDICAL_SUPPLY,
      category: "Insumo medico",
      unit: "paquete",
      cost: 1.2,
      price: 2.3,
      stock: 140,
      minStock: 40,
    },
    {
      sku: "SER-CONS-GEN",
      name: "Consulta General",
      kind: ProductKind.MEDICAL_SERVICE,
      category: "Servicio medico",
      unit: "servicio",
      cost: 40,
      price: 220,
      stock: 0,
      minStock: 0,
    },
    {
      sku: "SER-GLUC-CAP",
      name: "Chequeo de Glucosa",
      kind: ProductKind.MEDICAL_SERVICE,
      category: "Servicio medico",
      unit: "servicio",
      cost: 25,
      price: 95,
      stock: 0,
      minStock: 0,
    },
  ];

  let createdCount = 0;
  for (const item of catalogProducts) {
    const existing = await prisma.product.findUnique({ where: { sku: item.sku } });
    if (existing) {
      await prisma.product.update({
        where: { id: existing.id },
        data: {
          name: item.name,
          commercialName: item.commercialName ?? null,
          kind: item.kind,
          category: item.category,
          unit: item.unit,
          cost: item.cost,
          price: item.price,
          minStock: item.kind === ProductKind.MEDICAL_SERVICE ? 0 : item.minStock,
          expiresAt: item.kind === ProductKind.MEDICATION ? (item.expiresAt ?? null) : null,
          isActive: true,
        },
      });
      continue;
    }

    await prisma.product.create({
      data: {
        sku: item.sku,
        name: item.name,
        commercialName: item.commercialName ?? null,
        kind: item.kind,
        category: item.category,
        unit: item.unit,
        cost: item.cost,
        price: item.price,
        stock: item.kind === ProductKind.MEDICAL_SERVICE ? 0 : item.stock,
        minStock: item.kind === ProductKind.MEDICAL_SERVICE ? 0 : item.minStock,
        expiresAt: item.kind === ProductKind.MEDICATION ? (item.expiresAt ?? null) : null,
        isActive: true,
      },
    });
    createdCount += 1;
  }

  console.log(`Catalogo base aplicado. Nuevos registros creados: ${createdCount}.`);
}

async function seedLots() {
  const lotsToCreate = [
    { sku: "MED-PAR-500", lotCode: "LOT-PAR-2027-A", quantity: 60, expiresAt: new Date("2027-03-31T00:00:00.000Z") },
    { sku: "MED-PAR-500", lotCode: "LOT-PAR-2027-B", quantity: 60, expiresAt: new Date("2027-06-30T00:00:00.000Z") },
    { sku: "MED-IBU-400", lotCode: "LOT-IBU-2027-A", quantity: 45, expiresAt: new Date("2027-01-15T00:00:00.000Z") },
    { sku: "MED-AMP-500", lotCode: "LOT-AMP-2026-A", quantity: 40, expiresAt: new Date("2026-11-30T00:00:00.000Z") },
    { sku: "INS-GUA-100", lotCode: "LOT-GUA-2026-A", quantity: 160, expiresAt: null },
  ];

  for (const item of lotsToCreate) {
    const product = await prisma.product.findUnique({ where: { sku: item.sku } });
    if (!product) continue;

    await prisma.productLot.upsert({
      where: {
        productId_lotCode: {
          productId: product.id,
          lotCode: item.lotCode,
        },
      },
      update: {
        quantity: item.quantity,
        expiresAt: item.expiresAt,
      },
      create: {
        productId: product.id,
        lotCode: item.lotCode,
        quantity: item.quantity,
        expiresAt: item.expiresAt,
      },
    });
  }
}

async function seedSupplierAndPurchase() {
  const supplier = await prisma.supplier.upsert({
    where: { id: 1 },
    update: {
      name: "Distribuidora Medica Central",
      contactName: "Area Comercial",
      phone: "4440000000",
      email: "compras@proveedor-demo.local",
      address: "Zona Centro",
      isActive: true,
    },
    create: {
      id: 1,
      name: "Distribuidora Medica Central",
      contactName: "Area Comercial",
      phone: "4440000000",
      email: "compras@proveedor-demo.local",
      address: "Zona Centro",
      isActive: true,
    },
  });

  const purchaseExists = await prisma.purchase.findFirst({
    where: { reference: "BASE-INGRESO-001" },
  });

  if (purchaseExists) return;

  const products = await prisma.product.findMany({
    where: {
      sku: {
        in: ["MED-PAR-500", "MED-IBU-400", "INS-GUA-100"],
      },
    },
  });

  const productBySku = new Map(products.map((item) => [item.sku, item]));
  const items = [
    { sku: "MED-PAR-500", quantity: 120, unitCost: 2.8 },
    { sku: "MED-IBU-400", quantity: 85, unitCost: 3.9 },
    { sku: "INS-GUA-100", quantity: 160, unitCost: 1.4 },
  ]
    .map((item) => {
      const product = productBySku.get(item.sku);
      if (!product) return null;
      return {
        productId: product.id,
        quantity: item.quantity,
        unitCost: item.unitCost,
        lineTotal: Number((item.quantity * item.unitCost).toFixed(2)),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  if (items.length === 0) return;

  const subtotal = Number(items.reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2));

  await prisma.purchase.create({
    data: {
      supplierId: supplier.id,
      reference: "BASE-INGRESO-001",
      notes: "Ingreso inicial de catalogo base V2.",
      subtotal,
      total: subtotal,
      status: PurchaseStatus.RECEIVED,
      receivedAt: new Date(),
      items: {
        create: items,
      },
    },
  });
}

async function seedPatientsAndAppointments(createdById: number, doctorId: number) {
  const patientOne = await prisma.patient.create({
    data: {
      fullName: "Paciente Base Uno",
      phone: "4441111111",
      allergies: "Penicilina",
      medicalNotes: "Control mensual de presion arterial.",
    },
  });

  const patientTwo = await prisma.patient.create({
    data: {
      fullName: "Paciente Base Dos",
      phone: "4442222222",
      medicalNotes: "Seguimiento de glucosa capilar.",
    },
  });

  const appointmentOne = await prisma.appointment.create({
    data: {
      patientId: patientOne.id,
      createdById,
      patientName: patientOne.fullName,
      serviceType: "Consulta General",
      notes: "Revision de tratamiento actual.",
      appointmentAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      status: AppointmentStatus.SCHEDULED,
    },
  });

  await prisma.appointment.create({
    data: {
      patientId: patientTwo.id,
      createdById,
      patientName: patientTwo.fullName,
      serviceType: "Chequeo de Glucosa",
      notes: "Paciente en observacion por control de glucosa.",
      appointmentAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      status: AppointmentStatus.SCHEDULED,
    },
  });

  const consultation = await prisma.consultation.create({
    data: {
      patientId: patientOne.id,
      doctorId,
      appointmentId: appointmentOne.id,
      reason: "Consulta de control general",
      diagnosis: "Hipertension arterial controlada",
      notes: "Continuar monitoreo y revisar adherencia.",
      followUpAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
    },
  });

  const syringe = await prisma.product.findUnique({ where: { sku: "INS-JER-003" } });
  if (syringe) {
    await prisma.consultationSupplyUsage.create({
      data: {
        consultationId: consultation.id,
        productId: syringe.id,
        quantity: 1,
        notes: "Uso de insumo en muestra capilar demo.",
      },
    });
  }
}

async function seedAlertsAndAudit(adminId: number) {
  const lowStockProduct = await prisma.product.findFirst({
    where: { sku: "MED-AMP-500" },
  });

  if (!lowStockProduct) return;

  const alert = await prisma.alert.create({
    data: {
      code: "BASE-LOW-STOCK-MED-AMP-500",
      title: "Stock bajo detectado",
      description: "Amoxicilina 500mg requiere seguimiento de resurtido.",
      severity: AlertSeverity.HIGH,
      status: AlertStatus.ACTIVE,
      relatedEntity: "Product",
      relatedId: lowStockProduct.id,
    },
  });

  await prisma.alertEvent.create({
    data: {
      alertId: alert.id,
      userId: adminId,
      action: "CREATED_BY_SEED",
      notes: "Alerta inicial para pruebas operativas V2.",
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: adminId,
      entity: "Seed",
      entityId: alert.id,
      action: "INITIAL_V2_BOOTSTRAP",
      payload: {
        alertCode: alert.code,
      },
    },
  });
}

async function main() {
  await cleanupDemoRecords();
  await normalizeLegacyServiceRecords();

  const { admin, doctor } = await seedUsersAndCash();
  await seedProducts();
  await seedLots();
  await seedSupplierAndPurchase();
  await seedPatientsAndAppointments(admin.id, doctor.id);
  await seedAlertsAndAudit(admin.id);

  console.log("Seed V2 completado correctamente.\n");
}

main()
  .catch((error) => {
    console.error("Error al ejecutar seed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
