# Hacienda: pruebas y producción — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Independent domains may use the dispatching-parallel-agents workflow already selected for this work.

**Goal:** completar el circuito nacional FE4.4 en ambos ambientes con activación y evidencia explícitas.

**Architecture:** perfiles cerrados compartidos y ambiente fijado en el documento. Revisión privada de la llave y evidencia del GET oficial sustituyen las dependencias circulares sin afirmar identidad PKI no demostrada. Se conservan las capacidades de trabajador, inmutabilidad e idempotencia actuales.

**Tech Stack:** TypeScript, Fastify, React, PostgreSQL/Supabase, XMLDSig, validador Python XSD 1.1 existente.

**Spec:** `docs/superpowers/specs/2026-11-25-hacienda-pruebas-produccion-design.md`

## Global Constraints

- FE nacional únicamente; textos del usuario en español; no documentos ficticios de producción.
- Ambientes `test` y `production`; ninguna URL fiscal configurable ni fallback entre ambientes.
- Revisión `operator_verified` no equivale a identidad verificada por Hacienda.
- Política `official_api` requiere capacidad emitida por GET HTTPS directo más XSD/firma/correlación; la alternativa `pinned_certificate` permanece estricta.
- Banderas desactivadas por defecto. Credenciales/AAD, versiones, secuencias, trabajos y pruebas aisladas por tenant/ambiente.
- Migraciones creadas por CLI, aditivas y sin impuestos/counters históricos inventados.

## Review Focus

- Reintento de una operación anterior sin `environment`: devuelve su factura de pruebas, sin conflicto artificial ni factura nueva.
- Sustitución de llave o identificación durante la revisión: invalida el alta y bloquea nuevas emisiones; conserva consultas ya transmitidas.
- Trabajos de un ambiente apagado: no se reclaman ni se agotan sus intentos.
- Objeto de procedencia copiado o resultado JSON/XML discordante: no autoriza estado final.
- Selector cambiado mientras carga la pantalla: no presenta ni modifica datos del ambiente anterior como si fueran del nuevo.

### Task 1: Perfiles, transporte y evidencia de origen

**Files:** `packages/domain/src/hacienda-environment.ts`; `apps/api/src/services/hacienda-environments.ts`, `hacienda-idp.ts`, `hacienda-token-session.ts`, `hacienda-reception.ts`, `hacienda-response.ts`; pruebas correspondientes.

**Interfaces:** exportar `HaciendaEnvironment` y `haciendaEnvironmentInput`; `haciendaProfile(environment)` devuelve perfil cerrado. `probe(access, environment='test')`, `withAccess(access,use,environment='test')`, `submit(token,input,environment='test')`, `query(token,clave,environment='test',context?)`. Contexto de observación `{tenantId,credentialVersion}`. El resultado de query mantiene sus campos actuales; la capacidad se guarda en WeakMap, no en campos serializables. Exportar `verifyOfficialApiHaciendaResponse(result, expected, context)` y lector de evidencia; contexto incluye tenantId, credentialVersion y environment. No exportar función capaz de fabricar evidencia. Mantener `verifyHaciendaResponse(xml,expected,pins)` compatible.

- [x] Escribir y observar fallar pruebas de producción endpoint/cliente, separación, capacidades falsificadas/copiadas, TLS desactivado, identidad/tipo/importe/estado discordantes y firma matemática inválida.
- [x] Implementar interfaces y verificación, conservar pruebas anteriores y ejecutar suites unitarias del dominio. Resultado esperado: todas verdes, sin llamadas oficiales autenticadas.
- [x] Revisar y registrar evidencia de ejecución.

### Task 2: Custodia y revisión por ambiente

**Files:** `credential-vault.ts`, `credential-store.ts`, `modules/hacienda-configuration.ts`, migración de custodia nueva y pruebas de integración/criptografía.

**Interfaces:** métodos metadata/capability/current/deactivate/testConnection/withApiAccess admiten ambiente con default test; replace usa input.environment. GET `/hacienda?environment=...`; POST existente recibe ambiente. POST `/hacienda/credentials/enroll` recibe `{environment,expected_revision,confirmed:true,evidence_reference:string}`. Metadata añade `enrollment` nullable con status `operator_verified`, identidad/tipo, versión, huella, actor/fecha. Tabla privada `hacienda_credential_enrollments` clave tenant/environment/version; función `private.hacienda_enrollment(t uuid,e text,v integer)` retorna JSON solo con autorización Hacienda actual, o revisión válida para el trabajador por consulta dentro de su función. Contrato de lectura interna: fila de revisión incluye issuer_identification, issuer_identification_type y certificate_fingerprint.

- [x] Probar primero custodia y revisión separadas, idempotencia de revisión, permiso/MFA, versión obsoleta y cambio de identificación.
- [x] Implementar AES/AAD compatible y rutas; ampliar solo las restricciones de custodia en la migración propia.
- [x] Ejecutar tests de unidad. Coordinar una sola sesión para suites de integración compartidas.

### Task 3: Persistencia, numeración y cola por ambiente

**Files:** migración de emisión nueva, `services/emission-jobs.ts`, pruebas de integración correspondientes.

**Interfaces:** `Job.environment:HaciendaEnvironment`; `claim(limit=1,environments=['test'])`; el INSERT deriva ambiente del documento mediante trigger cerrado. `private.confirm_emission_numbering(t,b,tr,starting_value,e text default 'test')`; mantener wrapper antiguo si lo requiere compatibilidad. `private.recover_uncertain_emissions(environments text[] default array['test'])`. `invoice_emission_metadata` añade `enrollment` válido por versión/huella/identidad. Inmutabilidad protege environment/document_type/draft_id además de lo anterior. Tabla privada de evidencia `invoice_response_observations` con tenant_id/invoice_id/environment/credential_version/response_sha256/evidence JSON, inserción y lectura internas, única por documento/hash, inmutable.

**Revisión final:** `claim` admite un tercer filtro opcional `JobTrustEligibility` por ambiente. `private.emission_job_trust_policy(job uuid)` devuelve solamente la política conservada del documento al trabajador; no expone datos de factura ni tiene permiso interactivo. La disponibilidad se evalúa por documento, sin heredar la política predeterminada actual para nuevas emisiones.

- [x] Probar primero reclamo/recuperación filtrados, numeración independiente y sin descenso, mutación de ambiente rechazada y ausencia de permisos públicos.
- [x] Implementar ampliación de ambientes, unicidad tenant/draft/environment, funciones/cola y evidencia sin compartir migración de Task 2.
- [x] Ejecutar tests unitarios; integración compartida al terminar las migraciones completas.

### Task 4: API de preparación y autorización de emisión

**Files:** `modules/emission.ts`, `modules/emission-numbering.ts`, `services/emission-control.ts`, tests de integración.

**Interfaces:** preparación y listas aceptan `environment` default test; filtros y unicidad por ambiente. Emisión producción requiere `production_confirmation:true` además de operation/version. `issuePreparedInvoice` admite confirmación explícita; `emissionReadiness` usa banderas independientes y revisión `operator_verified` válida, más política elegida. Numeración GET/POST acepta environment. Config compartida agrega `HACIENDA_PRODUCTION_PROBE_ENABLED`, `HACIENDA_PRODUCTION_EMISSION_ENABLED` false, `HACIENDA_RESPONSE_TRUST_POLICY` enum official_api/pinned_certificate default pinned_certificate. No cambia shape de opciones comerciales.

- [x] Probar primero compatibilidad del hash de operaciones antiguas, un borrador por ambiente, rechazo de reutilización de operación cruzada, prod sin confirmación, emisión con revisión válida y bloqueo de obsoletas.
- [x] Implementar API/readiness y ejecutar suites tras integración de migraciones. Mantener el PIN/secretos fuera de errores y auditoría.

### Task 5: Pantallas por ambiente

**Files:** `features/hacienda/*.tsx`, `features/billing/Invoices.tsx`, `NumberingConfirmation.tsx`, `InvoiceActions.tsx` según corresponda, pruebas de navegador.

**Interfaces:** selector explícito Pruebas/Producción en Hacienda y Facturación. Usa contratos Tasks 2/4, limpia secretos al cambiar ambiente y cancela/ignora respuestas obsoletas. Revisión de llave con checkbox y referencia, identifica su carácter administrativo. Numeración etiquetada por ambiente. La confirmación producción envía production_confirmation:true; el PDF recibe ambiente del documento, no del selector actual.

- [x] Añadir pruebas de navegador para ambiente correcto, revisión y confirmación producción, sin suponer aceptación real.
- [x] Implementar sobre componentes existentes, conservar accesibilidad/permiso y ejecutar browser suite al terminar build integrado.

### Task 6: Integración de pipeline, entrega y revisión final

**Files:** `config.ts`, `app.ts`, `emission-pipeline.ts`, `invoice-pdf.ts`, runbook/evidencia y tests correspondientes.

**Interfaces:** transportar d.environment en token/recepción/AAD, verificar capacidad por tenant/version/environment, guardar evidencia y XML antes de estado final. Trabajador considera ambientes habilitados de configuración; policy official_api no exige pin pero sí evidencia. Wake/recovery filtra ambientes; API y cola usan la misma definición de habilitación. PDF identifica producción/pruebas correctamente.

- [x] Probar primero pipeline de ambos ambientes, reporte fiscal sin evidencia, envío incierto/no repetición y credencial cruzada.
- [x] Implementar integración y ejecutar typecheck, suites completas, Python, SQL/RLS, build y navegador. Registrar comandos/resultados reales.
- [ ] Solicitar revisión independiente del cambio completo y corregir fallos verificables. Publicar PR con dependencias reales de pruebas/producción; desplegar únicamente mediante el flujo autorizado y sin enviar operaciones reales de prueba por defecto.
