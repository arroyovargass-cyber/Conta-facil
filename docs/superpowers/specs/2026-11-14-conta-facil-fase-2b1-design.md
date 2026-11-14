# Fase 2B1 — preparación y vista previa del IVA

Fecha:2026-11-14. Estado: aprobado por el usuario al responder «Continuar»; pendiente de ejecución del plan.

## Intención y enfoque elegido

El usuario autorizó continuar el enfoque nativo incremental y el primer escenario propuesto: factura nacional en CRC, al contado e IVA general13%, sin descuentos ni exoneraciones. Se conserva React/TypeScript/Fastify y el aislamiento multiempresa/departamental existentes.

La [revisión normativa](../../development/phase2b-normative-matrix.md) encontró un esquema oficial descargable cuya revisión no coincide completamente con el anexo2026, y una firma obligatoria en el XSD completo. El diseño divide el siguiente bloque en2B1 (preparación y cálculo) y2B2 (XML y validación, tras resolver esos bloqueos). Esta división es una propuesta del desarrollador, no un resultado fiscal ya aprobado.

Alternativas: implementar todos los impuestos/documentos simultáneamente amplía las reglas sin validar y contradice los incrementos pequeños elegidos. Construir contra el XSD descargado como si estuviera actualizado omite discrepancias conocidas. Se conserva el enfoque incremental elegido y se bloquea expresamente la generación XML de este incremento.

## Resultado y límites

Desde un borrador autorizado, el usuario puede solicitar una vista previa explícita del IVA13% y consultar los impedimentos para preparar XML4.4. Nunca se aplicará13% automáticamente al catálogo ni se afirmará que esa tarifa corresponde legalmente a un CABYS. El usuario elige y confirma el escenario antes del cálculo; la pantalla indica «Vista previa de impuestos — sin validez tributaria».

Se calculan importe de cada línea, base e IVA por línea y suma del total con IVA. No se modifica el subtotal comercial existente ni el borrador. No se guardan impuestos, perfiles fiscales ni datos adicionales en esta entrega. La selección de vista previa es temporal y se pierde al cerrar o cambiar de borrador/empresa; se informa en pantalla.

No se implementan XML descargable, clave, consecutivo, firma, envío, PDF, pagos reales, descuentos, exoneraciones, otras tarifas, impuestos específicos, moneda extranjera, exportaciones o notas. Nada de esto se representará como una operación fiscal realizada. La contabilidad sigue fuera del alcance.

## Cálculo y precisión, sin reglas inventadas

El motor usa aritmética decimal exacta mediante enteros escalados; nunca Number para dinero. Reutiliza los límites comerciales de entrada de2A (hasta nueve enteros/cinco decimales). Considera hasta tres decimales significativos de cantidad según anexo p27; por ejemplo0.10000 almacenado por PostgreSQL equivale a0.1 y es admisible, mientras0.00001 no lo es. No redondea cantidades para hacerlas pasar.

Para este perfil sin otros tratamientos: importe/base de línea=cantidad×precio; IVA=base×13/100; total de línea=base+IVA. Las sumas del documento se forman a partir de las líneas calculadas. Todos los importes que se presenten como representables en el perfil deben caber exactamente en cinco decimales y ser no negativos y no mayores que9999999999999.99999, incluida la suma del documento. Se admite precio cero, ya permitido comercialmente; eso no certifica el tratamiento tributario de una operación gratuita, que queda expresamente fuera de emisión.

**Decisión conservadora propuesta:** mientras se confirma la política de redondeo por etapa/casos de empate, solo producir vista previa completa si los resultados de todas las líneas son representables exactamente en cinco decimales. Si la multiplicación o el IVA necesitan más, devolver `ROUNDING_POLICY_PENDING` con la posición de línea, sin truncar, ajustar entradas ni publicar un total parcial como total del documento. La regla del anexo y sus ejemplos se conservan en la matriz; no se inventa una decisión para un caso normativo no resuelto. Validar la política con fuente oficial/criterio tributario antes de ampliar el motor.

Ejemplos aritméticos verificables: base1000→IVA130→total1130; cantidad0.1 y precio0.2→base0.02→IVA0.0026→total0.0226. Base0.00001 requiere IVA0.0000013 y queda bloqueada por precisión. Son casos matemáticos, sin CABYS ni identificación inventados.

## Diagnóstico de preparación fiscal

La respuesta separa `calculation` y `readiness`. El cálculo puede estar completo aunque la preparación para XML esté bloqueada. `readiness.canGenerateXml=false` siempre en2B1, y `xsdValidation='not_run'`, `signature='missing'`, `haciendaStatus='not_sent'`. No devolver estados «validado», «aceptado» ni equivalente.

Diagnósticos constantes: revisión XSD no confirmada, firma ausente y generación XML no habilitada. Diagnósticos por datos: moneda no soportada, identificación comercial de cliente incompleta o no confirmada para uso fiscal, falta de perfil estructurado de emisor, actividad sin confirmar, CABYS/unidades pendientes y precisión/cálculos fuera del perfil. Un identificador escrito libremente o una URL de referencia no prueban inscripción ni vigencia.

El diagnóstico no consulta datos protegidos de configuración tributaria ni catálogos para ampliar los permisos de un lector de borradores. Los bloqueos de perfil estructurado/actividad/clasificación representan funciones todavía no confirmadas en2B1; no certifican el contenido de tablas a las que el usuario no tenga acceso. El diagnóstico no copia datos del catálogo actual sobre el borrador histórico.2A no conservó CABYS/unidad/clase en cada línea; se informa «clasificación fiscal pendiente» con su posición y se deja su captura/versionado para2B2. Tampoco se infiere provincia/cantón/distrito desde una dirección libre ni se asigna una cédula a ProveedorSistemas.

Cada incidencia contiene código estable, severidad `blocker`, ruta/posición cuando aplica, explicación en español y siguiente acción. Diferenciar «corrige el borrador» (cantidad/moneda) de «requiere habilitación en un próximo incremento» (esquema/firma/perfil estructurado). No ofrecer botones para resolver funciones aún inexistentes.

## Contrato y autorización

Nuevo módulo de dominio `fiscal-preview` y módulo de API `fiscal-preparation`. Endpoint POST `/api/companies/:tenantId/invoice-drafts/:id/fiscal-preview` con cuerpo estricto `{profile:'FE_CRC_CASH_IVA13',expected_version:positiveInteger,confirmed_general_vat:true}`. Campos como tasas arbitrarias, XML, totales enviados por cliente o selección automática son rechazados.

El backend autentica, comprueba Origin/CSRF existentes y abre transacción scoped. Lee el borrador y todas sus líneas desde RLS, comprobando `invoices.read` en su departamento. No requiere permiso de gestión ni MFA adicional al que ya corresponda a la cuenta: una vista previa sin escritura es consulta, incluidos contador/auditor autorizados. No añade permisos, migraciones o servicios.

Objetos ajenos o de otro departamento devuelven404 sin datos. Versión distinta devuelve409 para recargar explícitamente antes del cálculo; nunca calcula sobre una versión enviada por el navegador. Se permite previsualizar archivados con el mismo aviso, sin escribir ni restaurarlos. El backend usa los valores persistidos y snapshots de cliente, no los importes que haya editado localmente el usuario. Botón disponible únicamente al abrir un borrador guardado; mostrar «guarda tus cambios antes de calcular» si el formulario tiene cambios sin guardar.

Respuesta200 para diagnóstico válido de negocio aunque el perfil esté bloqueado: `{draft_id,draft_version,profile,calculation:{status:'complete'|'blocked',lines?,base?,vat?,total?,currency:'CRC'},readiness:{canGenerateXml:false,xsdValidation:'not_run',signature:'missing',haciendaStatus:'not_sent',issues:[...]}}`. Moneda USD produce `calculation.status='blocked'` e incidencia explícita, no conversión. Errores de contrato400, versión409, sesión401 y acceso404. Resultados decimales se envían como texto canónico.

No se registra el cuerpo de las líneas, identificaciones o resultados en logs. Al ser cálculo derivado sin persistencia ni asignación de números, reintentos de la misma versión no requieren una nueva clave idempotente ni generan auditoría de cambios comerciales. Las trazas de errores mantienen el patrón sanitizado existente.

## Interfaz y concurrencia

En el detalle de un borrador guardado se añade «Vista previa de impuestos». Al abrir el panel se explica el perfil y se exige casilla de confirmación explícita antes de «Calcular vista previa». El resultado muestra por separado base, IVA y total con IVA en CRC, además de incidencias y su posición. El importe comercial original conserva su etiqueta «antes de impuestos».

Cualquier modificación local, cierre del editor, apertura de otro borrador, cambio de empresa o sesión elimina/invalida la vista previa y sus peticiones. Usa la generación del editor introducida en2A, no solo un flag de montaje; las respuestas fuera de generación se descartan. Se bloquea el envío repetido del cálculo mientras está en curso. Un409 conserva lo escrito y ofrece recargar explícitamente, siguiendo el patrón existente. El panel es accesible por teclado, etiquetado en español y adaptable sin desbordar la página en móvil.

## Pruebas y aceptación

Dominio: ejemplos anteriores, suma de múltiples líneas, cantidad positiva con hasta tres decimales significativos, ceros finales de PostgreSQL, precio cero, cantidades/precios inválidos, exceso de cinco decimales en producto/IVA, límites monetarios por línea y acumulados. Verificar que un cálculo bloqueado no presenta un total parcial.

Integración real: dos empresas y departamentos; lector autorizado calcula y no autorizado recibe404; peticiones sin sesión/CSRF/origen correcto se rechazan; versión obsoleta409; USD bloqueado; archivado consultable sin modificación; payload extra/tarifas/totales falsos400; contenido comercial y auditoría de cambios intactos después de reintentar. Los diagnósticos nunca dicen aceptación fiscal ni exponen otra empresa.

Navegador escritorio/móvil: abrir y calcular previa con confirmación, cifras correctas, aviso de precisión pendiente, bloqueo de formulario sin guardar, accesibilidad por teclado, descartar respuesta retrasada al cambiar de editor/empresa y conservar estado ante409. Ejecutar suite completa de aplicación, SQL y navegador, build y revisión independiente final.

Cierre: demostración reproducible del cálculo permitido y de cada bloqueo relevante; evidencia explícita de que XML/firma/envío siguen inhabilitados. No declarar terminada la Fase2 ni listo para producción.

## Próximo incremento y decisiones delegadas

2B2 exige paquete XSD vigente y dependencias verificadas (con SHA256/procedencia), motor compatible con su versión, política de redondeo confirmada y campos/catálogos fiscales versionados. La validación completa del XSD exige firma; no alterar esquemas oficiales ni añadir firmas ficticias a documentos del usuario para pasar pruebas. Integración STAG posterior necesita credenciales por canal seguro, nunca en chat ni frontend.

El implementador decide organización de helpers, nombres de componentes y forma interna del cálculo exacto. No puede ampliar el perfil, inventar códigos, aplicar redondeo ni habilitar XML/firma/envío como decisión técnica rutinaria. El desarrollo local continúa en la rama existente; no modifica ContaNova ni despliega recursos remotos.

## Revisión del diseño

Un builder check independiente leyó diseño y matriz y no encontró preguntas importantes pendientes para planificar. El usuario aprobó este diseño; las dudas normativas y bloqueos de2B2 permanecen expresos.
