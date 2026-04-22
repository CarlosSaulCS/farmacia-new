# Firma del instalador Windows

Empresa desarrolladora: Code Solutions Studio  
Correo de contacto: contacto@codesolutionsstudio.com.mx  
Producto: Farmacia  
App ID: mx.com.codesolutionsstudio.farmacia

## Estado actual

El proyecto tiene dos rutas de build:

- `npm run package:desktop`: genera instalador sin firma, util para pruebas internas.
- `npm run package:desktop:signed`: genera instalador con configuracion de firma.

Archivos configurados:

- apps/desktop/electron-builder.json
- apps/desktop/electron-builder.signed.json

La configuracion comercial incluye:

- signtoolOptions.publisherName: Code Solutions Studio
- instalador NSIS con opcion de elegir carpeta
- accesos directos en escritorio y menu inicio

## Lo que falta para una firma real

Windows no acepta una firma confiable solo con el logo o el nombre comercial. Se requiere un certificado de firma de codigo emitido por una autoridad certificadora.

Opciones recomendadas:

- Certificado OV Code Signing: suficiente para iniciar venta comercial, pero Windows SmartScreen puede tardar en generar reputacion.
- Certificado EV Code Signing: mas caro, normalmente con mejor reputacion inicial ante SmartScreen.

El certificado debe emitirse a nombre de Code Solutions Studio o la razon social legal equivalente.

## Variables requeridas para firmar

electron-builder puede firmar si encuentra estas variables de entorno:

```powershell
$env:CSC_LINK="C:\ruta\certificado.pfx"
$env:CSC_KEY_PASSWORD="password-del-certificado"
npm run package:desktop:signed
```

Tambien se puede usar un certificado instalado en el almacen de Windows, pero el flujo con .pfx es mas facil de documentar para builds controlados.

## Validacion de firma

Despues de generar el instalador:

```powershell
Get-AuthenticodeSignature .\apps\desktop\dist\Farmacia-0.1.0-Setup.exe
```

Resultado esperado:

- Status: Valid
- SignerCertificate.Subject: debe mostrar Code Solutions Studio o la razon social certificada

## Build sin certificado

Si no hay certificado, usar:

```powershell
npm run package:desktop
```

Ese instalador funciona para pruebas internas, pero Windows puede mostrarlo como app de publicador desconocido o con advertencia SmartScreen. Esto sirve para pilotos controlados, no para distribucion comercial amplia.

## Nota tecnica sobre Windows

La ruta `package:desktop:signed` usa herramientas de firma de electron-builder. En Windows puede requerir ejecutar la terminal como administrador o habilitar permisos de enlaces simbolicos/modo desarrollador, porque electron-builder descarga componentes de firma que contienen enlaces simbolicos.

## Recomendacion comercial

Para venta piloto se puede entregar instalador sin firma explicando la advertencia. Para venta publica, tiendas, clientes corporativos o farmacias con politicas estrictas, usar certificado OV/EV antes de distribuir.
