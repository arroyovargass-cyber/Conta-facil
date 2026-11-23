# Fase 2B — contraste de anexo y XSD

Consulta: 2026-11-14. Investigación documental; no implementación tributaria ni declaración de vigencia del esquema descargado.

## Fuentes y procedencia

- [Anexo oficial 4.4](https://www.hacienda.go.cr/docs/ANEXOS_Y_ESTRUCTURAS_V4.4.pdf), 99 páginas y bitácora al22/04/2026.
- [XSD FE descargable de Hacienda](https://www.hacienda.go.cr/docs/FacturaElectronica_V4.4.xsd.xml), HTTP200, text/xml,118627bytes. Copia exacta en `docs/reference/hacienda/v4.4/FacturaElectronica.downloaded.xsd`, SHA256 `4d7a1718cf5b09a4816503c08d1701c37b7beca5f212dd82f18d1d3a9a3042ba`.
- [Comunicación de actualización](https://www.hacienda.go.cr/docs/ActualizacionAnexosyEstructurasVersion4.4CEv2.pdf) remite al portal público OVi para documentos actualizados.
- [OVi público](https://ovitribucr.hacienda.go.cr/): la navegación oficial identifica `/comprobantes-electronicos`. Se consultó contenido público sin autenticación; no se obtuvo un paquete actualizado descargable verificable durante esta revisión. No usar servicios de CMS administrativos ni credenciales ajenas.
- [Documentación de xmlschema](https://xmlschema.readthedocs.io/en/stable/features.html): soporte XSD1.1 explícito mediante XMLSchema11, control de acceso a recursos y protección frente a entidades. Es una alternativa técnica evaluada; no se instaló ni se adoptó en runtime.

El [manifest](../reference/hacienda/v4.4/manifest.json) conserva URL, bytes, hashes, namespace, dependencias y bloqueos. La copia se guarda para contraste documental; `runtime_use_allowed=false`. No se cambiaron sus bytes ni se agregaron códigos a mano.

## Hallazgos determinantes

| Tema | Evidencia contrastada | Consecuencia |
| --- | --- | --- |
| Revisión del XSD | El anexo p3 agrega códigos de referencia13–17 y tipos19–20. El XSD descargado no enumera esos valores en CodigoReferenciaType/TipoDocReferenciaType. | Ser oficial y decir4.4 no demuestra incorporar la revisión2026. Bloquear declaración de conformidad vigente y localizar/confirmar paquete actualizado. |
| Firma | El elemento raíz exige ds:Signature con cardinalidad mínima1. Anexo p60 remite a seguridad. | XML sin firma no puede presentarse como válido contra el XSD completo. No insertar firmas ficticias ni cambiar minOccurs para simular aprobación. |
| Versión del validador | El esquema declara vc:minVersion1.1 e importa `../../xmldsig-core-schema.xsd`. | Elegir un motor compatible y resolver dependencias oficiales localmente. No asumir que un parserXML o un validador1.0 bastan. |
| Cantidad | Anexo p27 y XSD coinciden en hasta tres decimales. | El borrador comercial2A admite cinco; la preparación fiscal debe detectar y rechazar los valores incompatibles, sin redondear cantidades silenciosamente. |
| Dinero | DecimalDineroType del XSD:18dígitos totales, cinco decimales, mínimo0, máximo9999999999999.99999. | Reutilizar aritmética exacta, con límites fiscales distintos de los comerciales. Reconfirmar con esquema vigente antes del generador. |
| Redondeo | Anexo p14 incluye regla y ejemplos a cinco decimales:20.203512→20.20351 y20.203518→20.20352. | Fijar política por campo y etapa antes del motor. Documentar interpretación de casos de empate y pedir validación si hay duda, sin inferirla de flotantes. |
| IVA | CodigoTarifaIVAType identifica08 como tarifa general13%; los demás códigos representan tratamientos diferentes. | El perfil inicial propuesto admite solo el escenario explícito de IVA general; no inferir tarifa automáticamente a partir de un CABYS escrito libremente. |
| Base | Anexo p37 incluye otros impuestos específicos en la base cuando corresponda. | Un cálculo simple subtotal×13% solo se aplica a un perfil que excluya esos impuestos y tratamientos especiales. |
| Identificaciones | El anexo admite jurídica alfanumérica; el XSD tiene Numero como string con máximo20. | Validar por tipo/documento según anexo vigente; evitar normalización solo numérica o asumir que maxlength demuestra inscripción. |
| Emisor/receptor | XSD requiere emisor con ubicación estructurada y correo; requiere receptor; actividad emisor seis caracteres. | La dirección libre y los datos opcionales de2A no son suficientes para XML fiscal. Hace falta preparación explícita y catálogos oficiales. |
| CABYS/unidad | El anexo exige códigos aplicables y condiciones particulares (p26–28). | Comprobar existencia, unidad y tratamientos; validación de longitud no equivale a catálogo validado. Nunca inventar códigos para ejemplos. |

## Matriz inicial de campos FE

| Bloque | Campos a mapear | Estado del borrador2A |
| --- | --- | --- |
| Encabezado | Clave, ProveedorSistemas, CodigoActividadEmisor, CodigoActividadReceptor condicional, NumeroConsecutivo, FechaEmision | Faltantes; no asignar numeración en esta investigación. |
| Emisor | Nombre, identificación, ubicación estructurada, correo y condicionales | Datos parciales de empresa; no reutilizar libremente como si fueran perfil fiscal validado. |
| Receptor | Nombre, identificación y condicionales por escenario | Copia comercial existente, identificación opcional y tipo libre; exige confirmación fiscal explícita. |
| Venta | CondicionVenta y dependientes; moneda/tipo de cambio y medios de pago | Solo moneda disponible. |
| Líneas | CABYS, cantidad, unidad, detalle, precio, monto/subtotal/base, impuesto y total de línea | Descripción/cantidad/precio disponibles; sin clasificación fiscal confirmada. |
| Resumen | Desglose bienes/servicios y condición tributaria, ventas, impuestos y total | Solo suma comercial previa a impuestos; nunca mapear directamente como total fiscal. |
| Firma | ds:Signature y perfil XAdES requerido | Ausente; bloquea validación completa y transmisión. |

## Secuencia propuesta y bloqueos

1. Preparación fiscal y motor de cálculo para FE nacional en CRC, venta al contado e IVA general13%, sin descuentos, exoneraciones, referencias ni otros impuestos. El usuario debe confirmar que ese escenario es apropiado como primer incremento.
2. Generación preliminar del contenido XML y diagnóstico de faltantes, sin consumir consecutivos. No declarar validación XSD completa para un XML sin firma.
3. Habilitar validación XSD completa únicamente con paquete vigente confirmado y firma real; luego conectar STAG en el bloque de integración. Las pruebas estructurales y las criptográficas deberán tener resultados separados.

Dudas a resolver antes de implementar reglas afectadas: paquete XSD2026 completo y dependencias; política de redondeo por etapa y casos de empate; catálogos oficiales CABYS/unidades/ubicaciones e identificación/actividad del escenario elegido. Ninguna discrepancia se corrige inventando reglas o alterando un XSD oficial.

## Reconsulta del 23/11/2026 y auditor reproducible

Se recuperaron otra vez el XSD FE y el anexo desde las URLs oficiales anteriores:
ambos mantienen tamaños y SHA256 del manifiesto. El import continúa siendo
`../../xmldsig-core-schema.xsd`; la URL `/docs/xmldsig-core-schema.xsd` intentada
devuelve 404. No se infiere que esa URL sea la ubicación oficial correcta ni
que la dependencia no exista en otro paquete. Persiste la revisión sin confirmar.

`npm run fiscal:schemas:audit` comprueba el archivo FE local por tamaño y SHA256,
requiere hashes y archivos locales explícitos para cada dependencia declarada
y conserva el bloqueo de revisión/uso de runtime. Retorna JSON y código 1 al
bloquear. El resultado actual es DEPENDENCY_NOT_PINNED,
SCHEMA_REVISION_UNCONFIRMED y RUNTIME_USE_DISABLED. No es un fallo de compilación.

El auditor no descarga recursos, no sigue schemaLocation, no procesa entidades
XML ni valida un documento contra XSD. Incluso `package_verified` significa
solamente integridad y autorización declarada en el manifiesto: conserva
xsdValidation=not_run y emissionEnabled=false. La confirmación de revisión debe
respaldarse en documentación oficial; nunca cambiar ese estado solo para lograr
un resultado verde. Falta adoptar un validador compatible con XSD1.1 y obtener
el paquete oficial completo antes de validar, firmar o emitir.

Para incorporar una dependencia verificada, guardar sus bytes oficiales en el
mismo directorio y registrar local_file, bytes y sha256 en su entrada del
manifiesto. Solo se admiten nombres simples; la CLI rechaza symlinks al abrir,
no recorre directorios y limita cada XSD a 2 MiB. Es herramienta de desarrollo,
no endpoint de carga de usuarios ni modificación del servicio ya publicado.
