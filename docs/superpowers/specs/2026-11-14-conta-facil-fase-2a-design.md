# Conta Fácil: Fase 2A — clientes, catálogo y borradores

Estado: propuesta para aprobación. Fecha: 2026-11-14.

## Propósito y enfoque

El usuario eligió continuar la Fase 2 por incrementos: clientes, productos y borradores; después cálculos/XML, integración STAG y finalmente PDF/correo y expansión de comprobantes. Se conserva React/TypeScript/Fastify/PostgreSQL y el sistema multiempresa existente.

La alternativa de construir los ocho tipos de documento a la vez retrasa la primera comprobación y multiplica las reglas pendientes. Un proveedor externo cambiaría la integración oficial directa solicitada y agregaría una dependencia comercial. Se adopta el desarrollo nativo incremental elegido por el usuario. Las decisiones técnicas concretas de este documento son propuestas del desarrollador.

El resultado de 2A permite mantener clientes y catálogo, guardar y reabrir un borrador de factura electrónica por departamento. No produce comprobantes tributarios: no asigna clave ni consecutivo oficial, no calcula impuestos, no firma ni transmite, no genera PDF tributario. La pantalla dice «Borrador — sin validez tributaria». No se habilita producción ni contabilidad.

## Experiencia y datos

Se añaden tres destinos a la navegación existente: Clientes, Productos y servicios, y Borradores. Listas paginadas de 50 registros, búsqueda literal con demora de 300 ms, filtro activo/inactivo para catálogos. Reutilizar formularios y manejo de sesiones/empresa, descartando respuestas obsoletas tras cambiar de empresa. Estados vacíos, errores y confirmación de guardado en español. Diseño adaptable al patrón actual, con etiquetas y navegación por teclado.

Clientes: nombre requerido; tipo/número de identificación opcionales en conjunto, conservados como texto, sin afirmar validación tributaria; correo opcional validado, teléfono y dirección opcionales, activo. No imponer solo dígitos ni reutilizar el normalizador de acceso de usuarios para identificación tributaria. En esta etapa no se restringen tipos a un catálogo oficial sin verificar. No guardar datos bancarios ni credenciales.

Productos/servicios: código comercial único por empresa, descripción requerida, clase producto/servicio, moneda CRC o USD y precio unitario no negativo. CABYS y unidad son textos opcionales pendientes de validación oficial, claramente indicados como tales; sin tarifas tributarias por defecto ni códigos inventados. Desactivación en lugar de borrado.

Borrador: cliente y departamento activos requeridos al crear; moneda CRC o USD, notas opcionales y una o más líneas (máximo 100). Cada línea conserva referencia opcional al producto, descripción, cantidad positiva y precio no negativo. Elegir producto copia descripción y precio únicamente si coincide su moneda; no hay conversión automática. Se permiten líneas manuales. No admite impuestos, descuentos ni exoneraciones en 2A. Se muestra solo «Importe de líneas antes de impuestos», nunca «total fiscal». Cantidad y precio aceptan como decisión comercial hasta cinco decimales, hasta nueve dígitos enteros; esta decisión no define la precisión XML futura. El cálculo usa enteros escalados/decimal exacto y se devuelve como texto; sin flotantes binarios. Se suman productos exactos y se presenta el subtotal con hasta diez decimales, sin establecer redondeo tributario.

Al guardar se conserva una copia del nombre e identificación del cliente y de los valores comerciales de cada línea. Cambiar después el catálogo no modifica borradores existentes. Actualizarlos desde el catálogo requiere edición explícita. Desactivar un cliente/producto permite consultar el borrador guardado; al editar se puede conservar su referencia histórica sin seleccionarlo como nuevo. Un departamento inactivo permite lectura autorizada, pero exige reasignar a uno activo antes de guardar.

Guardar no consume numeración tributaria. Los borradores usan UUID y fecha internos, estado único `draft`; pueden archivarse y consultarse por filtro, sin eliminación física. Archivo impide edición hasta restaurarlo. Un futuro proceso de emisión verificará de nuevo todos los campos y reglas: un borrador comercial no equivale a XML válido.

## Modelo y autorización

Tablas nuevas: `customers`, `catalog_items`, `invoice_drafts`, `invoice_draft_lines`. Todas llevan `tenant_id` no nulo, UUID y fechas; catálogos tienen `active`, borrador `archived_at`, `version`, creador y último editor. Líneas tienen posición única por borrador y copia de datos. Claves foráneas compuestas `(tenant_id,id)` impiden referencias entre empresas. Índices de empresa, búsqueda/orden y departamento adecuados a consultas reales.

Catálogos compartidos entre departamentos de la empresa: lectura con `customers.read`/`catalog.read` y escritura con `customers.manage`/`catalog.manage`, sin revelar facturas ni saldos. Borradores requieren `invoices.read`/`invoices.manage` y acceso al departamento. Sin departamento nulo. Miembros con alcance empresa pueden consultar todos; miembros departamentales solo los departamentos asignados. Líneas heredan autorización del borrador. Backend comprueba permisos y PostgreSQL aplica RLS también ante acceso directo. Las respuestas para objetos ajenos no revelan su existencia.

La migración concede nuevos permisos a los roles predeterminados: administrador todos; contador lectura de catálogos y borradores; facturación lectura de catálogos y gestión de borradores; auditor solo lectura; otros roles ninguno. Crear/editar catálogo queda inicialmente al administrador y a roles personalizados autorizados. Se actualiza la inicialización para nuevas empresas, sin ampliar roles personalizados existentes. No existe permiso de emisión todavía.

El helper actual `private.has_access` niega acceso sin departamento a miembros departamentales. Para los catálogos se introduce una comprobación específica de permiso a nivel empresa que mantiene sesión, membresía activa y MFA sin exigir alcance empresa; no se debilita el helper existente. Para borradores se conserva la comprobación departamental. La exigencia actual de AAL2 para acciones `manage` sigue vigente. Reasignar un borrador exige autorización en departamento de origen y destino.

## Contrato y consistencia

Módulos separados `customers`, `catalog`, `invoicing`; rutas bajo `/api/companies/:tenantId/`. Listado y creación en `customers`, `catalog-items`, `invoice-drafts`; detalle/actualización por UUID. Actualización de borrador incluye documento completo y líneas en una transacción. Archivo/restauración mediante actualización explícita. Peticiones estrictas, tamaños acotados, cookies/CSRF y validación existentes. Rechazar campos fiscales o estados no admitidos.

Creación de borrador incluye UUID de operación generado por cliente y conservado al reintentar. Restricción única por empresa, usuario y operación; repetición idéntica devuelve el mismo borrador, contenido distinto devuelve conflicto. `version` permite control optimista en cambios de borrador y catálogos: actualización obsoleta devuelve 409, sin sobrescribir cambios. Idempotencia de borradores no sustituye la futura idempotencia tributaria.

Auditar creación, edición, desactivación/archivo/restauración con identificadores y actor, sin copiar direcciones, correo ni contenido completo a logs. Errores no filtran SQL. Se mantiene acceso a datos únicamente mediante sesiones válidas y alcance existente.

## Verificación y entrega

Pruebas de integración reales con PostgreSQL/RLS: dos empresas, referencias cruzadas bloqueadas, dos departamentos, permisos de lectura/escritura, sesiones revocadas, lectura directa de líneas y documentos archivados. Pruebas de cálculo comercial con fracciones, límites y suma exacta; idempotencia y conflicto concurrente por versión; transacción completa sin líneas parciales. Navegador escritorio/móvil: crear cliente/producto/borrador, reabrir, editar, archivar/restaurar, cambiar empresa durante carga y verificar mensajes/errores.

Criterio de cierre: flujo reproducible de cliente → producto → borrador → consulta, sin datos entre empresas/departamentos ni funciones fiscales habilitadas. Ejecutar build, pruebas pertinentes y regresión existente. Entregar evidencia y migración local reversible mediante restauración de copia de prueba; no aplicar automáticamente a ContaNova. La aplicación de migración al proyecto separado de pruebas se realizará después de validación local y comprobación del destino; publicación sigue condicionada al acceso GitHub/Render existente.

## Dependencias de próximos incrementos

[Investigación oficial](../../development/phase2-official-research.md): recuperar XSD vigentes verificables, fijar hash/procedencia y completar matriz normativa antes del generador. Resolver reglas de impuestos, descuentos, exoneraciones, moneda y redondeo con fuentes oficiales; no inferirlas de este modelo comercial. Firma/envío real requiere secretos STAG ingresados por canal seguro, nunca en chat o frontend. Toda discrepancia normativa se documenta y se somete a validación antes de implementarse.

El implementador puede decidir nombres de componentes, detalles de índices, organización interna de pruebas y librería decimal mantenida o aritmética escalada, siempre respetando el contrato exacto anterior. Esta entrega no declara terminada la Fase 2 completa.
