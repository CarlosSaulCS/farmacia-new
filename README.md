# AION Farmacia Suite

Sistema integral para farmacia con enfoque en:

- Punto de venta (POS)
- Administracion de inventario
- Gestion de citas y servicios (consultas/chequeos)
- Analitica de ventas y productividad
- Reporteria y exportacion de base de datos
- Integracion con IA AION para sugerencias operativas
- Memoria local de analisis para aprender de historicos de ventas, inventario, citas, caja y material

Diseñado para funcionar como software instalable local, sin requerir hosting o alojamiento de pago para operar.

## Stack Tecnologico

- Frontend: React + Vite + TypeScript
- Backend: Node.js + Express + TypeScript
- Base de datos: SQLite con Prisma ORM
- App instalable: Electron + electron-builder
- Monorepo: npm workspaces

## Estructura

- apps/api: API principal (ventas, inventario, citas, reportes, IA, export DB)
- apps/web: dashboard de administracion y operacion
- apps/desktop: empaquetado instalable para Windows (NSIS)

## Requisitos

- Node.js 24+
- npm 11+

## Arranque Rapido

1. Instalar dependencias:

```bash
npm install
```

2. Crear esquema de base de datos:

```bash
npm run db:push
```

3. Cargar catalogo base opcional, sin datos de prueba:

```bash
npm run db:seed
```

4. Levantar API y Web:

```bash
npm run dev
```

- Web: http://localhost:5173
- API: http://localhost:4000

## Scripts Principales

- npm run dev: inicia API + Web en paralelo
- npm run build: compila API + Web + desktop
- npm run db:push: sincroniza prisma schema con SQLite
- npm run db:seed: carga catalogo base sin datos de prueba
- npm run package:desktop: compila web y genera instalador desktop

## Variables de Entorno

API (apps/api/.env):

- API_HOST: host de escucha de la API (recomendado: 127.0.0.1)
- PORT: puerto de la API
- WEB_ORIGINS: origenes permitidos por CORS
- DATABASE_URL: ruta SQLite para Prisma
- AION_URL: endpoint base de tu IA AION
- AION_API_KEY: token de autenticacion para AION
- BACKUP_ENABLED: habilita/deshabilita respaldo automatico
- BACKUP_DIRECTORY: carpeta de respaldos
- BACKUP_INTERVAL_MINUTES: intervalo de respaldo automatico
- BACKUP_RETENTION_DAYS: dias de retencion de archivos de respaldo

Web (apps/web/.env):

- VITE_API_URL: URL base de la API (default recomendado: http://localhost:4000/api)

## SKU Inteligente

- En Inventario y Servicios, el SKU se genera automaticamente al escribir el nombre.
- Si deseas, puedes ajustar manualmente el SKU o regenerarlo con el boton `Generar`.

## Nombre Comercial

- En Inventario existe el campo `Nombre Comercial (opcional)` para medicamento y material quirurgico.
- El nombre comercial se registra en base de datos y aparece en catalogos, alertas, movimientos y reportes.
- La busqueda inteligente considera nombre generico, nombre comercial, SKU y categoria.

## Modulos Backend Incluidos

- Productos
  - GET /api/products
  - GET /api/products/search?q=... (incluye nombre comercial)
  - POST /api/products
  - PUT /api/products/:id
  - PATCH /api/products/:id/stock

- Inventario
  - GET /api/inventory/alerts
  - GET /api/inventory/movements?take=120

- Ventas
  - POST /api/sales
  - GET /api/sales

- Citas
  - GET /api/appointments
  - POST /api/appointments
  - PATCH /api/appointments/:id/status

- Analitica y Reportes
  - GET /api/analytics/dashboard
  - GET /api/reports/sales
  - GET /api/reports/sales.csv
  - GET /api/reports/reorder

### Detalle del Reporte de Ventas

El endpoint GET /api/reports/sales incluye analitica ampliada para control operativo:

- IDs de ticket y resumen por venta (subtotal, descuento, total, cantidad de items)
- Ingreso bruto, descuento acumulado y porcentaje de descuento
- Ingreso neto, costo estimado, utilidad estimada y margen estimado
- Productos mas vendidos y menos vendidos (por unidades)
- Productos sin ventas en el periodo
- Tabla de desempeno por producto (ID, SKU, ingreso, costo y utilidad estimada)

Cada linea de venta conserva snapshot de SKU, nombre, nombre comercial, categoria y costo unitario al momento de cobrar. Esto permite auditar correctamente ventas, inventario y rentabilidad en un solo flujo, incluso si despues se actualiza el producto.

- IA AION
  - POST /api/ai/price-adjustments
  - GET /api/ai/business-insights
- Memoria analitica
  - GET /api/analytics/analysis-history

- Base de datos
  - POST /api/database/export

## Exportacion de Base de Datos

El endpoint POST /api/database/export genera una copia del archivo SQLite en:

- apps/api/backups

Adicionalmente, la API crea respaldos automaticos en segundo plano segun la configuracion de entorno.

- En desarrollo: apps/api/backups
- En app instalada: carpeta local del usuario, subcarpeta backups

## Build Instalable (Windows)

1. Asegura que el frontend este compilado.
2. Ejecuta:

```bash
npm run package:desktop
```

Se genera instalador NSIS en:

- apps/desktop/dist

### Documentacion comercial y operativa

- Manual rapido de uso: docs/MANUAL_RAPIDO_USO.md
- Firma del instalador Windows: docs/FIRMA_INSTALADOR_WINDOWS.md
- Politicas legales base: docs/POLITICAS_LEGALES_PLANTILLA.md
- Versionado y actualizaciones: docs/VERSIONADO_ACTUALIZACIONES.md

Para builds firmados, configurar `CSC_LINK` y `CSC_KEY_PASSWORD` y ejecutar:

```bash
npm run package:desktop:signed
```

## Operacion Offline (Sin Hosting)

- El instalador incluye interfaz web compilada y runtime local de API.
- La app desktop levanta automaticamente la API en localhost al abrir.
- La base de datos principal corre localmente en SQLite.
- No se requiere internet para ventas, inventario, citas, reportes o export de BD.
- Si no hay conexion o no configuras AION, el sistema usa logica local para insights y sugerencias.

## Notas de IA AION

- Si AION_URL no esta configurado, el sistema usa logica local para sugerencias e insights.
- Si AION_URL y AION_API_KEY estan configurados, las rutas IA consultan tu servicio externo.
- Cada analisis operativo genera un snapshot local con periodo, metricas, insights y recomendaciones para comparar tendencias contra analisis anteriores.
- El motor local compara el periodo actual contra el periodo anterior equivalente y contra la memoria de snapshots para proyectar ventas, ingreso, stock bajo y unidades por surtir.
