import prismaClientPackage from "@prisma/client";
import type { ProductKind as ProductKindCode } from "@prisma/client";

const { PrismaClient, ProductKind } = prismaClientPackage;

const prisma = new PrismaClient();

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
  await prisma.appointment.deleteMany({
    where: {
      patientName: {
        startsWith: "Paciente Demo",
      },
    },
  });

  await prisma.sale.deleteMany({
    where: {
      customerName: {
        startsWith: "Cliente Demo",
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

async function seedProducts() {
  const catalogProducts: CatalogProduct[] = [
    {
      sku: "MED-PAR-500",
      name: "Paracetamol 500mg Tabletas",
      commercialName: "Tempra",
      kind: ProductKind.MEDICATION,
      category: "Analgesicos y antiinflamatorios",
      unit: "caja",
      cost: 2.8,
      price: 4.5,
      stock: 120,
      minStock: 30,
      expiresAt: new Date("2027-03-31T00:00:00.000Z"),
    },
    {
      sku: "MED-PAR-650",
      name: "Paracetamol 650mg Tabletas",
      kind: ProductKind.MEDICATION,
      category: "Analgesicos y antiinflamatorios",
      unit: "caja",
      cost: 3.1,
      price: 5.2,
      stock: 90,
      minStock: 25,
      expiresAt: new Date("2027-05-31T00:00:00.000Z"),
    },
    {
      sku: "MED-PAR-JAR-120",
      name: "Paracetamol Jarabe 120ml",
      kind: ProductKind.MEDICATION,
      category: "Analgesicos y antiinflamatorios",
      unit: "frasco",
      cost: 4.4,
      price: 7.5,
      stock: 70,
      minStock: 20,
      expiresAt: new Date("2027-04-30T00:00:00.000Z"),
    },
    {
      sku: "MED-IBU-400",
      name: "Ibuprofeno 400mg Tabletas",
      commercialName: "Advil",
      kind: ProductKind.MEDICATION,
      category: "Analgesicos y antiinflamatorios",
      unit: "caja",
      cost: 3.9,
      price: 6.25,
      stock: 85,
      minStock: 25,
      expiresAt: new Date("2027-01-15T00:00:00.000Z"),
    },
    {
      sku: "MED-IBU-600",
      name: "Ibuprofeno 600mg Tabletas",
      kind: ProductKind.MEDICATION,
      category: "Analgesicos y antiinflamatorios",
      unit: "caja",
      cost: 4.2,
      price: 7.1,
      stock: 75,
      minStock: 20,
      expiresAt: new Date("2027-02-28T00:00:00.000Z"),
    },
    {
      sku: "MED-AMP-500",
      name: "Amoxicilina 500mg Capsulas",
      kind: ProductKind.MEDICATION,
      category: "Antibioticos",
      unit: "caja",
      cost: 5.4,
      price: 8.9,
      stock: 40,
      minStock: 20,
      expiresAt: new Date("2026-11-30T00:00:00.000Z"),
    },
    {
      sku: "MED-AZI-500",
      name: "Azitromicina 500mg",
      kind: ProductKind.MEDICATION,
      category: "Antibioticos",
      unit: "caja",
      cost: 8.6,
      price: 13.8,
      stock: 45,
      minStock: 15,
      expiresAt: new Date("2027-06-30T00:00:00.000Z"),
    },
    {
      sku: "MED-OME-20",
      name: "Omeprazol 20mg",
      commercialName: "Losec",
      kind: ProductKind.MEDICATION,
      category: "Gastrointestinal",
      unit: "caja",
      cost: 3.4,
      price: 5.9,
      stock: 110,
      minStock: 30,
      expiresAt: new Date("2027-08-31T00:00:00.000Z"),
    },
    {
      sku: "MED-LOR-10",
      name: "Loratadina 10mg",
      kind: ProductKind.MEDICATION,
      category: "Alergias y respiratorio",
      unit: "caja",
      cost: 2.6,
      price: 4.7,
      stock: 95,
      minStock: 25,
      expiresAt: new Date("2027-07-31T00:00:00.000Z"),
    },
    {
      sku: "MED-CET-10",
      name: "Cetirizina 10mg",
      kind: ProductKind.MEDICATION,
      category: "Alergias y respiratorio",
      unit: "caja",
      cost: 2.8,
      price: 4.9,
      stock: 80,
      minStock: 20,
      expiresAt: new Date("2027-09-30T00:00:00.000Z"),
    },
    {
      sku: "MED-LOS-50",
      name: "Losartan 50mg",
      kind: ProductKind.MEDICATION,
      category: "Cronicos",
      unit: "caja",
      cost: 6.1,
      price: 9.8,
      stock: 100,
      minStock: 30,
      expiresAt: new Date("2027-10-31T00:00:00.000Z"),
    },
    {
      sku: "MED-MET-500",
      name: "Metformina 500mg",
      kind: ProductKind.MEDICATION,
      category: "Cronicos",
      unit: "caja",
      cost: 4.9,
      price: 7.9,
      stock: 130,
      minStock: 35,
      expiresAt: new Date("2027-12-31T00:00:00.000Z"),
    },
    {
      sku: "MED-DIC-50",
      name: "Diclofenaco 50mg",
      kind: ProductKind.MEDICATION,
      category: "Analgesicos y antiinflamatorios",
      unit: "caja",
      cost: 3.6,
      price: 6.0,
      stock: 78,
      minStock: 20,
      expiresAt: new Date("2027-03-31T00:00:00.000Z"),
    },
    {
      sku: "MED-NAP-550",
      name: "Naproxeno 550mg",
      kind: ProductKind.MEDICATION,
      category: "Analgesicos y antiinflamatorios",
      unit: "caja",
      cost: 4.2,
      price: 7.2,
      stock: 60,
      minStock: 18,
      expiresAt: new Date("2027-06-15T00:00:00.000Z"),
    },
    {
      sku: "MED-SALB-INH",
      name: "Salbutamol Inhalador",
      kind: ProductKind.MEDICATION,
      category: "Alergias y respiratorio",
      unit: "pieza",
      cost: 12.5,
      price: 18.9,
      stock: 35,
      minStock: 10,
      expiresAt: new Date("2027-11-30T00:00:00.000Z"),
    },
    {
      sku: "INS-GUA-100",
      name: "Guantes Desechables",
      kind: ProductKind.MEDICAL_SUPPLY,
      category: "Material quirurgico",
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
      category: "Material quirurgico",
      unit: "pieza",
      cost: 0.45,
      price: 1.1,
      stock: 260,
      minStock: 80,
    },
    {
      sku: "INS-JER-005",
      name: "Jeringa 5ml",
      kind: ProductKind.MEDICAL_SUPPLY,
      category: "Material quirurgico",
      unit: "pieza",
      cost: 0.55,
      price: 1.25,
      stock: 220,
      minStock: 70,
    },
    {
      sku: "INS-GASA-100",
      name: "Gasas Esteriles Paquete",
      kind: ProductKind.MEDICAL_SUPPLY,
      category: "Material quirurgico",
      unit: "paquete",
      cost: 1.2,
      price: 2.3,
      stock: 140,
      minStock: 40,
    },
    {
      sku: "INS-ALC-250",
      name: "Alcohol Antiseptico 250ml",
      kind: ProductKind.MEDICAL_SUPPLY,
      category: "Material quirurgico",
      unit: "frasco",
      cost: 1.9,
      price: 3.4,
      stock: 90,
      minStock: 28,
    },
    {
      sku: "INS-CUB-50",
      name: "Cubrebocas Caja 50",
      kind: ProductKind.MEDICAL_SUPPLY,
      category: "Material quirurgico",
      unit: "caja",
      cost: 3.8,
      price: 6.5,
      stock: 70,
      minStock: 20,
    },
    {
      sku: "INS-TIR-GLU-50",
      name: "Tiras Reactivas Glucosa x50",
      kind: ProductKind.MEDICAL_SUPPLY,
      category: "Material quirurgico",
      unit: "caja",
      cost: 12.9,
      price: 18.5,
      stock: 40,
      minStock: 12,
    },
    {
      sku: "SER-CONS-GEN",
      name: "Consulta General",
      kind: ProductKind.MEDICAL_SERVICE,
      category: "Servicio medico",
      unit: "servicio",
      cost: 0,
      price: 220,
      stock: 0,
      minStock: 0,
    },
    {
      sku: "SER-CONS-ESP",
      name: "Consulta Especializada",
      kind: ProductKind.MEDICAL_SERVICE,
      category: "Servicio medico",
      unit: "servicio",
      cost: 0,
      price: 350,
      stock: 0,
      minStock: 0,
    },
    {
      sku: "SER-GLUC-CAP",
      name: "Chequeo de Glucosa",
      kind: ProductKind.MEDICAL_SERVICE,
      category: "Servicio medico",
      unit: "servicio",
      cost: 0,
      price: 95,
      stock: 0,
      minStock: 0,
    },
    {
      sku: "SER-PRES-CAP",
      name: "Chequeo de Presion Arterial",
      kind: ProductKind.MEDICAL_SERVICE,
      category: "Servicio medico",
      unit: "servicio",
      cost: 0,
      price: 60,
      stock: 0,
      minStock: 0,
    },
    {
      sku: "SER-NEBU-SES",
      name: "Sesion de Nebulizacion",
      kind: ProductKind.MEDICAL_SERVICE,
      category: "Servicio medico",
      unit: "servicio",
      cost: 0,
      price: 140,
      stock: 0,
      minStock: 0,
    },
    {
      sku: "SER-INY-APL",
      name: "Aplicacion de Inyeccion",
      kind: ProductKind.MEDICAL_SERVICE,
      category: "Servicio medico",
      unit: "servicio",
      cost: 0,
      price: 80,
      stock: 0,
      minStock: 0,
    },
  ];

  let createdCount = 0;
  for (const item of catalogProducts) {
    const existing = await prisma.product.findUnique({ where: { sku: item.sku } });
    if (existing) {
      continue;
    }

    await prisma.product.create({
      data: {
        sku: item.sku,
        name: item.name,
        kind: item.kind,
        category: item.category,
        unit: item.unit,
        cost: item.cost,
        price: item.price,
        stock: item.kind === ProductKind.MEDICAL_SERVICE ? 0 : item.stock,
        minStock: item.kind === ProductKind.MEDICAL_SERVICE ? 0 : item.minStock,
        expiresAt:
          item.kind === ProductKind.MEDICATION
            ? (item.expiresAt ?? new Date("2027-12-31T00:00:00.000Z"))
            : null,
        isActive: true,
      },
    });
    createdCount += 1;
  }

  console.log(`Catalogo base aplicado. Nuevos registros creados: ${createdCount}.`);
}

async function main() {
  await cleanupDemoRecords();
  await normalizeLegacyServiceRecords();
  await seedProducts();
  console.log("Seed completado correctamente (sin demos).\n");
}

main()
  .catch((error) => {
    console.error("Error al ejecutar seed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
