# Hacienda 4.4: evidencia de campos pendientes (2026-11-26)

Investigación de fuentes primarias; no modifica producto, base de datos, paquete XSD ni credenciales. Se descargaron documentos públicos por HTTPS con verificación TLS. No se autenticó ni se enviaron comprobantes. Las páginas indicadas coinciden con la numeración impresa del anexo.

## Fuentes comprobadas

| Fuente oficial | Bytes | SHA-256 |
| --- | ---: | --- |
| [Anexos y estructuras 4.4](https://www.hacienda.go.cr/docs/ANEXOS_Y_ESTRUCTURAS_V4.4.pdf) | 1243035 | `6e093226b29b38c5c8de825f70c1b1cb8ed81e2f4a6eb0b3ff52708fc1eb2769` |
| [FacturaElectronica_V4.4.xsd](https://www.hacienda.go.cr/docs/FacturaElectronica_V4.4.xsd) | 119689 | `926ba81325bc21102755bd8e4e570a63caaca086e680a877c3a6d15d6ee8a62f` |
| [TiqueteElectronico_V4.4.xsd](https://www.hacienda.go.cr/docs/TiqueteElectronico_V4.4.xsd) | 117940 | `d7783baf818f316596d0b58b17481be689595982a248d98102d707f72967ae6e` |
| [API pública: documentación](https://api.hacienda.go.cr/docs/) | 24174 | `8f9b6b82e26d465a45151cadc6970f003146330c62bdcaf917b7c79e157d2819` |
| [Clasificación de actividades económicas](https://www.hacienda.go.cr/ClasificacionActividadesEconomicas.html) | 18969 | `026ecdb3856a740f66afcbce402b82591d09eaf22ccff70ab3a0f466b528478f` |
| [Correspondencia ATV CIIU3 → TRIBU-CR CIIU4](https://www.hacienda.go.cr/docs/CorrespondenciaATVCIIU3-TRIBUCRCIIU4-Completo.pdf) | 134579 | `6e2f5e5356dfd70d048c91158fade86676c7d3b99c127b701604e3f9b1471a9b` |

El FE y el anexo descargados son idénticos a los ya fijados en `docs/reference/hacienda/v4.4/manifest.json`. El TE se incorporó posteriormente al manifiesto como `TiqueteElectronico.downloaded-20261126.xsd`, con el hash de la tabla anterior. FE y TE declaran versión 4.4, mínimo XSD 1.1 e importan XMLDSig desde `../../xmldsig-core-schema.xsd`; se mantiene el mapeo local explícito del paquete existente.

Notación: `?` = 0..1; `[a..b]` = cardinalidad XSD; sin marca = 1..1. `D18,5` = `DecimalDineroType`: decimal no negativo, hasta 18 dígitos totales y 5 decimales, máximo `9999999999999.99999`. La obligatoriedad condicional del anexo se aplica además del XSD.

## FE y tiquete: perfiles distintos

Anexo [p. 66](https://www.hacienda.go.cr/docs/ANEXOS_Y_ESTRUCTURAS_V4.4.pdf#page=66): FE = código `01`; TE = `04` en posiciones 9–10 del consecutivo de 20 posiciones. TE tiene raíz `TiqueteElectronico` y namespace exacto `https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/tiqueteElectronico`.

Secuencia raíz TE:

```text
Clave → ProveedorSistemas → CodigoActividadEmisor → NumeroConsecutivo
→ FechaEmision → Emisor → Receptor? → CondicionVenta → CondicionVentaOtros?
→ PlazoCredito? → DetalleServicio? → OtrosCargos[0..15] → ResumenFactura
→ InformacionReferencia[0..10] → Otros? → ds:Signature[1..5]
```

Diferencias estructurales FE/TE verificadas comparando los XSD completos:

- TE no admite `CodigoActividadReceptor` ni `LineaDetalle/TipoTransaccion`.
- `Receptor` es opcional en TE y obligatorio en FE. Si se incluye receptor TE, `Nombre` sigue siendo obligatorio (3..100 caracteres), mientras `Identificacion` es opcional; en FE ambos son obligatorios.
- TE excluye condición de venta `12`; FE la permite. Valores TE: `01,02,03,04,05,06,07,08,10,13,14,15,99`.
- Las demás estructuras y cardinalidades compartidas coinciden. No basta cambiar el nombre de la raíz de un FE existente.

Para consumidor final se puede omitir por completo `Receptor` en TE. No se debe inventar una identificación de consumidor para llenar el receptor obligatorio de una FE. Esto demuestra el formato admisible, no aceptación en un ambiente real de Hacienda.

## Actividad económica: seis caracteres, no necesariamente seis dígitos

FE y TE restringen `CodigoActividadEmisor` a **xs:string de longitud exacta 6**, sin expresión que exija dígitos. FE tiene `CodigoActividadReceptor?` con la misma restricción. Anexo [p. 18](https://www.hacienda.go.cr/docs/ANEXOS_Y_ESTRUCTURAS_V4.4.pdf#page=18): deben ser códigos existentes en RUT y corresponder a la actividad de la operación; se verifica también la actividad inscrita del emisor/receptor. El anexo mantiene el receptor FE condicional y anuncia que un cambio a obligatorio se comunicaría oportunamente.

La página oficial de clasificación explica la migración de ATV/CIIU3 a TRIBU-CR/CIIU4. La correspondencia oficial, p. 5, muestra `502001`, `502002`, `502003`, `502004` y `502007` → `4520.0` («Mantenimiento y reparación de vehículos automotores»). `4520.0` tiene seis caracteres y contiene punto. **No eliminar el punto ni rellenar con ceros.** `4523.0`, escrito en la referencia del usuario, no se encontró en esa tabla; no sustituirlo automáticamente por `4520.0`. La correspondencia no demuestra por sí sola cuáles actividades tiene inscritas una empresa concreta.

La [API oficial, sección 1](https://api.hacienda.go.cr/docs/#1-endpoints), documenta `GET https://api.hacienda.go.cr/fe/ae?identificacion=...` para nombre, tipo de identificación, régimen, situación tributaria y actividades del contribuyente; sección 4 exige identificación numérica de 9–12 dígitos. No documenta que este servicio entregue domicilio, correo o teléfono. La consulta anónima al ejemplo que publica Hacienda (`2100042005`) devolvió HTTP 200 con claves `nombre,tipoIdentificacion,regimen,situacion,actividades` y actividades vacías; no se verificó aquí una respuesta con actividades no vacías. Los códigos deben conservarse como cadenas de la fuente oficial, con fecha/origen de consulta y selección entre actividades vigentes, sin convertir números ni inferir inscripción por una expresión regular.

API: cachear consultas, tratar 400/404/429 por separado y controlar tráfico: ráfaga 20 solicitudes/s durante 5 s; promedio 10/s durante 120 s; bloqueo publicado de 10 min. Su catálogo CABYS admite `codigo` de 13 dígitos o `q` de al menos 3 caracteres; sus tarifas son referencia, no una decisión tributaria universal.

## Plazo de crédito y vencimiento

`PlazoCredito?` es `xs:integer`, `totalDigits=5`, situado después de `CondicionVentaOtros` y antes de `DetalleServicio`. Anexo [p. 25](https://www.hacienda.go.cr/docs/ANEXOS_Y_ESTRUCTURAS_V4.4.pdf#page=25): obligatorio con condiciones `02` y `10`, expresado en días, mayor que cero, entre 1 y 5 dígitos. El texto del XSD describe genéricamente ventas a crédito; el anexo enumera estos dos códigos. La condición `08` también es crédito, pero esa página no la enumera como disparador obligatorio de `PlazoCredito`; no atribuirle esa obligación precisa sin evidencia adicional.

**No existe `FechaVencimiento` en las estructuras FE/TE descargadas.** La aplicación puede calcularla y conservarla como dato comercial interno derivado de fecha de emisión y días de plazo. No agregar una etiqueta XML inventada. La política de fecha/hora/zona y el cómputo de vencimiento comercial deben quedar explícitos en la aplicación.

## Campos especializados de línea

Orden compartido FE/TE (TE omite `TipoTransaccion?`):

```text
NumeroLinea → CodigoCABYS → CodigoComercial[0..5] → Cantidad → UnidadMedida
→ TipoTransaccion? → UnidadMedidaComercial? → Detalle → NumeroVINoSerie[0..1000]
→ RegistroMedicamento? → FormaFarmaceutica? → DetalleSurtido? → PrecioUnitario
→ MontoTotal → Descuento[0..5] → SubTotal → IVACobradoFabrica? → BaseImponible
→ Impuesto[1..1000] → ImpuestoAsumidoEmisorFabrica → ImpuestoNeto → MontoTotalLinea
```

| Campo XML | Tipo/límite XSD | Regla del anexo |
| --- | --- | --- |
| `CodigoComercial` | 0..5 nodos; dentro: `Tipo` seguido de `Codigo` | pp. 27 y 76, nota 12. Tipo `01` vendedor, `02` comprador, `03` fabricante/industriales/importadores, `04` uso interno, `99` otros. Código: string máximo 20. Obligatorio para CABYS habilitados como surtidos; usar `03` y SKU/GTIN/equivalente verificable en esos casos. |
| `TipoTransaccion` | FE 0..1, string enum `01..13`; TE ausente | pp. 28 y 82, nota 22. Tratamientos específicos, no un texto libre. |
| `UnidadMedidaComercial` | string máximo 20, opcional | p. 28: unidad propia de la actividad comercial, p. ej. una tarima. |
| `NumeroVINoSerie` | 0..1000 strings, máximo 17 cada uno | p. 28: obligatorio para CABYS de vehículos/aeronaves/embarcaciones que tengan esa numeración: VIN, serie o consecutivo de fabricación. No sustituirlo por un campo genérico de serie de cualquier artículo. |
| `RegistroMedicamento` | string máximo 100, opcional XSD | p. 28: registro sanitario del Ministerio de Salud; condicional para medicamentos con registro sanitario. No es CABYS ni un código inventado de medicamento. |
| `FormaFarmaceutica` | string máximo 3, opcional XSD | pp. 29 y 81, nota 19: código del documento oficial «Código de forma Farmacéutica». No se obtuvo ese catálogo en esta investigación; no inventar su enumeración ni usar texto libre como código oficial. |

Tipo de transacción (nota 22): `01` venta normal, `02/03` mercancía autoconsumo exento/gravado, `04/05` servicio autoconsumo exento/gravado, `06` cuota afiliación, `07` cuota afiliación exenta, `08` bienes de capital emisor, `09` bienes de capital receptor, `10` bienes de capital emisor y receptor, `11` bienes de capital de autoconsumo exento emisor, `12` bienes de capital sin contraprestación a terceros exento emisor, `13` sin contraprestación a terceros. La selección no autoriza a deducir un tratamiento sin las demás condiciones legales.

El XSD exige `BaseImponible`, al menos un `Impuesto`, `ImpuestoAsumidoEmisorFabrica` e `ImpuestoNeto` aun cuando algunos importes sean cero. Anexo p. 46 exige cero en el impuesto asumido cuando no aplica; no omitir nodos requeridos por aplicar una interpretación genérica de «opcional».

## Otros cargos

`OtrosCargos[0..15]` aparece entre `DetalleServicio` y `ResumenFactura`. Orden y tipos internos, idénticos en FE y TE:

```text
TipoDocumentoOC (enum string2)
→ TipoDocumentoOTROS? (string5..100)
→ IdentificacionTercero? (Tipo seguido de Numero)
→ NombreTercero? (string5..100)
→ Detalle (string máximo160)
→ PorcentajeOC? (decimal9,5; mínimo0)
→ MontoCargo (D18,5)
```

Nota 16, [p. 80](https://www.hacienda.go.cr/docs/ANEXOS_Y_ESTRUCTURAS_V4.4.pdf#page=80): `01` contribución parafiscal; `02` timbre Cruz Roja; `03` timbre Bomberos; `04` cobro de un tercero; `05` costos exportación; `06` impuesto servicio 10%; `07` timbre colegios profesionales; `08` depósitos garantía; `09` multas/penalizaciones; `10` intereses moratorios; `99` otros cargos.

Anexo pp. 47–49:

- Código `04`: identificación y nombre del tercero obligatorios. El tercero es quien vende/presta lo cobrado. Identificación según nota 4; inscripción tributaria requerida salvo extranjero no domiciliado. El tipo estructural admite `01..06`, pero esto no elimina las condiciones contextuales del tercero inscrito. `Numero` admite máximo 20 caracteres y debe respetar formato/longitud del tipo correspondiente.
- Código `99`: `TipoDocumentoOTROS` obligatorio, 5..100 caracteres.
- `MontoCargo` debe ser **mayor que cero**; el tipo XSD por sí solo también admite cero, por lo que hace falta validación del anexo.
- `PorcentajeOC` expresa porcentaje en puntos: `13`, `1`, `0.5`, no `0.13`. Su descripción dice indicar el porcentaje o monto para su cálculo cuando lo posea. **No se establece una base universal de cálculo de otros cargos.**
- Solo los códigos `04,08,09,10` permiten omitir `DetalleServicio` cuando no haya productos/servicios; la opción XSD `minOccurs=0` no autoriza omitirlo para cualquier cargo.
- `TotalOtrosCargos` = suma de `MontoCargo` (p. 55). `TotalComprobante` = venta neta + impuesto + otros cargos − IVA devuelto (p. 56).

No existe dentro de `OtrosCargosType` un nodo para impuesto, tarifa, base imponible o exoneración. No añadir etiquetas XML de tratamiento tributario ni asumir que todos los cargos tienen la misma tributación. Un cálculo por porcentaje requiere definir y guardar su base comercial explícita, con reglas justificadas por el tipo de cargo; el anexo no respalda usar indiscriminadamente subtotal, venta neta o total con impuestos. No presentar un cálculo genérico como validación tributaria oficial.

## Otros impuestos y bases

Orden `ImpuestoType`: `Codigo → CodigoImpuestoOTRO? → CodigoTarifaIVA? → Tarifa? → FactorCalculoIVA? → DatosImpuestoEspecifico? → Monto → Exoneracion?`.

`Codigo` permite `01,02,03,04,05,06,07,08,12,99` (nota 8, p. 71). `CodigoImpuestoOTRO` es string5..100, obligatorio para `99`; `Tarifa` decimal4,2 expresa puntos porcentuales; `FactorCalculoIVA` decimal5,4 expresa factor decimal. `CodigoTarifaIVA` es obligatorio para impuestos `01` y `07`, con la excepción documentada de surtidos (p. 38).

| Código | Cálculo/evidencia confirmada | Límite de lo demostrado |
| --- | --- | --- |
| `01` IVA | Base imponible × tarifa/100, pp. 37 y 42. Base = `SubTotal` + impuestos `02,04,05,12` cuando correspondan. Regalía/bonificación `01/03`: usar `MontoTotal` para IVA. | No tratar las demás bases especiales como un porcentaje genérico del subtotal. |
| `02` selectivo consumo | Tarifa editable conforme a norma, p. 38; p. 43 remite el cálculo a la norma reguladora. | El anexo no fija una base universal; no basta añadir `subtotal × porcentaje`. |
| `03` combustibles | `CantidadUnidadMedida × ImpuestoUnidad`, p. 43. | Requiere tarifa por unidad vigente y unidad correcta, no una tarifa porcentual arbitraria. |
| `04` bebidas alcohólicas | `Cantidad × Proporcion × ImpuestoUnidad`, p. 43; proporción utiliza cantidad de medida y porcentaje de alcohol (p. 40). | Requiere datos específicos/unidades y la tarifa legal vigente. |
| `05` bebidas sin alcohol/jabón | Bebidas: `Cantidad × CantidadUnidadMedida × (ImpuestoUnidad / VolumenUnidadConsumo)`; jabón: `Cantidad × VolumenUnidadConsumo × ImpuestoUnidad`, p. 43. | El código por sí solo no distingue bebida de jabón; hace falta clasificación verificada. |
| `06` tabaco | `Cantidad × CantidadUnidadMedida × ImpuestoUnidad`, p. 44. | Requiere datos/tarifas específicos. |
| `07` IVA cálculo especial | Base imponible editada × tarifa/100, pp. 37 y 42. | No inventar cómo determinar la base especial de cada régimen. |
| `08` bienes usados | Factor oficial × `SubTotal`, pp. 39 y 42. | No confundir factor decimal con porcentaje ni inventar factores. |
| `12` cemento | Tarifa 5%, p. 38; `SubTotal × tarifa/100`, p. 44 (precio neto de venta). | Conservar además su efecto en la base de IVA cuando corresponda. |
| `99` otros | Descripción obligatoria y tarifa editable según norma, p. 38. | El anexo no establece un cálculo/base único. |

`DatosImpuestoEspecifico?`, obligatorio para `03,04,05,06` según pp. 39–41, contiene en este orden: `CantidadUnidadMedida` decimal7,2; `Porcentaje?` decimal4,2 (código04); `Proporcion?` decimal10,5 (04); `VolumenUnidadConsumo?` decimal7,2 (05); `ImpuestoUnidad` D18,5. La estructura no debe rellenarse con ceros ficticios para representar impuestos cuyo cálculo no se ha implementado. Los surtidos tienen cálculos por componentes y excepciones expresas: no reutilizar automáticamente fórmulas de línea simple.

Tarifas IVA, nota 8.1, p. 72: `01` 0% con derecho a crédito pleno según supuesto legal; `02` 1%; `03` 2%; `04` 4%; `05` transitorio0%; `06` transitorio4%; `07` transitorio8%; `08` 13%; `09` 0.5%; `10` exenta; `11` 0% sin derecho a crédito. Los transitorios `05/06/07` son exclusivos de NC/ND que los requieran. Cero, exento, exonerado y no sujeto no son intercambiables. Los resúmenes no sujetos usan códigos `01/11`; exentos usan `10` (pp. 51–52). Las exoneraciones tienen su documento y monto propios; no se representan eligiendo simplemente tasa cero.

## IVA devuelto y precisión

`ResumenFactura/TotalIVADevuelto?` es D18,5 y se coloca después de `TotalImpAsumEmisorFabrica?`, antes de `TotalOtrosCargos?`, `MedioPago[0..4]` y `TotalComprobante`.

Anexo [p. 55](https://www.hacienda.go.cr/docs/ANEXOS_Y_ESTRUCTURAS_V4.4.pdf#page=55), incluido pie 16: devolución para **servicios de salud con tarifa4% y pago con tarjeta**. No es devolución general para cualquier línea4%, cualquier CABYS de salud o cualquier pago electrónico. Venta solo de salud y pagada con tarjeta: suma de su IVA pagado. Venta mixta y/o varios medios: `(monto pagado con tarjeta / TotalVentaNeta) × suma del IVA de líneas de salud al4%`; nunca mayor que ese IVA. Se fija previamente el monto tarjeta y se ajustan los otros medios para que sumen el comprobante **después** de la devolución; no resolverlo calculando primero un porcentaje del total final de manera circular. Debe validarse el conjunto oficial de CABYS médicos; no se identificó en esta investigación un catálogo adicional que habilite afirmar la elegibilidad de cualquier código particular.

Anexo p. 14 describe redondeo y ejemplos a cinco decimales; el XSD limita dinero a cinco decimales. Mantener la política existente confirmada por el usuario de precisión decimal y redondeo half-up a cinco decimales por línea; sumar los importes de línea ya redondeados. Esta investigación no establece un redondeo adicional distinto a nivel de cabecera, ni tolerancias de Hacienda. Los importes calculados del resumen no deben editarse manualmente.

## Pendientes normativos concretos

El paquete TE por hash y el catálogo farmacéutico oficial (229 códigos de texto)
ya están incorporados y probados localmente. Se verifica actividad inscrita y
activa antes de emitir; una consulta desconocida no se convierte en validación.
Siguen pendientes elegibilidad CABYS para IVA devuelto y perfiles/regímenes,
surtidos e impuestos específicos que el sistema identifica y bloquea. Ningún
XSD local ni consulta pública demuestra aceptación auténtica en Hacienda. Ver
estados y evidencia en la [matriz de cierre](billing44-closeout.md).
