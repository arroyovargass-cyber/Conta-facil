# Factura electrónica nacional: operación STAG

Este módulo prepara facturas desde borradores y conserva copias fiscales independientes del catálogo. La presencia de la pantalla no acredita una factura aceptada por Hacienda. Producción continúa fuera del alcance de esta activación.

## Preparar y revisar

1. Seleccionar la empresa autorizada y abrir **Facturación**. En **Mis borradores** se reutiliza el editor con cliente registrado u ocasional, CABYS, IVA y descuentos.
2. Guardar el borrador. Elegirlo en Facturación, indicar actividad del emisor, sucursal, terminal, condición de venta y medios de pago. USD requiere tipo de cambio explícito; CRC usa1.
3. Guardar la preparación; revisar receptor, departamento, totales y requisitos. **Editar preparación** actualiza expresamente su copia desde el borrador actual, usando versiones para evitar sobrescrituras.
4. El propietario con MFA puede confirmar la **Numeración STAG**. Debe indicar deliberadamente el último valor; el servidor impide disminuir la numeración conservada. No se altera ni reinicia la tabla histórica sin ambiente.
5. Solo cuando todos los requisitos verificables estén satisfechos aparece la confirmación de emisión. El envío requiere permiso `invoices.emit`, MFA y acceso al departamento. Descargar requiere `invoices.download` y el mismo ámbito autorizado.

Guardar o actualizar una preparación no firma, transmite ni envía correo. Las preparaciones y los comprobantes mantienen separados documento, firma, transmisión, resultado de Hacienda y correo. Después de emitir se congela la copia fiscal; no se edita el XML firmado ni se recicla su consecutivo.

## Activación: dependencias que siguen pendientes

- **Correspondencia de la llave con el emisor:** el inspector vigente informa `identity_status=pending`. Falta contrastar un perfil oficial de identificación del certificado o un mecanismo oficial de validación y completar esa integración. No existe un botón para cambiarlo a verificado ni una excepción de producción. No inferir la identidad por nombre o por un patrón supuesto del usuario API.
- **Confianza de respuesta:** obtener y comprobar por canal oficial el certificado firmante de respuestas STAG y su huella SHA256. Una firma con el certificado incrustado no basta para confiar en él. La CA de Supabase no es una CA fiscal.
- Las exoneraciones parciales cuyo reparto de clasificación requiera una precisión adicional no verificada permanecen bloqueadas; no se redondea un resumen suponiendo una regla tributaria.
- Identificación real del proveedor del software (`ProveedorSistemas`), sin sustituirla por la del propietario, receptor o emisor.
- Credenciales y llave STAG registradas en la pantalla privada; autenticación STAG real comprobada. La confirmación de numeración no activa credenciales ni valida identidad.
- Perfil fiscal real de la empresa, sucursal/terminal y actividad activos; datos de receptor y detalle completos.
- Para correo: proveedor SMTP y remitente autorizados, habilitar `Mi empresa → configuración de facturación → enviar correo`, y confirmar un destinatario de pruebas. No reutilizar automáticamente el correo dado para una invitación.

Las primeras dos son dependencias técnicas y normativas de desarrollo, no campos que el usuario deba completar con valores ficticios. Evidencia: `docs/development/2026-11-24-emission-identity-trust.md`.

## Configuración del servidor

Mantener `HACIENDA_STAG_EMISSION_ENABLED=false` hasta resolver las dependencias anteriores. Las configuraciones incompletas pausan el procesamiento antes de reclamar trabajos.

- `HACIENDA_SOFTWARE_PROVIDER_ID`: identificación comprobada del proveedor.
- `HACIENDA_RESPONSE_CERTIFICATE_PINS`: arreglo JSON de huellas SHA256 hexadecimales comprobadas, sin separadores. No aceptar la primera huella recibida automáticamente.
- Bóveda: conservar el keyring y la clave activa existentes; no sustituirlos ni rotarlos sin el procedimiento del runbook de custodia.
- SMTP: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`. TLS con validación en servicios remotos. Solo las pruebas locales pueden usar captura SMTP sin TLS.
- El build de producción prepara el motor XSD offline con dependencias y hashes fijados. El build debe conservar `.local/xmlschema-env`, esquemas, política y fuente PDF incorporada al repositorio. Los procesos de validación no descargan recursos al abrir documentos.

Nunca introducir secretos en el chat, repositorio o navegador fuera del formulario privado previsto. La aplicación no devuelve credenciales desde los endpoints de configuración o de descarga.

## Recuperación y límites gratuitos

Los trabajos se guardan en PostgreSQL con leases y hasta8 intentos. El servicio web procesa lotes de hasta4 al iniciar o al atender operaciones de Facturación; no se crean recursos pagados ni se promete ejecución continua mientras Render gratuito esté dormido. **Actualizar estado** consulta el documento y despierta trabajo pendiente cuando está habilitado; no provoca un segundo POST de factura.

Antes del POST se conserva el XML firmado y se marca la frontera de transmisión incierta. Tras una interrupción se consulta la misma clave. Un404 posterior a una incertidumbre exige conciliación; no genera otra clave ni un reenvío automático. La consulta de documentos ya transmitidos puede recuperar su evidencia sin reutilizar una sesión personal caducada.

El correo automático exige aceptación real verificada, los tres artefactos y `send_email=true` en la copia fiscal. **Aceptado por proveedor de correo** no significa entregado en el buzón. Un resultado SMTP incierto se conserva para revisión y no se reintenta automáticamente. Las acciones manuales autorizadas se describen más abajo. Una situación incierta no habilita un segundo POST ni un correo repetido automáticamente.

La factura mantiene su `draft_id` y permite consultar la tarea departamental existente de Cuentas por cobrar cuando el lector tiene ambos permisos. No se crean saldos, cobros ni deuda automática por una venta al contado.

## Cierre del primer circuito

Las pruebas sintéticas no habilitan la producción. Para cerrar la primera emisión real hay que demostrar autenticación STAG, factura aceptada con respuesta XML auténtica y verificada, conservación/descarga y correo real al destinatario de prueba confirmado. Documentar el resultado real y los identificadores sin secretos. Otros comprobantes y la recepción automática siguen siendo fases posteriores.

## Acciones manuales autorizadas

Se incorpora una interfaz de acciones restringida por permiso, MFA y estado, con operación idempotente. La firma se reintenta conservando datos y numeración. Un envío solo puede reintentarse si continúa en cola y no existe una frontera de POST iniciada. Para una transmisión enviada o incierta se consulta la misma clave, nunca se repite el POST por ese botón.

Un reenvío de correo confirmado explícitamente crea una nueva entrega con identificador estable propio. Una entrega en proceso o de resultado incierto no permite reenviar sin conciliación. Las operaciones manuales tienen límites por hora y por documento para impedir bucles o correo masivo accidental. Ninguna acción cambia una resolución fiscal definitiva ni edita datos emitidos.
