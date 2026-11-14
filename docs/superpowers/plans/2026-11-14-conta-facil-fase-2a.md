# Conta Fácil Fase 2A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Entregar clientes, catálogo y borradores comerciales aislados por empresa y departamento.

**Architecture:** Módulos Fastify independientes sobre transacciones PostgreSQL con RLS. Componentes React separados del componente principal existente; contrato compartido para importes exactos y validación comercial.

**Tech Stack:** TypeScript, React, Fastify, PostgreSQL/Supabase, Zod, Vitest, Playwright; sin servicios comerciales nuevos.

**Spec:** `docs/superpowers/specs/2026-11-14-conta-facil-fase-2a-design.md` (aprobado por el usuario).

## Global Constraints

- «Borrador — sin validez tributaria»; sin clave, consecutivo, impuestos, firma, envío ni PDF tributario.
- «Importe de líneas antes de impuestos»; valores como texto decimal, hasta nueve enteros/cinco decimales de entrada y diez decimales de producto.
- CRC/USD; no convertir monedas automáticamente; de 1 a 100 líneas.
- Sesiones y MFA existentes, RLS, referencias compuestas por empresa y autorización origen/destino departamental.
- Catálogos desactivables, borradores archivables; sin borrado físico de documentos.
- No cambiar ContaNova ni solicitar secretos por chat. Primero migraciones y pruebas locales.
- Ejecución directa por el agente principal, revisión independiente final: conservar la preferencia previa del usuario.

## Review Focus

- Cliente/producto desactivado tras guardar: conservar copia histórica y permitir mantener la referencia al editar.
- Cambio rápido de empresa o salida de sesión: descartar respuestas antiguas y limpiar formularios.
- Dos pestañas guardando: conflicto 409 por versión sin sobrescritura silenciosa.
- Reintento tras perder respuesta: una sola creación; misma operación con contenido diferente produce 409.
- Acceso directo a líneas y reasignación departamental: no filtrar datos ni saltar RLS mediante IDs conocidos.

---

### Task 1: Contrato comercial y aritmética exacta

**Files:** crear `packages/domain/src/billing.ts`, `tests/billing.test.ts`.

**Interfaces:** exportar `decimalInput` (Zod texto decimal no negativo), `customerInput`, `catalogInput`, `draftInput`; tipos inferidos `CustomerInput`, `CatalogInput`, `DraftInput`; `lineAmount(quantity: string, price: string): string`, `subtotal(lines: {quantity: string; unit_price: string}[]): string`. Borrador incluye `operation_id` UUID al crear, `version` al editar, `customer_id`, `department_id`, `currency`, `notes`, `lines`; cada línea `catalog_item_id` opcional, `description`, `quantity`, `unit_price`.

- [x] Escribir tests: `0.1 × 0.2 = 0.02`, suma `0.02 + 0.03 = 0.05`, cinco decimales multiplicados conservan diez; límites máximos, cantidad cero rechazada, precio cero admitido, exponente/NaN/sexto decimal rechazados; 0/101 líneas y campos fiscales rechazados.
- [x] Ejecutar `npx vitest run tests/billing.test.ts`; comprobar fallo por módulo ausente.
- [x] Implementar validadores estrictos y aritmética BigInt escalada con resultado decimal canónico, sin redondeo tributario.
- [x] Repetir prueba hasta PASS y `npm run typecheck`; commit de contrato y pruebas.

### Task 2: Persistencia, RLS y permisos

**Files:** crear `supabase/migrations/20261114040000_phase2a.sql`, `tests/integration/billing-security.test.ts`; reutilizar `tests/support/workspace.ts`.

**Interfaces:** tablas `customers`, `catalog_items`, `invoice_drafts`, `invoice_draft_lines` con campos del diseño; `private.has_catalog_access(uuid,text)` aplica sesión, membresía, permiso y MFA sin restricción departamental. Borradores/líneas usan `private.has_access(tenant_id,permission,department_id)`. Nuevos permisos `customers.read/manage`, `catalog.read/manage`, `invoices.read/manage`. Cantidades/precios `numeric(14,5)`; versiones enteras positivas; copia de cliente JSON de estructura acotada y copias de línea tipadas. No permitir transición a estados fiscales.

- [x] Escribir pruebas con claims y rol authenticated: otra empresa no visible, FK cruzadas rechazadas, miembro departamental lee catálogo pero no otro departamento, líneas heredan restricción, escritura sin permiso/MFA y sesión revocada fallan.
- [x] Ejecutar `npx vitest run tests/integration/billing-security.test.ts`; comprobar fallo por tablas ausentes.
- [x] Implementar migración transaccional: constraints, índices, RLS, grants mínimos, auditoría sin contenido personal, permisos de roles existentes y seed de empresas futuras según diseño; helper con search_path seguro.
- [x] Aplicar únicamente local con `npm run db:migrate`; repetir pruebas y `npm run test:db`; verificar que runtime no tiene bypass RLS; commit.

### Task 3: API de catálogos y borradores

**Files:** crear `apps/api/src/modules/customers.ts`, `catalog.ts`, `invoicing.ts`, `billing-common.ts`; modificar `apps/api/src/app.ts`; crear `tests/integration/billing-api.test.ts`.

**Interfaces:** exportar `customerRoutes(app,pool,auth)`, `catalogRoutes(app,pool,auth)`, `invoicingRoutes(app,pool,auth)` con tipos existentes. GET/POST `/api/companies/:tenantId/customers`, `/catalog-items`, `/invoice-drafts`; GET/PATCH `/:id`. GET devuelve `{items,nextCursor}`, detalle/guardado `{item}`; borrador incluye líneas y `subtotal` textual. Catálogos PATCH incluye `version`; borrador PATCH permite edición completa con `version` o solo `{version,archived:boolean}`. Creación incluye `operation_id`; edición no lo acepta.

- [x] Escribir tests de CRUD autorizado, 50+ resultados/paginación, búsqueda literal `% _`, monedas, copias históricas tras desactivar/cambiar catálogo, archivo/restauración, conflictos de versión, acceso ajeno, departamento origen/destino y rollback de líneas inválidas.
- [x] Escribir prueba de dos POST concurrentes con misma operación: mismo UUID y un documento; contenido distinto 409. Probar dos PATCH con misma versión: un éxito y un 409.
- [x] Ejecutar `npx vitest run tests/integration/billing-api.test.ts`; comprobar rutas 404 iniciales.
- [x] Implementar transacciones scoped, consultas parametrizadas, autorización de catálogo específica y departamento, validación activa/referencias históricas, hash canónico de creación e idempotencia con restricción única; control optimista en SQL. Listados limit50 con orden estable y búsqueda max100. Ajustar límite de cuerpo solo en rutas de borrador hasta 256 KiB para admitir 100 líneas, límites de texto siguen acotados.
- [x] Repetir tests de API/seguridad y typecheck; commit.

### Task 4: Interfaz funcional adaptable

**Files:** crear `apps/web/src/features/billing/{BillingWorkspace,Customers,Catalog,Drafts}.tsx`, `billing.css`; modificar `apps/web/src/app.tsx`; crear `tests/browser/phase2a.spec.ts`, ampliar `tests/browser/setup.ts` con datos locales ficticios de permisos/departamentos.

**Interfaces:** `BillingWorkspace({tenantId,view,permissions}: {tenantId:string;view:'customers'|'catalog'|'drafts';permissions:string[]})`; usa `apiRequest`/`post` existentes. El componente padre desmonta con key tenant+view y sesión; componentes descartan cargas obsoletas, debounce300ms, formularios no conservados entre empresas. Los permisos departamentales del editor se consultan en backend; no derivarlos de permisos globales de overview que hoy niegan acceso sin departamento.

- [x] Escribir prueba navegador escritorio/móvil: crear cliente/producto y borrador, subtotal exacto, reabrir/editar, archivar/restaurar; mensajes de borrador no fiscal visibles; inputs etiquetados y formulario navegable por teclado.
- [x] Añadir pruebas de cambio de empresa durante petición retrasada, guardado rechazado por versión y referencia desactivada; comprobar que errores mantienen lo escrito y no disparan duplicados.
- [x] Ejecutar `npx playwright test tests/browser/phase2a.spec.ts`; comprobar fallo por navegación ausente.
- [x] Implementar navegación y formularios separados usando estilos actuales; seleccionar moneda filtra productos compatibles, sin aplicar conversiones. Obtener opciones paginadas por búsqueda del servidor (no limitar selectores a los primeros50). Mantener UUID de creación durante reintentos y bloquear doble clic mientras guarda. Mostrar 409 con opción de recargar, sin sobrescribir automáticamente.
- [x] Repetir pruebas de navegador y `npm run build`; commit.

### Task 5: Verificación, revisión y evidencia

**Files:** crear `docs/development/phase2a-evidence.md`; actualizar estado de investigación y documentación de ejecución local.

- [x] Ejecutar `npm test`, `npm run test:db`, `npm run test:browser`, `npm run build`; registrar resultados reales y resolver fallos con pruebas pertinentes, sin afirmar éxito antes del resultado.
- [x] Revisor independiente comprueba diff completo contra diseño y riesgos multiempresa, permisos, decimales, transacciones, idempotencia y sesiones; resolver hallazgos y repetir las pruebas afectadas.
- [x] Documentar flujo reproducible, capturas con datos ficticios, límites fiscales, estado real de publicación y hash de migración. Comprobar `git diff --check`, ausencia de secretos y cambios ajenos.
- [x] Commit final y entrega con evidencia local; no declarar integración Hacienda ni despliegue online completados.

## Revisión del plan

Cobertura: tareas 1–3 cubren modelo comercial, autorización y consistencia; tarea4 experiencia y alcance; tarea5 regresión y entrega. Los cinco riesgos de Review Focus tienen pruebas en tareas2–4. La integración tributaria queda explícitamente fuera de 2A. Diseño técnico pendiente razonablemente delegable: estructura interna de componentes/fixtures e índices según consultas; no requiere nuevas decisiones de producto.

## Resultado

Implementado y verificado localmente: 68 pruebas de aplicación, nueve aserciones SQL y22 casos de navegador; build aprobado. Revisión independiente y correcciones con reproducción RED→GREEN. Evidencia en `docs/development/phase2a-evidence.md`. No se publicaron servicios ni se habilitó emisión fiscal.
