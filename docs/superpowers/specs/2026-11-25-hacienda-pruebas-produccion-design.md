# Emisión nacional 4.4 en pruebas y producción

Extensión del diseño de emisión nacional del 24 de noviembre. Autorización: solicitud del propietario de completar pruebas y producción, confirmación de que dispone de ambas credenciales y selección explícita de «API oficial HTTPS y verificación XML/firma» el 25 de noviembre de 2026.

## Resultado

Una factura conserva su ambiente desde su preparación. Credenciales, revisión de la llave, conexión, numeración, trabajos y evidencias pertenecen a la empresa y a ese ambiente. El selector nunca migra un documento emitido ni reutiliza su clave. El mismo borrador puede preparar una factura por ambiente; los documentos anteriores conservan su ambiente `test` y sus importes.

Se mantiene el alcance de factura electrónica nacional, con los tratamientos fiscales ya implementados y sus validaciones. Los otros comprobantes y la contabilidad completa siguen fuera de este bloque.

## Perfiles oficiales cerrados

Los valores se verificaron en la guía IdP, anexo 4.4 y documentación API oficiales; véanse las investigaciones del 25 de noviembre en `docs/development`.

| Ambiente interno | Etiqueta | Realm | Cliente | Base de recepción |
| --- | --- | --- | --- | --- |
| `test` | Pruebas | `rut-stag` | `api-stag` | `https://api.comprobanteselectronicos.go.cr/recepcion-sandbox/v1/` |
| `production` | Producción | `rut` | `api-prod` | `https://api.comprobanteselectronicos.go.cr/recepcion/v1/` |

El IdP usa `https://idp.comprobanteselectronicos.go.cr/auth/realms/{realm}/protocol/openid-connect/`. Sin URLs configurables, redirecciones ni cambio automático de ambiente ante errores. El contexto de ejecución Node y el ambiente fiscal son parámetros distintos. Las credenciales cifradas mantienen el ambiente en AAD; no se recifran los valores anteriores.

## Revisión de la llave y activación

La inspección técnica comprueba MAC, PIN, correspondencia clave/certificado, RSA y vigencia. No inventa una correspondencia tributaria a partir del nombre del certificado. El superadministrador con MFA registra una revisión expresa de la pertenencia/autorización de la llave por empresa, identificación tributaria, ambiente, versión y huella, con referencia de la revisión. Se denomina `operator_verified`, nunca validación de identidad por Hacienda. Cambiar identificación o versión invalida esa revisión para nuevas emisiones. La revisión no activa el otro ambiente.

Cada emisión exige además conexión satisfactoria en ese ambiente, numeración confirmada, datos fiscales completos, validador firmado y configuración del proveedor. Producción exige una confirmación expresa de operación real en cada solicitud de emisión. No se crea ni envía una factura ficticia para probar producción. Las banderas de envío se mantienen desactivadas por defecto; no se habilitan recursos o credenciales por el solo despliegue del código.

## Evidencia de respuesta elegida

La política `official_api` usa la procedencia del GET autenticado al origen oficial HTTPS como evidencia del origen de los bytes. El XML debe aprobar XSD oficial completo, cobertura y verificación criptográfica de firma, clave, identificaciones y tipos, importes y correspondencia con el resultado JSON. Esto no certifica de forma independiente la identidad PKI del certificado adjunto. No se añade su huella a una lista de confianza ni se admite ese certificado para otros documentos.

La prueba de procedencia nace dentro del cliente de recepción, después de una respuesta HTTP 200 por el transporte real con TLS/hostname normales. Una capacidad en memoria no serializable liga empresa, ambiente, versión de credencial, clave, hash JSON/XML y fecha. Un objeto copiado, XML subido, correo o callback no puede crear esa capacidad. Un transporte inyectado solo puede generar evidencia sintética dentro de `NODE_ENV=test`; nunca evidencia apta para un proceso publicado. Desactivar TLS debe bloquear la política. La evidencia se conserva de forma inmutable vinculada al documento, junto con el XML original y el método de verificación.

La política previa `pinned_certificate` sigue disponible y cerrada ante huellas ausentes o distintas. No hay retroceso silencioso entre políticas. El valor por defecto sigue siendo el anterior para instalaciones existentes; la política elegida se configura explícitamente en el despliegue.

Estados separados: guardado/preparado, firmado, enviado/procesando, aceptación/rechazo final y correo. Un HTTP 201, JSON terminal sin XML, firma matemática inválida o desajuste de clave/importes nunca produce «Aceptado por Hacienda». Un envío incierto se consulta; no se repite el POST. La aceptación válida describe una transacción, no una autorización general de la llave.

## Persistencia y permisos

Migraciones aditivas: amplían restricciones de ambientes, cambian unicidad de borrador a empresa/borrador/ambiente, añaden ambiente derivado a trabajos y revisión/evidencia privadas. Guardas impiden cambiar ambiente e identidad de un emitido. El trabajador reclama únicamente ambientes habilitados y no consume intentos de los deshabilitados. Funciones internas conservan sus capacidades de trabajo arrendadas, permisos mínimos y RLS. No hay acceso público ni de otros tenants a claves, revisión o documentos.

La numeración conserva el piso histórico sin modificar `document_sequences`; es independiente por ambiente, sucursal y terminal. Las operaciones antiguas de pruebas conservan idempotencia incluso si no enviaban un campo `environment`.

## Verificación y límites

Pruebas de perfiles/endpoints, cifrado cruzado, configuración y revisión separadas, secuencias independientes, ambiente inmutable, doble clic/reintentos, capacidad de procedencia falsificada, XML/firma/correlación incorrectos, estados HTTP ambiguos y aislamiento. Pruebas de navegador para los selectores y confirmaciones, sin secretos reales. Se ejecutan todos los controles existentes. La primera aceptación real en STAG depende de credenciales correctamente guardadas y una operación autorizada; la primera operación de producción debe corresponder a una venta real. No se declara validación de integración real por aprobar fixtures sintéticos.
