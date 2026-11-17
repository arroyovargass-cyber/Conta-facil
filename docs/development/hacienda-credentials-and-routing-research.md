# Hacienda: custodia de credenciales y circuito departamental

Consulta:2026-11-14. Investigación y definición de alcance; no implica conexión operativa ni validación tributaria.

## Fuentes primarias consultadas

- [Guía oficial de credenciales de pruebas](https://www.hacienda.go.cr/docs/GuiaparaCredencialesEntornodepruebas.pdf),02/05/2025: usuario/contraseña y llave de pruebas se generan en Tico Factura/Mi Perfil; indica inscripción en RUT con actividad lucrativa como requisito. Sus ejemplos antiguos de PIN deben leerse junto con la política posterior.
- [Política oficial del PIN](https://www.hacienda.go.cr/docs/NuevasPoliticasDeSeguridadPinLlavesCriptograficasComprobantesElectronicos.pdf): describe longitud14 y combinación de mayúscula/minúscula/número/especial para nuevas llaves; permite conservar llaves vigentes con PIN anterior de cuatro dígitos hasta vencimiento o revocación. No inferir una fecha absoluta de transición a partir de un PDF sin fecha explícita.
- [Anexos4.4](https://www.hacienda.go.cr/docs/ANEXOS_Y_ESTRUCTURAS_V4.4.pdf),anexo2 p84–86: firma XAdES-EPES enveloped, condiciones criptográficas, separación de llaves de pruebas/producción. Anexo3 p97–99: transporte HTTPS/JSON, IdP y recepción/consulta de estado.
- [API oficial publicada](https://www.hacienda.go.cr/docs/ComprobantesElectronicosAPI.html): recepción de XML firmado codificadoBase64, consulta de estado y respuesta XML. HTTP201 significa recepción técnica pendiente de validación, no aceptación tributaria definitiva. La documentación contiene ejemplos antiguos y límites de identificación que requieren contrastar con la revisión vigente antes de implementar el contrato completo.
- [Guía IdP oficial](https://www.hacienda.go.cr/docs/Guia_IdP.pdf): describe password/refresh_token, separación de ambientes y ejemplos STAG. El propio documento identifica4.2 como versión al redactarse; no usarlo como prueba de que todo el contrato actual sigue idéntico.

Los enlaces antiguos bajo `atv.../docs/esquemas/2024/v4.4/` de IdP/API devolvieron404 en esta consulta; las rutas anteriores de www.hacienda.go.cr sí respondieron. Ver además la [discrepancia de XSD registrada](phase2b-normative-matrix.md).

## Qué debe distinguir la aplicación

1. Acceso a Conta Fácil: cédula/contraseña/MFA del usuario del SaaS.
2. Usuario y contraseña del API de comprobantes: autenticación ante Hacienda, separados por ambiente. No guardar la contraseña del portal OVi como si fuera la del API.
3. Llave/certificado y su PIN: firma, separados de la contraseña API. No limitar importaciones a PIN de cuatro dígitos ni rechazar una llave vigente solo por utilizar PIN legado.
4. Tokens de acceso/refresco: secretos derivados, nunca retornados al navegador ni registrados en logs.
5. Resultado de apertura del certificado, prueba de acceso API, validez de firma, validación XSD y respuesta tributaria: verificaciones diferentes.

La carga se efectuará en el formulario protegido de la aplicación. No pedir llaves, PIN, contraseñas ni tokens por chat, GitHub o correo de soporte.

## Requisitos de custodia propuestos

- Archivo PKCS12 (.p12/.pfx), PIN y credencialesAPI enviados por HTTPS, límites de tamaño, validación real del contenido y contraseña; no confiar en extensión/MIME.
- Extraer solo metadatos públicos necesarios y comprobar correspondencia clave privada/certificado. Fechas/algoritmo y titularidad se comprueban por separado; no inventar reglas para extraer cédula del Subject ni deducir ambiente a partir de él.
- Cifrado autenticado de secretos con una clave maestra independiente de SESSION_KEY y contexto asociado a empresa, ambiente, versión y tipo. Acceso por servicio/backend; sin lectura directa para authenticated/anon, ni exportación posterior de secretos.
- Rotación transaccional versionada, estado activo/inactivo y auditoría de actor/fecha/acción sin contenido sensible. Desactivar localmente no revoca la llave ante Hacienda; la interfaz debe explicarlo.
- Administradores autorizados con MFA para custodiar/cambiar/probar credenciales. Un responsable CxC/CxP no adquiere acceso a estas por pertenecer al departamento.
- No habilitar emisión por cargar un archivo ni por conseguir un tokenAPI. Los bloqueos fiscales anteriores permanecen hasta superar las verificaciones correspondientes.

## Circuito propuesto

**Salida:** origen comercial → preparación/validación → firma → envío → recepción técnica → consulta y conservación de respuesta definitiva → clasificación documental en Cuentas por cobrar → entrega al cliente y control interno. Los errores técnicos se recuperan sin duplicar envío/documentos. Documentos al contado no se convierten automáticamente en deuda.

**Entrada:** XML por carga manual inicialmente (correo por conector después) → límites/seguridad → identificación de emisor/receptor → duplicados por clave/empresa → validación y consulta aplicable → revisión interna y asignación → bandeja Cuentas por pagar → decisión del receptor autorizada → firma/envío/consulta de mensaje. Una recepción no aprueba un pago ni acepta tributariamente una factura. Revisión, decisión, transmisión y resolución final se mantienen separadas.

**Departamentos:** conservar el departamento de origen y añadir asignación de gestiónCXC/CXP. La empresa selecciona o crea sus departamentos y responsables. Referencias compuestas por tenant impiden cruces. Cambiar la configuración no mueve documentos históricos ni amplía membresías automáticamente. Acceso a una bandeja y acceso a secretos son permisos independientes.

## Alcance confirmado por el usuario

El usuario eligió «Departamentos y bandejas primero», dejando saldos, vencimientos y registro de cobros/pagos para otro incremento. Se preparan rutas y permisos documentales, no contabilidad ni cartera financiera. La configuración/custodia puede avanzar antes de resolver XSD; firma/transmisión y mensajes reales requieren cerrar las dependencias normativas y probar STAG. No declarar esas integraciones operativas por mostrar sus secciones.

## Local implementation checkpoint — 2026-11-16

The official OpenSSL security page describes fixes through 3.5.10, but its stable
3.5.10 archive/checksum and release tag were unavailable (404). The local build
uses official repository commit `84dda7853c130429210b37bee9e5b62366ca8bce`, whose
version is **3.5.10-dev**, as a development security snapshot. It is not presented
as a stable release or a validated production deployment. Reproduce with
`npm run openssl:prepare`; a C compiler, Perl, Git and make are required.
The inspector currently serves synthetic local tests only; no upload endpoint is
registered. Deployment validation and confirmation of applicable advisory fixes
remain prerequisites before accepting real material.

The vault uses an independent, optional versioned keyring. Absence disables
storage; no ephemeral fallback is generated. `npm run vault:local-keys` preserves
existing local configuration and prints no keys. Preserve/back up every key
version needed to decrypt retained credential history.

The local-only migration adds encrypted credential history, metadata, route and
minimal task tables. No departments or memberships are created automatically.
Credential upload, IdP probes, work assignment APIs and the Hacienda/inbox UI are
not implemented by this checkpoint. No XML, fiscal signing, transmission,
receipt ingestion, receivables balances or payments are enabled.
