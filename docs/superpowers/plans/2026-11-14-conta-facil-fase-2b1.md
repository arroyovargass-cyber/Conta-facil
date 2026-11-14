# Conta Fácil Fase 2B1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Mostrar cálculos exactos de IVA13% y bloqueos de preparación fiscal para borradores autorizados, sin persistencia ni emisión.

**Architecture:** Función de dominio pura con enteros escalados, endpoint Fastify de consulta con sesión/CSRF/RLS y panel React separado dentro del detalle de borradores. Una consulta SQL obtiene cabecera y líneas en la misma instantánea, sin locks que requieran permisos de escritura.

**Tech Stack:** TypeScript, React, Fastify, Zod, PostgreSQL existente, Vitest y Playwright; sin dependencias nuevas ni migraciones.

**Spec:** `docs/superpowers/specs/2026-11-14-conta-facil-fase-2b1-design.md`, aprobado al responder «Continuar».

## Global Constraints

- Perfil único `FE_CRC_CASH_IVA13`, confirmación explícita; texto «Vista previa de impuestos — sin validez tributaria».
- Cantidad: hasta tres decimales significativos; entrada comercial de hasta nueve enteros/cinco decimales, dinero representable exactamente en cinco decimales y hasta9999999999999.99999.
- Ningún redondeo, truncamiento, conversión de moneda o total parcial ante cálculo bloqueado; incidencias `ROUNDING_POLICY_PENDING` para producto/IVA no representable.
- `canGenerateXml=false`, `xsdValidation='not_run'`, `signature='missing'`, `haciendaStatus='not_sent'` en todas las respuestas.
- Solo datos persistidos de borrador y líneas bajo RLS; no leer configuración tributaria o catálogos ajenos a los permisos del lector.
- No escribir documentos, impuestos, perfiles, auditoría comercial ni numeración; no generar XML/firma/PDF/transmisión.
- Ejecución directa y revisión independiente final según preferencia previa. Conservar rama existente, sin cambios remotos.

## Review Focus

- Dos versiones concurrentes de cabecera/líneas: una respuesta debe corresponder a una sola versión persistida.
- Decimales PostgreSQL con ceros finales y valores grandes: no convertir cantidades/precios JSON a Number ni rechazar ceros finales inocuos.
- Una línea inválida entre otras válidas: no mostrar total del documento ni líneas parciales como resultado completo.
- Apertura de otro editor, modificación, cierre o cambio de empresa mientras llega una respuesta: descartar resultados y errores antiguos.
- Un lector sin gestión ni `tax.read`: puede previsualizar lo autorizado, sin adquirir datos ni capacidades de edición tributaria.

---

### Task 1: Motor exacto y diagnóstico puro

**Files:** crear `packages/domain/src/fiscal-preview.ts`, `tests/fiscal-preview.test.ts`.

**Interfaces:** exportar `FiscalPreviewSource={currency:string;customerSnapshot:{identification_type?:string;identification?:string};lines:{position:number;quantity:string;unit_price:string}[]}`, `FiscalIssue={code:string;severity:'blocker';path?:string;position?:number;message:string;nextAction:string}`, `FiscalPreviewResult`, `fiscalPreviewRequest` (Zod estricto), `prepareFiscalPreview(source:FiscalPreviewSource):FiscalPreviewResult`. Resultado contiene `profile`, `calculation` y `readiness`; API añade `draft_id`/`draft_version`. Resultado completo incluye líneas `{position,base,vat,total}`, sumas `base`, `vat`, `total` y `currency:'CRC'`. Bloqueado contiene únicamente `status:'blocked',currency:'CRC'`, sin líneas ni importes.

- [x] Escribir tests `calculates_exact_general_vat`:1000→130→1130 y0.1×0.2→base0.02, IVA0.0026,total0.0226; suma dos líneas base0.04, IVA0.0052,total0.0452. Precio cero devuelve cero sin certificar gratuidad fiscal.
- [x] Escribir tests `rejects_unrepresentable_and_invalid_inputs`:0.10000 cantidad aceptada,0.00001 rechazada;1×0.00001 genera `ROUNDING_POLICY_PENDING`;0.001×0.00001 bloquea producto; NaN/exponente/negativos/cantidad0 o más de100 líneas bloquean con incidencia, sin totales parciales. Probar mezcla de línea válida e inválida.
- [x] Escribir tests de límites de producto y acumulado:100 líneas con cantidad1000 y precio100000000 superan límite del total; líneas individuales dentro del límite no justifican acumulado fuera de límite. Probar que base/IVA/total se comprueban por separado. USD bloquea por `UNSUPPORTED_CURRENCY`.
- [x] Escribir tests de diagnóstico: bloqueos constantes `SCHEMA_REVISION_UNCONFIRMED`, `SIGNATURE_MISSING`, `XML_GENERATION_DISABLED`, `ISSUER_PROFILE_PENDING`, `ISSUER_ACTIVITY_UNCONFIRMED`; cliente sin identificación `RECEIVER_IDENTIFICATION_MISSING` y presente `RECEIVER_IDENTIFICATION_UNCONFIRMED`; por línea `FISCAL_CLASSIFICATION_PENDING`. Cada incidencia contiene mensaje/acción en español y posición cuando procede. Contrato rechaza confirmación ausente/falsa, versión inválida, perfil diferente, tarifa/total/XML extra.
- [x] Ejecutar `npx vitest run tests/fiscal-preview.test.ts`; observar fallo por módulo ausente antes de implementación.
- [x] Implementar `prepareFiscalPreview` usando BigInt a escala100000 y divisiones exactas: producto escalado se divide por100000 solo si resto0; IVA=baseEscalada×13/100 solo si resto0. Normalizar fracción de cantidad quitando únicamente ceros finales antes de medir precisión. Aplicar límites a cada componente y sumas. La validación de datos devuelve incidencias, no excepciones internas; contrato HTTP sí usa Zod. No inferir clases/CABYS/tarifas a partir de valores actuales del catálogo.
- [x] Repetir pruebas y `npm run typecheck`; registrar RED→GREEN y commit del motor/pruebas.

### Task 2: Consulta HTTP consistente y autorizada

**Files:** crear `apps/api/src/modules/fiscal-preparation.ts`, `tests/integration/fiscal-preview.test.ts`; modificar `apps/api/src/app.ts`; reutilizar `tests/support/workspace.ts` y `runtime-config.ts`.

**Interfaces:** `fiscalPreparationRoutes(app:FastifyInstance,pool:pg.Pool,auth:ReturnType<typeof identity>):void`, POST `/api/companies/:tenantId/invoice-drafts/:id/fiscal-preview` con cuerpo de Task1; respuesta `{draft_id,draft_version,...FiscalPreviewResult}`.

- [x] Escribir pruebas con usuario accountant/auditor real (sin `invoices.manage` ni `tax.read`) y CSRF auténtico:200 con cifras de Task1, sin MFA adicional, repetición idempotente en efectos, archivado consultable. Guardar snapshot de filas/versiones/auditoría antes y después y comparar: ningún cambio comercial.
- [x] Escribir pruebas de dos empresas/departamentos y membresía revocada: objetos no visibles404, sin sesión401, Origin/CSRF inválidos403, expected_version antigua409. Payload con importes/tarifa/XML400; perfilUSD persistido produce cálculo bloqueado, no conversión. Mantener fuera de respuesta notas/contactos no requeridos por cálculo.
- [x] Escribir prueba de precisión real: insertar cantidad/price numéricos con escala5, consultar mediante API y verificar salida exacta; comprobar perfil de consulta no obtiene permisos nuevos ni depende de configuración fiscal visible.
- [x] Ejecutar `npx vitest run tests/integration/fiscal-preview.test.ts`; observar404 de ruta ausente.
- [x] Implementar la ruta con `scoped`, IDsUUID estrictos y una sola sentencia SQL para obtener cabecera/version/snapshot y agregado ordenado de líneas. En `jsonb_build_object` convertir explícitamente cantidad y precio a texto (`::text`) antes de JSON para impedir pérdida de precisión al parsear. RLS determina visibilidad; fila ausente404, versión distinta409. No usar FOR UPDATE/SHARE ni elevar rol para consultas. Origin/CSRF se conserva mediante hook existente.
- [x] Añadir comprobación reproducible de consistencia durante escritura concurrente: alternar transaccionalmente versión/notas/líneas y solicitar previsualizaciones; cada200 coincide con expected_version y su importe asociado, los demás son409. No ajustar `scoped` global para conseguir aislamiento ni hacer lecturas separadas de cabecera/líneas.
- [x] Ejecutar pruebas focalizadas y `npm test`; registrar resultados y commit de API/pruebas.

### Task 3: Panel React y protección del editor

**Files:** crear `apps/web/src/features/billing/FiscalPreview.tsx`, `tests/browser/fiscal-preview.spec.ts`; modificar `Drafts.tsx` y `billing.css`.

**Interfaces:** `FiscalPreview({base,draftId,version,dirty,disabled,generation,isCurrent,onConflict}: {base:string;draftId:string;version:number;dirty:boolean;disabled:boolean;generation:number;isCurrent:(generation:number)=>boolean;onConflict:()=>void})`. Usa `post` existente y tipos de Task1, sin cálculo financiero alternativo en frontend.

- [x] Escribir flujo escritorio/móvil: abrir borrador persistido, abrir «Vista previa de impuestos», confirmar perfil, calcular y verificar base1000/IVA130/total1130 y bloqueos fiscales. Sin confirmación no se envía petición. Probar precio/precisión bloqueados sin totales parciales y advertencia de monedaUSD. Navegación por teclado y ausencia de desbordamiento horizontal.
- [x] Escribir casos de estado: editar observaciones deshabilita cálculo con «guarda tus cambios antes de calcular» y borra resultado anterior; cerrar y reabrir pierde confirmación temporal; archivado permite lectura;409 por edición remota conserva formulario y ofrece recarga explícita. No agregar formulariosHTML anidados dentro del form de borrador.
- [x] Escribir casos con respuestas retenidas por ruta: calcular enA y abrirB/nuevo o cambiar empresa/salir; liberar respuesta y comprobar que no se muestra ni error ni resultado deA. Comprobar rechazo de respuestas de generación anterior dentro de la misma empresa, no solo desmontaje. Solicitudes repetidas durante cálculo en curso generan una sola petición.
- [x] Ejecutar `npm run build && npx playwright test tests/browser/fiscal-preview.spec.ts`; observar ausencia del panel antes de implementación.
- [x] Implementar panel fuera del fieldset de edición deshabilitado, accesible a lectores. Casilla de confirmación y botones `type='button'`; sin firma ni selector de tarifas no soportadas. Dinero como texto exacto, sin Intl/Number que reduzcan precisión. Separar cálculos de incidencias y mostrar posición/acción de cada bloqueo.
- [x] En `Drafts.tsx` centralizar invalidación de generación existente: incrementar ref y estado para que el panel se remonte/limpie inmediatamente al abrir/crear/cerrar/editar/escribir, incluso antes de resolver un detalle. Guardar fingerprint de campos comerciales persistidos al cargar detalle y compararlo con formulario para `dirty`; no modificar el borrador para calcular. Verificar `isCurrent` y montaje antes de aplicar resultado/error; contador/ref de petición evita doble envío.409 llama onConflict y permite el botón de recarga existente.
- [x] Repetir pruebas nuevas, pruebas de carreras de2A, `npm run build`; commit de interfaz/pruebas.

### Task 4: Regresión, revisión y entrega

**Files:** crear `docs/development/phase2b1-evidence.md`; actualizar README y estado del diseño/plan. Artefactos ficticios fuera de Git en `/workspace` y `.local/preview`.

- [x] Ejecutar `npm test`, `npm run test:db`, `npm run test:browser`, `npm run build` sobre el árbol final y registrar cifras reales. No ampliar pruebas sin cambio/fallo que lo justifique.
- [x] Revisor independiente final, sin implementación por agentes, comprueba diff completo contra diseño, Review Focus y decisiones del ledger. Corregir hallazgos importantes con prueba RED→GREEN y repetir suite afectada/completa según el alcance. Registrar límites y decisiones explícitos.
- [x] Documentar demostración local, precisión bloqueada, permisos de consulta, coherencia de versión y ausencia de escritura/emisión. Auditar secretos y archivos excluidos; `git diff --check` debe pasar. Commit final, ZIP solo de fuente y capturas con datos ficticios sin tokens/QR.
- [x] Entregar evidencia y estado real de GitHub/Render. No aplicar migraciones remotas, cambiar ContaNova, habilitar fiscalidad ni declarar Fase2 completa. Conservar trabajo en rama existente sin merge/publicación no solicitados.

## Revisión del plan

Task1 cubre cifras, límites, incidencias y contrato; Task2 autorización/consistencia/ausencia de escritura; Task3 experiencia, lectura, cambios locales y carreras; Task4 regresión y evidencia. Los cinco riesgos de Review Focus tienen casos asignados. No se requieren migraciones ni un nuevo runtime. La validación normativa y XML pendiente permanece fuera de este incremento, bloqueada expresamente en cada resultado.

## Resultado verificado

Implementado localmente:81 pruebas de aplicación, nueve aserciones SQL y30 casos de navegador aprobados; build aprobado. Revisión independiente sin hallazgos. No se habilitó generación XML ni emisión. Evidencia en `docs/development/phase2b1-evidence.md`.
