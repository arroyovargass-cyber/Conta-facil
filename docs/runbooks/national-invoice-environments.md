# Factura nacional 4.4: pruebas y producción

Este circuito sustituye las limitaciones STAG del runbook anterior. No prueba por sí solo una aceptación real ni convierte la revisión del administrador en una validación de identidad por Hacienda.

La ampliación local del 26/11 y sus seis migraciones pendientes de aprobación se
detallan en la [matriz de cierre](../development/billing44-closeout.md). No confundir
su verificación local con el código ya publicado o con una aceptación auténtica.

## Preparación del servicio

Aplicar las migraciones `20261125173658_hacienda_environment_enrollment.sql`, `20261125173701_invoice_environment_evidence.sql` y `20261125230940_invoice_job_trust_policy_selection.sql` mediante el flujo revisado de Supabase. Son compatibles con el servicio anterior: conservan `test` y la aridad anterior de las funciones mediante argumentos predeterminados. No modifican numeraciones ni importes históricos.

Mantener las claves de bóveda y `SESSION_KEY` existentes. No regenerarlas al desplegar: protegen las credenciales guardadas. Mantener PostgreSQL con certificado TLS verificado, HTTPS en la aplicación y los validadores/inspector preparados por el build actual.

| Variable | Uso |
| --- | --- |
| `HACIENDA_RESPONSE_TRUST_POLICY=official_api` | Política elegida por el propietario: respuesta canónica por API HTTPS, XSD completo y firma/correlación. |
| `HACIENDA_STAG_PROBE_ENABLED=true` | Habilita el botón que comprueba credenciales del IdP de pruebas. No envía facturas. |
| `HACIENDA_PRODUCTION_PROBE_ENABLED=true` | Habilita esa comprobación en el IdP de producción. No envía facturas. |
| `HACIENDA_STAG_EMISSION_ENABLED=true` | Permite procesar exclusivamente los documentos de pruebas que aprueben todas las validaciones. |
| `HACIENDA_PRODUCTION_EMISSION_ENABLED=true` | Habilitación independiente para ventas reales, después de verificar la integración y configuración. Cada emisión exige confirmación expresa. |
| `HACIENDA_SOFTWARE_PROVIDER_ID` | Identificación tributaria real del proveedor del sistema, obligatoria en el XML. No presumir la identificación del emisor como proveedor. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_FROM`, `SMTP_USER`, `SMTP_PASSWORD` | Correo de entrega del servidor; obligatorio si la configuración congelada solicita envío al cliente. Secretos solamente en Render. |

Todas las banderas nuevas están desactivadas por defecto. Cambiar una variable de Render puede provocar un despliegue; conservar las otras variables. La política alternativa `pinned_certificate` exige huellas oficiales no vacías: `HACIENDA_RESPONSE_CERTIFICATE_PINS` para pruebas y `HACIENDA_PRODUCTION_RESPONSE_CERTIFICATE_PINS` para producción. No hay herencia ni fallback entre políticas/ambientes. No desactivar validación TLS.

## Configuración por empresa

1. Ingresar como superadministrador, seleccionar la empresa y completar MFA.
2. En **Mi empresa**, completar identificación tributaria, razón social, dirección territorial, correo, actividad económica, sucursal y terminal. No usar los datos ficticios iniciales para emitir.
3. En **Hacienda**, seleccionar **Pruebas**. Guardar usuario/contraseña de API, PIN y archivo `.p12`/`.pfx` de ese ambiente desde la página HTTPS. Los campos se limpian después del intento y al cambiar ambiente. Nunca copiar secretos a chat, referencias ni capturas.
4. Ejecutar **Probar conexión** y revisar el resultado y cierre de sesión. Solo se comprueba el acceso al IdP; no es aceptación de una factura.
5. En **Revisión del administrador**, comprobar la identificación del emisor, ambiente, versión y huella. Registrar una referencia no secreta de autorización y confirmar la pertenencia/autorización de esa llave. Esta afirmación administrativa no verifica la identidad PKI ante Hacienda.
6. En **Facturación**, seleccionar el mismo ambiente y confirmar el último consecutivo usado por sucursal/terminal. Ingresar el valor revisado: no copiar un cero si ya existe numeración. El sistema impide disminuir el piso conservado.
7. En **Nueva factura**, elegir cliente registrado u ocasional, completar receptor, ubicación aplicable, CABYS, impuesto por línea, moneda/tipo de cambio y condición/medios de pago. Se puede guardar un borrador incompleto o preparar uno ya guardado. Los precios son antes de impuestos; el servidor recalcula. El tiquete es una elección explícita, no sustituye automáticamente una FE.
8. Revisar **Requisitos para emitir** y sus accesos a configuración. La inscripción activa y el CABYS se comprueban en fuentes oficiales al completar los demás requisitos. Pulsar **Facturar en pruebas**, confirmar y observar por separado firma, transmisión, respuesta y correo. Descargar XML, respuesta y PDF cuando estén disponibles. Un HTTP 201 solo indica recepción técnica.
9. Tras comprobar la primera aceptación de pruebas, repetir la configuración con la llave y credenciales propias de **Producción**, su revisión y su numeración. No se traslada ninguna de esas verificaciones automáticamente.
10. La primera emisión de producción debe ser una venta real autorizada. Marcar la confirmación de operación real y revisar receptor/importes antes de emitir; no enviar una factura ficticia como comprobación técnica.

La dirección de **Correo de envío de comprobantes** es una dirección, no un
interruptor. Para solicitar entrega automática, activar **Enviar comprobantes
aceptados al correo del cliente** y configurar SMTP antes de preparar. La copia
conserva esa elección y el correo del receptor. Cambiar luego el cliente o la
empresa no reescribe un comprobante emitido. La aceptación por el proveedor SMTP
no demuestra recepción final en la bandeja del destinatario.

Los permisos de crear, editar, archivar, preparar, emitir, consultar respuestas,
descargar y reenviar se asignan por separado. El reenvío exige permiso de correo,
lectura, MFA, estado aceptado, destinatario conservado y adjuntos íntegros; no
concede permiso para emitir. Reportes tiene su propio permiso. La numeración
conserva además el control de superadministrador y configuración tributaria.

## Respuestas y recuperación

El estado final requiere la respuesta del GET autenticado al origen oficial del ambiente y la verificación completa. Se conserva el XML original y una observación inmutable con empresa, ambiente, versión, clave, hashes, fecha, endpoint y verificaciones. Nunca se conservan tokens ni contraseñas en esa evidencia. La identidad del firmante no se certifica de forma independiente por PKI: el origen se atribuye al canal HTTPS oficial; el certificado embebido comprueba la integridad matemática del XML y no se convierte en certificado confiable para otros archivos.

Una respuesta importada por correo, carga o callback no puede fabricar procedencia. Para usar esta política se vuelve a consultar el documento canónico en Hacienda. Cambiar la política predeterminada del servidor no altera ni detiene documentos con otra política conservada: la cola comprueba la disponibilidad de la política de cada documento antes de consumir un intento.

Ante un envío incierto, consultar el estado. No repetir el POST por un timeout. Los trabajos externos vencidos requieren conciliación; no se reintentan envíos o correos automáticamente. Las acciones manuales conservan permisos, MFA, límites y operación idempotente. Un ambiente apagado no consume intentos de sus trabajos. El servicio gratuito procesa al iniciar y al consultar el módulo; requiere actividad para continuar el ciclo y no equivale a un trabajador siempre encendido.

Cambiar la llave o identificación invalida su revisión para futuras emisiones. Se conserva la revisión anterior; importar una nueva versión permite revisar la nueva identidad sin reescribir la evidencia histórica. Los documentos emitidos mantienen sus datos, clave, versión y política originales.

## Comprobaciones antes de declarar producción operativa

- Credenciales de ambos ambientes registradas de manera privada y conexiones satisfactorias.
- Revisión y numeración confirmadas por empresa/ambiente, con identificación real del proveedor del sistema.
- Factura de pruebas aceptada realmente por Hacienda y respuesta conservada; el resultado de tests sintéticos no sustituye esta prueba.
- PDF y correo comprobados contra el mismo XML/importe; SMTP real configurado si se solicita entrega al cliente.
- Permisos, aislamiento, reintentos y respaldo/recuperación verificados para el despliegue utilizado.

Los otros comprobantes, los impuestos especiales/tratamientos que el preparador marque no soportados y la contabilidad completa continúan pendientes de sus perfiles normativos específicos; no se sustituyen por códigos o tarifas supuestos.
