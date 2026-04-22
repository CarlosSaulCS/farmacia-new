# Versionado y actualizaciones

Producto: Farmacia  
Desarrollador: Code Solutions Studio  
Contacto: contacto@codesolutionsstudio.com.mx

## Esquema de version

Usar versionado semantico:

- MAJOR: cambios incompatibles o migraciones grandes.
- MINOR: nuevas funciones compatibles.
- PATCH: correcciones, ajustes visuales o mejoras menores.

Ejemplo:

- 0.1.0: piloto comercial inicial
- 0.1.1: correccion menor
- 0.2.0: nueva funcion compatible
- 1.0.0: primera version comercial estable

## Estado recomendado actual

Version sugerida para venta piloto:

- 0.1.0

Antes de marcar 1.0.0:

- probar con datos reales en al menos 1 a 3 clientes piloto
- validar respaldos y restauracion
- firmar instalador
- revisar politicas legales
- preparar contrato o licencia
- documentar soporte

## Archivos donde sincronizar version

- package.json
- apps/api/package.json
- apps/web/package.json
- apps/desktop/package.json
- package-lock.json

Despues de cambiar version, ejecutar:

```powershell
npm install --package-lock-only
npm run package:desktop
```

## Proceso de release

1. Confirmar que no hay cambios pendientes:

```powershell
git status --short
```

2. Ejecutar pruebas/build:

```powershell
npm run lint --workspace @farmacia/web
npm run build --workspace @farmacia/web
npm run package:desktop
```

3. Generar respaldo de prueba desde la app.
4. Verificar instalador generado en `apps/desktop/dist`.
5. Si hay certificado, firmar automaticamente con `CSC_LINK` y `CSC_KEY_PASSWORD` usando `npm run package:desktop:signed`.
6. Validar firma con `Get-AuthenticodeSignature`.
7. Crear commit y tag:

```powershell
git add .
git commit -m "Release v0.1.0"
git tag v0.1.0
git push
git push --tags
```

## Proceso de actualizacion en cliente

Antes de actualizar:

1. Abrir Farmacia.
2. Ir a Reportes.
3. Exportar base de datos.
4. Cerrar la aplicacion.
5. Ejecutar el nuevo instalador.
6. Abrir Farmacia y validar:
   - inventario
   - ventas
   - citas
   - reportes
   - respaldos

## Politica de compatibilidad de datos

Toda nueva version debe preservar la base local existente del cliente.

Si una version requiere cambios de base de datos, debe incluir:

- migracion automatica
- respaldo previo
- nota de version
- prueba en copia de base antes de entregar

## Registro de cambios sugerido

Mantener un changelog por version con:

- fecha
- nuevas funciones
- correcciones
- cambios visuales
- cambios de base de datos
- instrucciones especiales de actualizacion

## Canales recomendados

- Piloto: versiones 0.x con clientes controlados.
- Comercial estable: version 1.x.
- Soporte largo: publicar solo builds firmados y probados.
