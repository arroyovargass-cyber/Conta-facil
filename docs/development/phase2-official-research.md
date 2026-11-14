# Fase 2: investigación oficial y alcance inicial

Fecha de consulta: 14 de noviembre de 2026. Estado: investigación inicial; no certifica cumplimiento ni habilita emisión.

## Fuentes primarias

- [Anexos y Estructuras 4.4](https://www.hacienda.go.cr/docs/ANEXOS_Y_ESTRUCTURAS_V4.4.pdf): PDF oficial de 99 páginas. Aunque la portada dice noviembre de 2024, su bitácora incorpora ajustes al 22/04/2026. Página 3 indica vigencia general desde el 01/09/2025. Por ello no basta identificar un archivo únicamente por «4.4».
- [Comunicación de actualización](https://www.hacienda.go.cr/docs/ActualizacionAnexosyEstructurasVersion4.4CEv2.pdf): remite a OVi TRIBUCR, apartado «Comprobantes Electrónicos y Tico Factura», sección «Anexos y Estructuras». Indica disponibilidad de los ajustes en STAG y producción. Dice «1.º de noviembre del presente año» sin año explícito en el texto consultado: no convertir esa frase en una fecha absoluta sin otra evidencia oficial.
- [Portal anterior de esquemas](https://atv.hacienda.go.cr/ATV/ComprobanteElectronico/frmAnexosyEstructuras.aspx): sirve para localizar referencias históricas; el enlace de FacturaElectronica_V4.4.xsd bajo docs/esquemas/2024/v4.4 devuelve 404. No usar una copia de terceros como esquema oficial sin verificar procedencia y revisión.
- [Guía IdP](https://atv.hacienda.go.cr/ATV/ComprobanteElectronico/docs/esquemas/2024/v4.4/Guia_IdP.pdf).
- [API oficial enlazada por el portal](https://atv.hacienda.go.cr/ATV/ComprobanteElectronico/docs/esquemas/2024/v4.4/comprobantes-electronicos-api.html).

## Matriz de verificación pendiente

| Área | Evidencia necesaria antes de habilitarla |
| --- | --- |
| FE, TE, NC, ND, FEC, FEE, REP y mensajes del receptor | XSD oficial actual por tipo, dependencias, namespace, hash y fecha de descarga; matriz de campos obligatorios y condicionales por tipo |
| Identificación | Contrastar soporte alfanumérico de persona jurídica y tipos admitidos con esquema y anexo; revisar validadores existentes de Fase 1 |
| Clientes y catálogo | Formatos oficiales de identificación, actividades, CABYS y unidades; distinguir catálogo comercial de validación tributaria |
| Importes | Precisión, orden de descuentos, bases, impuestos, exoneraciones, redondeo y totales según escenario documentado; cálculos decimales reproducibles |
| Clave y consecutivo | Composición oficial, sucursal/terminal/tipo, reserva transaccional por empresa y ambiente; no reutilizar números emitidos |
| XML | Orden, cardinalidad y condiciones; validación local sin entidades externas ni acceso de red |
| Firma | Perfil exigido, política y certificados, prueba verificable independiente; secretos exclusivamente en backend |
| API/IdP | URLs y clientes oficiales por ambiente, renovación de tokens, límites y contrato de consulta; recepción HTTP separada de resolución tributaria |
| Recuperación | Idempotencia, persistencia previa al envío, consulta tras timeout y reintentos limitados sin duplicar documentos |
| Archivos/PDF/correo | Almacenamiento privado, autorización por empresa/departamento y trazabilidad de entrega |

## Secuencia propuesta para implementación

1. Clientes, productos/servicios y borradores de factura electrónica con aislamiento y permisos; sin afirmar validez tributaria.
2. Motor de importes y XML de FE para escenarios explícitamente documentados, con XSD oficial fijado y casos de referencia.
3. Firma, cola, envío y consulta de respuesta definitiva en STAG; pruebas de recuperación e idempotencia.
4. PDF, correo y expansión a los demás tipos de comprobante, verificando cada uno por separado.

Esta secuencia reutiliza la arquitectura existente React/TypeScript/Fastify/PostgreSQL. No agrega contabilidad general ni mezcla recepción automática de correo de Fase 3.

## Bloqueos delimitados

La recuperación del paquete XSD vigente bloquea declarar conforme un generador XML; no impide diseñar catálogos y borradores. Las credenciales y certificado STAG bloquean pruebas reales de firma/transmisión; no deben solicitarse en el chat. La publicación GitHub/Render sigue pendiente de acceso de escritura, de forma independiente del desarrollo local.

La siguiente decisión es aprobar el enfoque incremental antes del diseño detallado de Fase 2. Este documento es una investigación y propuesta, no un diseño aprobado.
