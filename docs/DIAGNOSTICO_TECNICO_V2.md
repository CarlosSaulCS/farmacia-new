# Diagnóstico técnico V2 — AION Farmacia Suite

## 1. Veredicto general

El proyecto **sí se puede salvar** y **no conviene eliminarlo**.

La base técnica actual ya resuelve varios pilares importantes:

- arquitectura local sin dependencia obligatoria de hosting
- monorepo con separación entre API, web y desktop
- SQLite + Prisma como base operativa local
- empaquetado con Electron para instalación en Windows
- integración opcional con IA externa por API
- respaldos automáticos de base de datos
- operación offline para ventas, inventario, citas y reportes

La recomendación correcta es usar este repositorio como **base V1 funcional** y construir una **V2 profesional** mediante refactorización estructural, ampliación del modelo de negocio y rediseño visual.

---

## 2. Lo que se conserva

### 2.1 Arquitectura base

Conservar:

- `apps/api`
- `apps/web`
- `apps/desktop`
- monorepo con npm workspaces
- SQLite como motor local inicial
- Prisma ORM
- Electron como empaquetado desktop

### 2.2 Filosofía operativa

Conservar completamente:

- operación local por defecto
- dependencia externa solo para IA AION por API
- respaldo local
- tolerancia a falta de internet
- API local levantada por el runtime desktop

### 2.3 Lógica ya aprovechable

Se puede reutilizar o adaptar:

- creación y edición de productos
- búsqueda de productos
- control básico de stock
- movimientos de inventario
- registro de ventas
- citas básicas
- dashboard operativo inicial
- reportes de ventas
- reporte de resurtido
- exportación de base de datos
- integración con AION con fallback local

---

## 3. Lo que debe refactorizarse

### 3.1 Backend

Problema actual:

- demasiada lógica en `apps/api/src/index.ts`
- rutas, validaciones, reportes, IA, backups y utilidades mezcladas en un único archivo

Riesgos:

- mantenimiento difícil
- crecimiento costoso
- pruebas complejas
- alta probabilidad de regresiones

### 3.2 Frontend

Problema actual:

- `apps/web/src/App.tsx` concentra módulos, estados, formularios, flujos y renderización en un solo archivo grande

Riesgos:

- difícil de mantener
- UI poco escalable
- reutilización limitada
- complejidad creciente al agregar pacientes, caja, consultas y usuarios

### 3.3 Modelo de datos

El modelo actual es útil para una V1, pero es insuficiente para la operación completa de una farmacia con consultorio.

Faltan entidades clave:

- usuarios
- roles
- sesiones de caja
- pagos
- proveedores
- compras
- detalle de compras
- lotes
- caducidades por lote
- pacientes
- consultas médicas
- recetas
- diagnósticos
- seguimiento clínico
- consumo de material por consulta
- auditoría
- alertas persistentes
- configuración del sistema

### 3.4 Diseño visual y UX

Problema actual:

- interfaz funcional pero todavía demasiado cercana a dashboard web genérico
- POS no tiene suficiente peso visual como módulo principal de operación
- inventario y reportes se perciben densos
- experiencia clínica y de pacientes todavía no existe como módulo real

---

## 4. Qué debe rehacerse

### 4.1 Módulos nuevos obligatorios

Agregar:

- autenticación local
- usuarios y permisos
- caja y corte de caja
- pacientes
- consultas
- expediente clínico resumido
- recetas
- proveedores
- compras y entradas a almacén
- lotes y caducidad por lote
- material quirúrgico consumido por servicio
- alertas persistentes
- bitácora de auditoría

### 4.2 Persistencia real de cobro

El POS debe guardar además de subtotal/total:

- método de pago
- monto recibido
- cambio entregado
- usuario/cajero
- sesión de caja
- referencia de operación
- cancelaciones y devoluciones

### 4.3 Motor de alertas real

Las alertas no deben ser solo cálculo momentáneo para vista.

Crear persistencia de:

- alerta
- regla
- prioridad
- estado
- responsable
- fecha de resolución
- historial de acciones

---

## 5. Propuesta de arquitectura V2

## 5.1 Backend propuesto

```text
apps/api/src/
  index.ts
  app.ts
  config/
    env.ts
  core/
    errors/
    middleware/
    utils/
    validators/
  modules/
    auth/
      auth.routes.ts
      auth.service.ts
      auth.schemas.ts
    users/
      users.routes.ts
      users.service.ts
      users.schemas.ts
    products/
      products.routes.ts
      products.service.ts
      products.schemas.ts
    inventory/
      inventory.routes.ts
      inventory.service.ts
      inventory.schemas.ts
    lots/
      lots.routes.ts
      lots.service.ts
    suppliers/
      suppliers.routes.ts
      suppliers.service.ts
    purchases/
      purchases.routes.ts
      purchases.service.ts
    sales/
      sales.routes.ts
      sales.service.ts
      sales.schemas.ts
    cash/
      cash.routes.ts
      cash.service.ts
    patients/
      patients.routes.ts
      patients.service.ts
    appointments/
      appointments.routes.ts
      appointments.service.ts
    consultations/
      consultations.routes.ts
      consultations.service.ts
    prescriptions/
      prescriptions.routes.ts
      prescriptions.service.ts
    reports/
      reports.routes.ts
      reports.service.ts
    alerts/
      alerts.routes.ts
      alerts.service.ts
    ai/
      ai.routes.ts
      ai.service.ts
    backups/
      backups.routes.ts
      backups.service.ts
  prisma/
    schema.prisma
    seed.ts
```

### 5.2 Frontend propuesto

```text
apps/web/src/
  main.tsx
  app/
    AppShell.tsx
    routes.tsx
    providers/
  modules/
    dashboard/
    pos/
    inventory/
    services/
    alerts/
    patients/
    appointments/
    consultations/
    purchases/
    reports/
    settings/
    auth/
  components/
    layout/
    forms/
    tables/
    cards/
    modals/
    feedback/
    charts/
  hooks/
  services/
    api/
  store/
  styles/
    tokens.css
    globals.css
    utilities.css
```

### 5.3 Desktop propuesto

Conservar Electron, pero formalizar:

```text
apps/desktop/
  main.cjs
  preload.cjs
  runtime/
  scripts/
  assets/
  electron-builder.json
```

Agregar en V2:

- verificación de integridad de base local
- manejo más claro de errores de arranque
- pantalla de diagnóstico local
- panel de respaldo/restauración

---

## 6. Propuesta de modelo de base de datos V2

## 6.1 Seguridad y administración

- `Role`
- `User`
- `UserSession`
- `AuditLog`
- `SystemSetting`

## 6.2 Catálogo principal

- `Category`
- `Product`
- `ProductLot`
- `Supplier`
- `Purchase`
- `PurchaseItem`
- `InventoryMovement`
- `PriceSuggestionHistory`

## 6.3 Punto de venta y caja

- `CashRegister`
- `CashSession`
- `Sale`
- `SaleItem`
- `Payment`
- `SaleCancellation`
- `Refund`

## 6.4 Pacientes y clínica

- `Patient`
- `PatientNote`
- `Appointment`
- `Consultation`
- `Diagnosis`
- `Prescription`
- `PrescriptionItem`
- `MedicalService`
- `ConsultationSupplyUsage`

## 6.5 Alertas e IA

- `AlertRule`
- `Alert`
- `AlertEvent`
- `AiSuggestion`
- `AiRequestLog`

## 6.6 Respaldos

- `BackupEvent`
- `RestoreEvent`

---

## 7. Propuesta funcional V2 por módulos

### 7.1 Punto de venta

Debe incluir:

- búsqueda rápida
- lector de código de barras
- venta de medicamentos y servicios
- descuentos controlados
- múltiples métodos de pago
- cambio automático
- impresión de ticket
- devoluciones/cancelaciones
- vínculo con caja activa

### 7.2 Inventario y almacén

Debe incluir:

- stock global
- lotes
- caducidad por lote
- entradas por compra
- ajustes manuales auditados
- transferencias internas
- alertas de resurtido
- alertas de caducidad

### 7.3 Pacientes y citas

Debe incluir:

- alta de paciente
- historial de visitas
- agenda diaria/semanal
- confirmación/cancelación
- enlace con consulta médica

### 7.4 Consultorio

Debe incluir:

- alta de consulta
- diagnóstico
- receta
- observaciones
- consumo de material quirúrgico
- cargo de servicio médico

### 7.5 Reportes

Debe incluir:

- ventas por periodo
- productos más vendidos
- productos menos vendidos
- utilidad estimada
- productos a surtir
- medicamentos por caducar
- movimientos de inventario
- ingresos por servicios médicos
- productividad por usuario
- comparativas por periodos

---

## 8. Integración con IA AION

## 8.1 Qué sí debe hacer la IA

- insights del negocio
- sugerencias de precio
- priorización de resurtido
- resumen ejecutivo de reportes
- búsqueda inteligente asistida
- explicación de anomalías

## 8.2 Qué no debe hacer la IA directamente

- registrar ventas
- descontar inventario sin confirmación humana
- editar expedientes clínicos automáticamente
- cancelar ventas
- cerrar caja
- borrar información

## 8.3 Recomendación técnica

Mantener el enfoque actual:

- sistema local primero
- IA externa solo por API
- fallback local si AION no responde

Esto es correcto y debe conservarse.

---

## 9. Diagnóstico visual V2

## 9.1 Problemas visuales actuales

- demasiadas superficies similares
- jerarquía visual moderada
- poco contraste entre áreas estratégicas
- POS todavía sin identidad propia fuerte
- tablas largas con mucha densidad
- dashboard correcto, pero no memorable ni premium

## 9.2 Objetivo visual V2

Diseñar una interfaz que se sienta como:

- software profesional de escritorio
- rápida de usar en mostrador
- clara para personal no técnico
- elegante pero práctica
- limpia en reportes y administración

## 9.3 Dirección visual recomendada

### Base visual

- tonos claros con contraste sobrio
- azul petróleo / azul clínico / gris suave
- estados claros por color: éxito, pendiente, alerta, crítico
- tipografía limpia y compacta
- espaciado más consistente
- tarjetas y tablas con mejor respiración

### POS

- pantalla dedicada de alta velocidad
- búsqueda dominante arriba
- catálogo con acciones claras
- carrito más limpio
- resumen de cobro muy visible
- métodos de pago y cambio en zona prioritaria

### Inventario

- separar alta, edición y movimientos
- usar tablas con filtros mejores
- destacar stock bajo, caducidad y margen

### Reportes

- KPIs arriba
- comparativas visuales
- exportaciones en bloque claro
- tabla + resumen ejecutivo

### Citas y pacientes

- agenda tipo calendario/lista híbrida
- estados visuales evidentes
- ficha lateral o modal del paciente

---

## 10. Recomendación de ejecución

## Fase 1 — Refactor estructural

Objetivo:

- dividir backend por módulos
- dividir frontend por módulos y componentes
- mantener funcionalidades actuales activas

## Fase 2 — Ampliación de dominio

Objetivo:

- pacientes
- consultas
- caja
- pagos
- compras
- proveedores
- lotes
- auditoría

## Fase 3 — Rediseño visual

Objetivo:

- nuevo sistema visual
- nuevo POS
- nuevas tablas
- mejor UX clínica y de reportes

## Fase 4 — Endurecimiento operativo

Objetivo:

- manejo de errores
- pruebas
- restauración de respaldos
- validaciones más estrictas
- métricas de salud local

---

## 11. Decisión final

### No hacer

- eliminar el repositorio
- rehacer desde cero ignorando lo construido
- mover la operación principal a hosting externo

### Sí hacer

- conservar este repo como base
- evolucionarlo a V2 con refactor importante
- ampliar dominio del negocio
- rediseñar la experiencia visual
- mantener IA externa solo como apoyo por API

---

## 12. Próximo paso recomendado

El siguiente paso correcto es construir el **Plan Maestro V2**, con:

- árbol de carpetas definitivo
- nuevo `schema.prisma`
- backlog por módulos
- orden exacto de implementación
- propuesta visual del sistema

Ese plan debe ejecutarse sobre una rama nueva, por ejemplo:

- `v2-refactor`

para proteger la base actual y avanzar sin romper la V1.
