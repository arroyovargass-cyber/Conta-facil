# Cierre local de facturación 4.4 — Conta Ágil

Fecha de trabajo: 26 de noviembre de 2026, Costa Rica. Rama de integración:
`feat/billing44-complete-workspace`, desde la versión publicada `9a61afd`.
Este informe distingue implementación local de operación real. **No acredita
aceptación auténtica en Hacienda ni habilita producción.**

## Matriz de entrega

Los archivos son relativos al repositorio. Las pruebas usan datos sintéticos y
el rol `conta_facil_api`, sin USAGE en `auth`, sin superusuario ni BYPASSRLS.

| Funcionalidad | Estado anterior | Problema identificado | Corrección aplicada | Archivos principales | Prueba ejecutada | Resultado | Estado final | Pendientes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Guardado de Mi empresa | HTTP 403 con el rol alojado | El trigger resolvía `auth.uid()` sin USAGE | Claims autenticados de la transacción; conserva actor, fecha y versión | `supabase/migrations/20261126215114_fix_company_version_request_context.sql`, `apps/api/src/modules/company-registration.ts` | `tests/integration/company-update-auth-schema.test.ts`, navegador empresarial | Guardado en seis pestañas, incremento de versión, actor y rechazos correctos | Implementada y verificada localmente | Aplicación remota aprobada |
| Actividades nuevas y errores | Una fila vacía bloqueaba todas las pestañas | No existía eliminación ni distinción entre fila nueva y guardada | Eliminar nuevas; ignorar solo nuevas totalmente vacías; validar parciales y conservar guardadas; mensajes y pestaña en español | `apps/web/src/features/companies/company-form.ts`, `CompanyWorkspace.tsx`, `packages/domain/src/company.ts` | `tests/company-form.test.ts`, `tests/browser/company-administration-fix.spec.ts` | Filas y errores conservan su contexto | Implementada y verificada localmente | Publicación |
| Actividad económica | Formato de seis dígitos y verificación local insuficientes | CIIU4 puede incluir punto; una fila manual no demuestra inscripción | Seis caracteres sin convertir; consulta oficial de inscripción activa antes de emitir, para emisor y actividad FE del receptor suministrada | `packages/domain/src/economic-activity.ts`, `apps/api/src/services/fiscal-lookups.ts`, `emission-control.ts` | `tests/economic-activity.test.ts`, `tests/fiscal-lookups.test.ts`, `tests/emission-control-environments.test.ts` | Código conservado; vigencia desconocida/inactiva bloquea emisión | Implementada con configuración pendiente | Registrar las actividades reales; disponibilidad de la API pública |
| Empresas, sucursales y terminales | Mecanismo existente; empresas revisadas sin registros activos | Faltaba configuración, además del bloqueo de guardado | Reutiliza alta/edición y registro de sucursal/terminal al guardar | `CompanyWorkspace.tsx`, `company-registration.ts` | Navegador empresarial e integración restringida | Alta, reapertura y guardado sin reiniciar historial | Implementada con configuración pendiente | El propietario completa y revisa cada empresa |
| Roles y departamentos | Varias operaciones dependían del permiso general | No podían asignarse por separado preparación, correo, reportes y numeración | Capacidades independientes, catálogo existente, RLS y controles de servidor; no cambia membresías ni departamentos | `20261127032849_billing_action_permissions.sql`, módulos `companies`, `invoicing`, `emission`, `emission-actions`, `emission-numbering` | `tests/integration/billing44-workspace.test.ts`, `emission-actions.test.ts`, `invoice-history.test.ts`, SQL/RLS | Creación/edición/preparación/emisión/consulta/descarga/reenvío diferenciados | Implementada y verificada localmente | Asignación por el superadministrador; NC/ND aún deshabilitadas |
| Venta registrada y ocasional | Catálogo básico y borrador separado | Datos fiscales incompletos y dependencia del cliente permanente | Receptor completo y copia propia; guardado opcional desactivado; deduplicación por empresa | `packages/domain/src/billing.ts`, `apps/api/src/modules/invoicing.ts`, `customer-persistence.ts`, `Drafts.tsx` | `tests/integration/fiscal-drafts.test.ts`, `billing44-workspace.test.ts`, navegador fiscal | No crea clientes sin elección; conserva receptor y datos históricos | Implementada y verificada localmente | Datos reales del receptor antes de emitir |
| Detalle y CABYS | Editor comercial sin todo el detalle fiscal | Faltaban cargos, descuentos porcentuales y campos especializados | Editor compartido, catálogo oficial por código/texto, formato de 13 dígitos, verificación de existencia antes de emitir y cache público de cinco minutos | `BillingFields.tsx`, `common.tsx`, `packages/domain/src/invoice-extras.ts`, `fiscal-lookups.ts` | `tests/fiscal-lookups.test.ts`, `invoice-fiscal-billing44.test.ts`, navegador de facturación | Preserva ceros, tarifas por línea y datos al alternar pestañas | Implementada y verificada localmente | Regímenes e impuestos especiales no validados siguen bloqueados |
| Cálculo y totales | Importe comercial antes de impuestos | Desglose incompleto y riesgo de divergencias | BigInt decimal compartido, half-up a cinco decimales por línea, sumas de líneas; descuentos, exoneraciones, cargos y resúmenes | `packages/domain/src/invoice-fiscal.ts`, `emission.ts`, servicios XML/PDF e impresión | Unidades, API, XML, PDF y navegador | 2 × 1000 + IVA 13% = subtotal 2000, impuesto 260, total 2260 | Implementada y verificada localmente | Verificación real del tratamiento de cada operación |
| Historial e indicadores | Lista mínima | Sin filtros completos; no separaba las categorías de gestión | Filtros de servidor, fechas CR, permiso de reportes, monedas separadas, solo aceptadas en importes; impuestos netos de exoneración | `apps/api/src/modules/invoice-history.ts`, `Invoices.tsx`, `usePaged.ts` | `tests/integration/invoice-history.test.ts` | Pendientes, rechazadas y preparaciones no inflan ventas; departamentos aislados | Implementada y verificada localmente | Publicación; nuevas exportaciones distintas de las existentes no incluidas |
| Borradores y duplicación | Editor existente | Podía quedar bloqueado al llegar una respuesta anterior; faltaba duplicación | Invalida respuestas anteriores y limpia carga al crear; duplica como borrador nuevo, sin clave, consecutivo ni referencias de catálogo históricas | `Drafts.tsx`, `Invoices.tsx` | `tests/billing-workspace-ui.test.ts`, `tests/browser/phase2a.spec.ts`, `billing44-workspace.spec.ts` | Conserva edición, importe comercial y datos; no duplica emisión | Implementada y verificada localmente | Revisión de datos y referencias de la nueva venta |
| Requisitos y botón Facturar | Faltantes y botones poco claros | Guardar se confundía con emitir; escasa orientación | Lista individual desde `emissionReadiness`, estados y destinos de configuración; confirmación y operación idempotente | `emission-control.ts`, `EmissionRequirements.tsx`, `Invoices.tsx` | `tests/emission-control-environments.test.ts`, `emission-requirements-ui.test.ts`, navegador | No habilita emisión con faltantes, sin MFA o permiso; HTTP no equivale a aceptación | Implementada con configuración pendiente | Completar requisitos reales de cada empresa y ambiente |
| Numeración FE/TE | FE independiente por ambiente | Faltaba separar tipo de documento | Clave transaccional empresa/ambiente/sucursal/terminal/tipo; piso histórico; confirmación de superadministrador con MFA | `invoice-numbering.ts`, `emission-numbering.ts`, migraciones de facturación | `tests/invoice-numbering.test.ts`, integración de concurrencia y navegador de numeración | Sin duplicados ni reducciones; FE anterior conservada | Implementada con configuración pendiente | Confirmar el último consecutivo real, sin suponer cero |
| XML, firma y XSD | Circuito FE existente | Campos y perfil TE pendientes | XML y firma reutilizados; XSD oficiales FE/TE completos, offline, por hash; conserva forma histórica | `invoice-xml.ts`, `hacienda-schema-package.ts`, `infra/invoice-validator-worker.py`, paquete de referencia | `tests/invoice-xml.test.ts`, `invoice-signature.test.ts`, `invoice-schema-validation.test.ts`, pruebas Python | XML firmado verificado y alteraciones rechazadas con material sintético | Pendiente de pruebas reales | Llave propia vigente, conexión y aceptación auténtica en pruebas |
| Respuesta y recuperación | Cola y consulta existentes | Debía conservar separación de estados y autoridad del solicitante | Respuesta canónica HTTPS del ambiente, firma/correlación/XSD, evidencia privada y actor de consulta/reenvío; consulta antes de repetir un envío incierto | `emission-pipeline.ts`, `emission-worker-store.ts`, `emission-actions.ts`, migraciones | Pruebas de pipeline, respuesta, leases, revocación e idempotencia | Aceptación y rechazo sintéticos diferenciados; sin doble POST por timeout | Pendiente de pruebas reales | Primera respuesta auténtica almacenada; el plan gratuito requiere actividad del servicio |
| PDF, descarga y correo | Pipeline esperaba un booleano donde el formulario guarda dirección | La entrega no podía activarse correctamente desde la configuración válida | Consentimiento booleano explícito separado de dirección; copia congelada, adjuntos privados, permisos y reenvíos controlados | `packages/domain/src/company.ts`, `invoice-pdf.ts`, `invoice-mail.ts`, `emission-pipeline.ts`, `emission-actions.ts` | `tests/emission-pipeline.test.ts`, `invoice-pdf.test.ts`, `invoice-mail.test.ts`, integración de reenvío | SMTP local con adjuntos sintéticos; aceptación del proveedor diferenciada de entrega final | Implementada con configuración pendiente | SMTP real y prueba autorizada de entrega externa; activar opción antes de preparar |
| Perfil TE extranjero especial | XML admite identificaciones distintas de las del transporte | Podía reservar numeración y fallar antes del HTTP | Bloqueo previo de identificadores no soportados por transporte/respuesta; no los borra ni sustituye | `emission-control.ts` | `tests/emission-control-environments.test.ts` | No consume numeración ante ese caso | Bloqueada por dependencia externa | Validar contrato completo de recepción y respuesta de ese perfil |
| IVA devuelto y regímenes especiales | Elegibilidad médica no verificada | Un cero fijo podía presentarse como definitivo | Bloquea antes de emitir servicios al 4% con tarjeta y supuesto de devolución no resuelto; preserva reproducción histórica | `packages/domain/src/emission.ts`, `invoice-xml.ts` | Pruebas de preparación, XML e historial | Ningún impuesto o reintegro supuesto desbloquea una nueva emisión | Bloqueada por dependencia externa | Catálogo/regla de elegibilidad oficial; no cambiar datos de la venta para eludir el bloqueo |
| NC, ND, FEC, FEE, REP y contabilidad completa | No operativos | Faltan perfiles normativos y pruebas propias | Se identifican como pendientes; controles deshabilitados; CxC conserva vínculo departamental sin inventar saldos | Configuración empresarial, `Invoices.tsx`, documentación normativa | Validación de tipo y disponibilidad en UI/API | No se ofrecen como comprobantes operativos | No implementada | Desarrollo posterior al cierre auténtico de FE nacional |

## Migraciones propuestas

Seis archivos nuevos, aplicados **solo al PostgreSQL local**. No se editaron
migraciones históricas publicadas ni se aplicó SQL remoto en esta intervención.
Para publicar, revisarlos en este orden y ejecutarlos de forma atómica para
evitar estados intermedios del catálogo de permisos:

1. `20261126145440_billing44_draft_persistence_permissions.sql`: datos comerciales,
   receptor ocasional/consumidor, FE/TE, acciones, secuencias por tipo y actor de consulta.
2. `20261126164756_billing44_line_bounds_legacy_queries.sql`: límites de línea para
   VIN y clasificación de consultas manuales históricas con su actor real.
3. `20261126165430_immutable_invoice_draft_creation_provenance.sql`: prueba inmutable
   de la transacción de creación; archivar/restaurar no concede permiso de añadir líneas.
4. `20261126215114_fix_company_version_request_context.sql`: actor empresarial
   desde el contexto verificado; fecha y versión intactas.
5. `20261126222742_preserve_company_role_read_boundaries.sql`: conserva la exclusión
   de Hacienda y bandejas para contador/auditor salvo autorización expresa.
6. `20261127032849_billing_action_permissions.sql`: preparar, correo, reportes y
   numeración independientes; MFA, RLS y límite de columnas del reenvío; actor manual
   conservado también en trabajos previos que tienen una acción de reenvío registrada.

No se alteran credenciales, XML, importes ni consecutivos históricos. Los cambios
de autoridad mantienen membresías y departamentos. La dirección de correo sigue
siendo texto; `email_delivery_enabled` es la nueva elección explícita, desactivada
por defecto. No se instalan dependencias ni se contratan servicios.

## Verificación y límites de la evidencia

- Suite final del servidor: **594 pruebas aprobadas en 81 archivos**
  (`npm test`, 115,62 s; `.local/billing44-verified-suite.log`). Incluye regresiones
  de compatibilidad histórica, domicilio y estado real de comprobación del XML.
- SQL/RLS: nueve comprobaciones aprobadas de empresa, departamento, escrituras,
  reasignación, auditoría, MFA, revocación y acceso anónimo.
- Validador Python: once pruebas de XML/firma con material sintético aprobadas.
- Auditoría de paquete: `package_verified`; comprueba procedencia y hashes, no
  sustituye los ensayos de XML firmado ni una respuesta real de Hacienda.
- Build de web/servidor y TypeScript aprobados.
- Navegador: **88 escenarios distintos verificados**, computadora y Android
  simulado, con conexión restringida de la API. La suite general verificó 78;
  sus diez fallas quedaron resueltas y el bloque afectado pasó 28/28
  (`.local/billing44-browser-closure.log`). Después de ajustar la comprobación
  independiente del domicilio/XML se repitieron 20/20 escenarios de empresa,
  facturación y preparación (`.local/billing44-readiness-browser.log`). No se
  presenta la primera ejecución con fallas como una suite aprobada.

La revisión independiente fue focalizada y aportó hallazgos corregidos; no terminó
un dictamen integral por una limitación de capacidad. Se continuó con revisión
propia y pruebas de regresión. No se presenta como una certificación tributaria.

El estado «Cumplido» del domicilio exige datos territoriales válidos y otras
señas, independientemente de que exista el proveedor del sistema. La comprobación
preliminar de XML permanece pendiente hasta ejecutarse correctamente. La firma y
el XSD completo se verifican en su etapa, antes de la transmisión.

## Lo necesario para la primera prueba auténtica

1. Autorizar la publicación y las seis migraciones del entorno de pruebas.
2. Completar Mi empresa y su domicilio, inscripción, sucursal y terminal reales.
3. Registrar llave y credenciales de **Pruebas** por la interfaz HTTPS, comprobar
   IdP y efectuar la revisión administrativa. No enviar PIN ni llaves por chat.
4. Confirmar la numeración revisada de pruebas; preparar una FE nacional con
   datos fiscales completos, CABYS verificado y totales consistentes.
5. Emitir en pruebas, conservar respuesta auténtica, XML firmado y PDF. Comprobar
   que la clave y los importes coinciden; un HTTP de recepción no basta.
6. Configurar SMTP y la entrega elegida; verificar un correo de prueba autorizado
   con los adjuntos correspondientes.

Producción continúa deshabilitada. Su habilitación requiere aprobación expresa
y aceptación auténtica previa en pruebas, con credenciales, revisión y numeración
de producción independientes. Una primera operación real debe corresponder a
una venta real autorizada.
