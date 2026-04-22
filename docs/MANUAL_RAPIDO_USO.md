# Manual rapido de uso

Producto: Farmacia  
Desarrollador: Code Solutions Studio  
Contacto: contacto@codesolutionsstudio.com.mx

## Instalacion

1. Ejecutar `Farmacia-0.1.0-Setup.exe`.
2. Elegir la carpeta de instalacion si el instalador lo solicita.
3. Abrir Farmacia desde el acceso directo.
4. La aplicacion inicia su API local automaticamente y guarda la base de datos en la carpeta local del usuario.

## Primer uso recomendado

1. Ir a Inventario.
2. Registrar medicamentos y material quirurgico.
3. Definir stock inicial, stock minimo, costo, precio publico, lote y caducidad cuando aplique.
4. Ir a Servicios y registrar servicios medicos o administrativos.
5. Abrir caja en Punto de venta antes de comenzar ventas del dia.
6. Generar un respaldo manual desde Reportes despues de cargar informacion inicial.

## Centro

Muestra una vista resumida del negocio:

- ventas del dia
- stock critico
- citas pendientes
- seguimientos pendientes
- caja activa
- alertas globales
- lectura operativa local

Usar el boton Actualizar si se acaba de registrar informacion y se desea refrescar la vista.

## Punto de venta

1. Abrir caja con monto inicial.
2. Buscar productos o servicios en el catalogo.
3. Agregar al ticket.
4. Revisar subtotal, descuento, total, pago y cambio.
5. Confirmar venta.
6. Al final del turno, cerrar caja con el monto contado.

El sistema descuenta inventario, registra movimiento de caja y conserva el detalle del ticket.

## Inventario

Permite:

- registrar productos
- editar nombre generico, nombre comercial, composicion, categoria, costo y precio
- ajustar stock
- administrar lotes y caducidades
- revisar sugerencia automatica de precio
- buscar por nombre, SKU, categoria o nombre comercial

El stock critico se activa cuando el stock actual es menor o igual al stock minimo.

## Servicios

Permite registrar servicios como consulta, curacion, aplicacion de inyeccion u otros conceptos no ligados a inventario fisico.

Los servicios se pueden vender desde Punto de venta y usarse en citas/consultas.

## Alertas

Agrupa alertas de:

- stock critico o agotado
- caducidad proxima
- citas proximas
- seguimientos pendientes
- baja rotacion
- caja descuadrada
- ventas anormales basicas

Las alertas se calculan con datos locales actuales e historicos.

## Citas y consultas

Nueva cita:

1. Registrar paciente, telefono opcional, servicio, fecha y notas.
2. Guardar con Agendar Cita.

Consulta y servicio medico:

1. Seleccionar paciente.
2. Asociar una cita si aplica.
3. Elegir servicio catalogado o escribir tipo de servicio.
4. Opcional: abrir Notas clinicas opcionales para diagnostico, tratamiento u observaciones.
5. Definir seguimiento si se requiere.
6. Registrar consulta.

El resumen administrativo se genera automaticamente con los datos capturados. Las consultas se guardan en base de datos y aparecen en Historial reciente.

## Reportes

Configurar:

- Desde/Hasta: periodo del reporte de ventas.
- Dias analizados: base para rotacion y surtido.
- Cobertura deseada: dias de stock sugerido.

Reportes disponibles:

- ventas desglosadas
- productos mas/menos vendidos
- utilidad estimada
- reconciliacion con caja
- stock minimo para surtir
- analisis operativo
- bitacora y caja

El boton Exportar PDF de surtido recalcula el reporte antes de generar el PDF.

## Respaldos

En Reportes se puede exportar la base de datos manualmente.

En la app instalada, la base de datos y respaldos se guardan en la carpeta local del usuario. Antes de actualizar o reinstalar, generar un respaldo manual.

## Recomendacion diaria

1. Abrir caja.
2. Revisar Centro.
3. Revisar Alertas.
4. Operar ventas y citas.
5. Revisar Reportes.
6. Generar respaldo.
7. Cerrar caja.

## Soporte

Correo: contacto@codesolutionsstudio.com.mx

Al solicitar soporte, incluir:

- version instalada
- captura del error
- descripcion del paso que produjo el problema
- si es posible, respaldo reciente de la base de datos
