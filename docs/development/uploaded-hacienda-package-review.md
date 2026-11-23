# Revisión de archivos aportados — 23/11/2026

Siete archivos recibidos. Hashes y tamaños en
`docs/reference/hacienda/v4.4/uploads-20261123.json`. Su procedencia se registra
como descarga aportada por el usuario desde la lista mostrada; no se atribuye
el nuevo hash a la URL antigua que entregaba otros bytes.

## Contraste comprobado

- FE XSD adjunto: 119689 bytes, SHA256
  926ba81325bc21102755bd8e4e570a63caaca086e680a877c3a6d15d6ee8a62f.
  Se conserva aparte del anterior. La configuración de diagnóstico y el manifiesto
  apuntan a este adjunto. Producción y emisión continúan deshabilitadas.
- Anexo PDF: idéntico SHA256 al consultado anteriormente, bitácora 22/04/2026.
- Códigos de referencia FE: incorpora 13,14,15,16. Tipos documentales de
  referencia: incorpora 19 y 20. El código 17 de Nota 9 no es discrepancia para FE:
  nota al pie 35, página 73, dice que es exclusivo del Recibo Electrónico de Pago.
  La investigación anterior omitía esta condición; queda corregida aquí.
- Firma raíz: sigue siendo obligatoria, ahora entre 1 y 5 instancias. No se
  eliminó ni alteró esa exigencia para hacer pasar XML sin firma.
- Otras diferencias exactas contra el anterior: dos restricciones decimales pasan
  de 5 dígitos/2 decimales a 10/5; un mínimo entero pasa de 10000000 a 100;
  ClaveType admite 50 caracteres alfanuméricos. Este contraste no cambia la
  generación de clave ni autoriza tratamientos tributarios por sí mismo.
- La dependencia ds:Signature conserva schemaLocation ../../xmldsig-core-schema.xsd.
  Se mantiene la combinación W3C candidata solo para diagnóstico local, con hashes
  fijados y sin red; no se afirma certificación de firma ni paquete completo.

## API y autenticación

El HTML se leyó como datos, sin ejecutar scripts. Su texto se conserva en
api-user-upload-20261123.txt; original y hash están registrados. Indica API v1,
no versión XML. POST /recepcion responde HTTP201 para recepción técnica; la
aceptación tributaria se determina después mediante GET /recepcion/{clave}.
El cuerpo de consulta incluye ind-estado con recibido, procesando, aceptado,
rechazado y error, y respuesta-xml cuando corresponde.

El contrato describe XML firmado XAdES-EPES en UTF-8/base64; la respuesta XML de
Hacienda se describe con XAdES-XL. No basta la presencia de un elemento Signature:
se requiere verificación criptográfica y política aplicable.

Duda pendiente de contraste: la guía API limita numeroIdentificacion a 12,
mientras el XSD aportado admite identificadores de hasta20. No imponer la regla
antigua a identificadores nuevos sin verificar contrato vigente o pruebas STAG.
La guía IdP declara actualización al29/10/2018: confirma ejemplos api-stag y
form-urlencoded, renovación y cierre; no se ejecutaron comandos, contraseñas ni
tokens de ejemplo. Su antigüedad exige contrastar funcionamiento real.

## Mensaje de Hacienda y ubicación

MensajeHacienda adjunto: namespace mensajeHacienda, XSD1.1, import de firma;
Mensaje permite 1 (aceptado) o 3 (rechazado). No confundir este esquema con
MensajeReceptor ni inferir de aquí una aceptación parcial del receptor.

El XLSX es Codificacionubicacion, no el ZIP completo de codificaciones: una hoja,
7088 filas incluida cabecera, columnas provincia/cantón/distrito/barrio y nombres.
ZIP interno de 2,38MB; se inspeccionó sin ejecutar Excel ni extraer archivos al
sistema. No se asume que contenga CABYS, actividades, medios de pago o tarifas.
Los códigos requieren conservar su representación y jerarquía al importarlos.

El .doc conserva hash y metadatos y se inspeccionaron fragmentos de texto; no se
ejecutaron macros ni se declara revisión completa de su contenido binario.

## Verificación del cambio

Seis pruebas Python aprobadas y nueve pruebas Node específicas aprobadas.
El nuevo caso comprueba 13/16 admitidos,17 excluido de FE, tipos19/20 y firma
obligatoria con máximo5 contra el XSD adjunto real. El CLI de auditoría sigue
bloqueando emisión/revisión no aprobada y dependencia sin fijar para producción;
ese resultado no es un fallo de las pruebas ni invalida el contraste anterior.

Este material resuelve la falta del contrato API y la principal discrepancia de
códigos de FE. Continúa la implementación por perfiles acotados; no se declara
facturación, firma o envío terminados ni se publicó este incremento en Render.
