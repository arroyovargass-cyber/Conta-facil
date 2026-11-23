# Motor de diagnóstico XSD 1.1 — 23 de noviembre de 2026

## Alcance terminado de este incremento

Motor real XMLSchema11 (xmlschema 4.3.2, elementpath 5.1.4) en proceso Python
separado, llamado desde Node y por CLI. Los wheels se fijan con SHA256 en
infra/xml-validator-requirements.txt. No se instaló software del sistema.

Preparación Linux con Python 3.10+:

    npm run xml:prepare
    npm run test:xml-validator
    npm run fiscal:xml:validate-snapshot -- /ruta/factura.xml

El último comando es de diagnóstico local. Código 0 indica que coincide con
la copia descargada; no indica vigencia normativa, firma válida ni aceptación
tributaria. Código 1 indica rechazo o error técnico. No hay endpoint HTTP nuevo,
no se reserva numeración, no se persisten XML ni se transmite información.

## Fuentes, compatibilidad y límites

El XSD FE conserva los bytes oficiales y hash del manifiesto. La dependencia
candidata proviene de W3C:
https://www.w3.org/TR/2002/REC-xmldsig-core-20020212/xmldsig-core-schema.xsd

Se conserva íntegra en docs/reference/hacienda/v4.4/candidates, con sus avisos de
licencia, 10293 bytes y SHA256
35cf8197da812c85e40d57891b35c94187569ed474a2dac813ce5090dafcd35c.
Ambos esquemas compilan juntos y se registran en memoria sin resolver imports
externos. No se cambió minOccurs, enumeraciones ni firma obligatoria del XSD.
La compilación técnica de esta combinación no acredita que sea el paquete
vigente distribuido por Hacienda: el manifiesto sigue bloqueado.

La copia histórica W3C contiene un DTD. Solo para esos bytes exactamente fijados,
y después de comprobar tamaño y hash, se usa defuse=never. ElementTree no carga
DTD externos; allow=none prohíbe recursos por ubicación. El XML aportado por el
usuario se procesa por separado con DTD prohibido y defuse=always. No se permite
extender esa excepción a otros esquemas o XML. Las ubicaciones xsi:schemaLocation
del documento no se usan. No se relaja la verificación TLS del sistema.

Consultas: las ubicaciones resueltas del import en Hacienda/CDN devolvieron
404/403; no se afirma que el paquete no exista en otra ubicación. La lectura
pública de OVi no produjo paquete verificable. No se ejecutaron operaciones CMS
de modificación ni se desactivó TLS para abrir el portal en navegador.
ReadTheDocs respondió 403; se consultaron docstrings y firmas API de la versión
instalada para verificar allow, defuse y use_location_hints.

## Aislamiento y privacidad

Entrada máxima de XML 2 MiB; profundidad/elementos/atributos limitados por el
lector. Proceso con 256 MiB de espacio virtual, 5 segundos CPU, 8 segundos de
reloj y 16 KiB de salida. Entorno del hijo sin secretos heredados. Archivos XSD
fijados con lectura acotada, hash previo al parseo y rechazo de enlaces finales.
La salida no contiene mensajes de excepción, XML, valores, rutas privadas ni
credenciales; solo códigos y conteos acotados. El contrato Node exige que
revisionConfirmed y emissionEnabled sean false; firma not_run y Hacienda not_sent.

## Evidencia

- Fallo inicial de import por módulos aún ausentes, seguido de pruebas aprobadas.
- Primer test de red prohibida bloqueaba también file:// de metasquemas internos;
  se corrigió el fixture para prohibir HTTP/HTTPS/FTP manteniendo archivos locales.
- Prueba real XSD1.1: assert @value gt 0 acepta 1 y rechaza 0 usando el mismo
  compilador del worker. Prueba de factura vacía rechazada por campos faltantes
  del XSD FE, no por un namespace desconocido.
- Cinco pruebas Python aprobadas: XSD1.1, estructura FE, ausencia de red, DTD,
  límites y hash alterado (algunos comportamientos comparten caso).
- Tres pruebas Node del proceso real: estructura inválida, bloqueo previo de DTD,
  schemaLocation ignorado y ausencia de valores XML en salida.
- Suite Node completa: 34 archivos, 163 pruebas aprobadas en 42,99 s. Build y
  comprobación de tipos de CLI aprobados. CLI real con factura sintética vacía:
  snapshot_invalid, XSD_STRUCTURE_INVALID, revisión false y emisión false.
- No se enviaron invitaciones, no se modificó la base alojada ni Render.

## Impedimentos para finalizar la facturación

Se requiere confirmar el paquete oficial vigente y las dudas de redondeo ya
registradas antes de implementar las reglas afectadas. Generación XML, perfil
fiscal estructurado, firma XAdES, cola de envío y consulta definitiva STAG,
PDF/correo y pruebas de extremo a extremo todavía no están terminados.
Las credenciales/certificado STAG deben configurarse por canal privado; nunca
se solicitan sus valores en chat. El acceso del primer administrador sigue
pendiente. Este incremento no se declara listo para producción.
