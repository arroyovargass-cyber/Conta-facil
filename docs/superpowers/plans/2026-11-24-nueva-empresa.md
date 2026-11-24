# Nueva empresa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** Crear y editar empresas desde seis pestañas con administración exclusiva del propietario.
**Architecture:** Reutilizar tenants, membresías, actividades, sucursales, terminales y bóveda. Validación compartida estricta; operación transaccional idempotente y versión de edición; RLS verifica condición de operador y MFA.
**Tech Stack:** React, TypeScript, Zod, PostgreSQL y Supabase existentes, sin dependencias nuevas.
**Spec:** docs/superpowers/specs/2026-11-24-nueva-empresa-design.md

## Global Constraints
- No cambiar inicio de sesión, menú general ni panel principal.
- No publicar ni desplegar automáticamente.
- No desarrollar módulos contables ni realizar envíos a Hacienda.
- Conservar registros y consecutivos existentes; secretos exclusivamente en la bóveda existente.
- Pruebas directamente relacionadas y resumen breve.

## Review Focus
- Usuario administrador convencional intenta modificar empresa o otorgarse permisos.
- Reintentos simultáneos con la misma identificación u operación.
- Edición de empresa inactiva y reactivación sin habilitar sus operaciones.
- Cambio de empresa mientras una respuesta de formulario sigue pendiente.
- Parámetros o logo malformados y secretos enviados al JSON de configuración.

### Task 1: Dominio y restricciones
**Files:** packages/domain/src/company.ts; supabase/migrations/*company_administration.sql; tests/company.test.ts.
**Interfaces:** companyInput, createCompanyInput, updateCompanyInput, companyPreparation(input); private.is_system_administrator(); tenants.configuration y configuration_version.
- [x] Escribir pruebas de campos básicos, identificación, parámetros, fechas, secretos y condiciones pendientes; ejecutar RED.
- [x] Implementar esquema y migración aditiva con RLS y restricciones administrativas. Aplicar solo local.
- [x] Ejecutar pruebas de dominio GREEN y registrar resultado.

### Task 2: API transaccional
**Files:** apps/api/src/modules/company-registration.ts; apps/api/src/modules/companies.ts; apps/api/src/app.ts; tests/integration/company-registration.test.ts.
**Interfaces:** GET /api/company-administration; GET /api/company-administration/:id; POST /api/company-administration; PATCH /api/company-administration/:id. POST usa operation_id; PATCH expected_version. GET incluye capacidad owner sin modificar login.
- [x] Pruebas RED de no máster, MFA, alta, idempotencia, duplicado, aislamiento, actualización obsoleta e inactividad.
- [x] Crear rutas con autenticación y CSRF existentes, transacciones bloqueadas, membresía del creador, auditoría y reutilización de actividades/sucursales/terminales.
- [x] Añadir consulta oficial de identificación y ubicaciones para nueva empresa sin exigir una empresa creada.
- [x] Ejecutar integración GREEN; comprobar denegación directa por RLS y contadores intactos.

### Task 3: Formulario de seis pestañas
**Files:** apps/web/src/features/companies/CompanyWorkspace.tsx y company.css; apps/web/src/app.tsx; tests/browser/company-registration.spec.ts.
**Interfaces:** CompanyWorkspace({tenantId,onSaved}); recargar selector tras alta, usar capacidad autenticada del servidor.
- [x] Prueba RED de Nueva empresa, guardar datos básicos, reapertura, seis pestañas y denegación no máster.
- [x] Implementar campos solicitados, validación, territorios dependientes, actividades múltiples, configuración contable y estado honesto. Credenciales mediante componente de bóveda existente tras guardar empresa.
- [x] Prueba GREEN escritorio/móvil; verificar que el formulario no guarda secretos en la configuración.

### Task 4: Verificación y entrega local
**Files:** tests/support/workspace.ts (opción explícita de operador para fixtures); docs/development/new-company-evidence.md.
- [x] Ejecutar pruebas relacionadas de empresas, autorización, credenciales y aislamiento; TypeScript y build.
- [x] Revisión independiente de cambios; corregir hallazgos importantes con prueba de regresión.
- [x] Registrar migración local, pruebas y dependencias. Commit local sin push ni despliegue.
