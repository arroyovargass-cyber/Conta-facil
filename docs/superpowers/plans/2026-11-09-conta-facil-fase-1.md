# Conta Fácil Fase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar una base multiempresa funcional, reproducible y comprobable localmente, con acceso, permisos, organización y configuración tributaria.

**Architecture:** React consume una API Node.js modular. Supabase proporciona Auth y PostgreSQL; el backend preserva RLS usando el JWT del usuario. Las operaciones privilegiadas se aíslan del acceso ordinario.

**Tech Stack:** TypeScript, React, Vite, Tailwind, Fastify, Supabase Auth/PostgreSQL, Vitest, pgTAP y pruebas HTTP con Fastify inject. Fijar versiones compatibles y lockfile al preparar el entorno.

**Spec:** [Diseño aprobado](../specs/2026-11-09-conta-facil-fase-1-design.md)

## Global Constraints

- Fase 1 exclusivamente; no emisión XML, firma, transmisión, importación de correo ni contabilidad.
- UUID de Supabase como identidad interna. Identificaciones son texto.
- Denegar por defecto. RLS aplica a todas las tablas expuestas.
- Nunca exponer service_role, certificados, contraseñas ni tokens en frontend o logs.
- Las consultas ordinarias usan el JWT del usuario y preservan RLS.
- No crear infraestructura de pago ni modificar un proyecto existente sin identificarlo y obtener la autorización de costos necesaria.
- No declarar producción por pasar pruebas de Fase 1.
- Primera entrega reproducible local; si falta capacidad para ejecutar Supabase, declarar la verificación bloqueada y entregar comandos reproducibles sin simular resultados.

## Review Focus

- Identificación con ceros, letras o separadores: no fusionar titulares diferentes ni perder información (tarea 2).
- Revocación durante una sesión válida: acceso denegado desde la siguiente petición (tareas 2 y 3).
- Dos administradores revocándose concurrentemente: debe permanecer al menos uno activo (tarea 3).
- Invitación vencida, repetida o aceptada por otro titular: no conceder acceso (tarea 3).
- Cambio de empresa con peticiones pendientes: no presentar respuestas de la empresa anterior (tarea 5).

## Estructura de archivos

- `package.json`, `package-lock.json`, `tsconfig.base.json`: workspace, scripts y compilación.
- `apps/api/src/app.ts`, `server.ts`, `config.ts`: composición, arranque y configuración validada.
- `apps/api/src/modules/{identity,tenants,authorization,organization,tax,audit}/`: rutas, servicios y repositorios por dominio.
- `apps/api/src/security/{session,csrf,rate-limit,logging}.ts`: límites compartidos y redacción.
- `apps/api/scripts/bootstrap.ts`: alta administrativa explícita, sin contraseñas predeterminadas.
- `apps/web/src/{app,api,components,features}/`: interfaz, transporte y módulos.
- `packages/contracts/src/index.ts`: esquemas de entrada/salida compartidos.
- `packages/domain/src/{identity,permissions}.ts`: normalización y decisiones puras.
- `supabase/config.toml`, `supabase/migrations/`, `supabase/tests/`: entorno, esquema y pruebas RLS. Generar nombres de migración con CLI, sin inventar timestamps.
- `tests/integration/`, `docs/runbooks/`, `.env.example`, `README.md`: pruebas conectadas e instrucciones sin secretos.

## Tarea 1: Base de datos y aislamiento empresarial

**Archivos:** configuración raíz, `supabase/config.toml`, migraciones generadas por CLI, `supabase/tests/tenant_isolation.sql`, `packages/contracts/src/index.ts`.

**Interfaces:** produce TenantId/UserId UUID, Membership con estado y alcance `company|departments`; catálogo `(module, action)`; referencias compuestas `(tenant_id,id)`. Tablas y roles según diseño aprobado.

- [ ] Inspeccionar instrucciones locales, runtimes, Docker y Supabase CLI; consultar `--help`, fijar versiones y preparar workspace aislado. Revisar documentación vigente antes de instalar dependencias.
- [ ] Escribir prueba SQL: usuario A no ve B; inserción con tenant B falla; cambio de tenant falla; terminal A no referencia sucursal B; anónimo no ve empresas; auditor no modifica. Crear fixtures sintéticos en transacción revertible.
- [ ] Ejecutar `supabase test db` y registrar fallo por esquema/políticas faltantes, o imposibilidad de ejecución del entorno.
- [ ] Crear migraciones para empresas, perfiles, membresías, siete plantillas de rol empresarial, operadores globales privados, permisos, organización, configuración y auditoría; habilitar RLS, índices y claves compuestas. Separar directorio de login y sesiones en esquema privado; políticas sin recursión.
- [ ] Repetir `supabase db reset` y `supabase test db`: todas las pruebas pasan con JWTs de usuarios reales de prueba. Revisar grants y funciones privilegiadas; ejecutar asesores disponibles sin modificar proyectos ajenos.
- [ ] Guardar cambios en commit si el repositorio permite escritura; si no, registrar esa limitación sin tocar `.git` protegido.

## Tarea 2: Identidad, sesión, recuperación y MFA

**Archivos:** `packages/domain/src/identity.ts`, `apps/api/src/modules/identity/{routes,service,repository}.ts`, `apps/api/src/security/{session,csrf,rate-limit,logging}.ts`, `apps/api/scripts/bootstrap.ts`, `tests/integration/identity.test.ts`.

**Interfaces:** `normalizeIdentification(input: {country:string; type:string; value:string}): string`; `createApp(config: AppConfig): FastifyInstance`; `requireSession(request): Promise<Principal>` donde Principal contiene userId, sessionId y aal. Rutas `/api/auth/login`, `/logout`, `/recover`, `/reset`, `/mfa/enroll`, `/mfa/verify`, `/session`; cookies protegidas, respuestas sin tokens.

- [ ] Escribir pruebas: conserva `00123` y letras; normalización dependiente del tipo; login desconocido y contraseña errónea usan el mismo mensaje; límite compartido responde 429; falta de CSRF/origen permitido rechaza mutación; sesión revocada o perfil inactivo da 401; AAL1 no administra; AAL2 sí; recuperación no revela existencia.
- [ ] Ejecutar `npm test -- identity` y verificar fallo esperado antes de implementar.
- [ ] Implementar directorio privado hacia email verificado, Supabase Auth, cookies HttpOnly/SameSite/Secure en HTTPS, renovación, expiración y revocación comprobada en servidor. Guardar tokens solo en sesión protegida del servidor o cookies cifradas autenticadas; clave fuera de BD. Rate limit compartido PostgreSQL con retención corta. Nunca persistir contraseñas.
- [ ] Implementar bootstrap por entrada protegida de consola, invitación y recuperación con SMTP local; TOTP y bloqueo de operaciones administrativas hasta AAL2. Documentar recuperación de MFA sin bypass ordinario.
- [ ] Ejecutar pruebas con Auth local y correo local; inspeccionar respuestas/logs para ausencia de secretos. `npm run typecheck` debe pasar.
- [ ] Guardar commit de identidad verificada.

## Tarea 3: Empresas, autorización y usuarios

**Archivos:** `packages/domain/src/permissions.ts`, `apps/api/src/modules/tenants/{routes,service,repository}.ts`, `apps/api/src/modules/authorization/{routes,service,repository}.ts`, `tests/integration/authorization.test.ts` y migración adicional si hace falta.

**Interfaces:** `authorize(principal: Principal, input: {tenantId:string; module:string; action:string; departmentId?:string}): Promise<void>`; rutas `/api/companies`, `/api/companies/:tenantId/memberships`, `/roles`, `/invitations` relativas a empresa. Mutaciones administrativas requieren AAL2 y permiso explícito.

- [ ] Escribir pruebas: usuario compartido ve ambas empresas autorizadas; exclusivo solo una; departamento ajeno da 403/404 sin datos; revocación tiene efecto en siguiente petición; operativo no cambia su rol; plataforma sin membresía no consulta datos fiscales; invitación caducada/repetida/otro email no concede acceso; revocaciones concurrentes no eliminan último administrador.
- [ ] Ejecutar `npm test -- authorization` y comprobar fallo esperado.
- [ ] Implementar comprobación de sesión, membresía, permiso y alcance; operaciones ordinarias bajo RLS. Hacer cambios sensibles y auditoría en transacción; bloquear fila de empresa para proteger último administrador. Alta de empresa por operador global aislado; invitación requiere aceptación y verificación.
- [ ] Ejecutar pruebas API y SQL, incluyendo llamadas directas a Data API con JWT de usuario para comprobar que no se elude autorización.
- [ ] Guardar commit de administración autorizada.

## Tarea 4: Organización, configuración y auditoría

**Archivos:** `apps/api/src/modules/organization/{routes,service,repository}.ts`, `apps/api/src/modules/tax/{routes,service,repository}.ts`, `apps/api/src/modules/audit/{routes,repository}.ts`, `tests/integration/organization.test.ts`.

**Interfaces:** rutas por empresa `/departments`, `/cost-centers`, `/branches`, `/terminals`, `/tax-settings`, `/economic-activities`, `/audit`; listados `{items,nextCursor}`. Configuración con `environment: test|production`, `status: draft|verified` y referencias de fuente; no endpoints para introducir secretos tributarios.

- [ ] Escribir pruebas: nombres vacíos rechazados; alcance departamental respetado; relación de otra empresa rechazada; desactivar entidad referenciada preserva historial; configuración incompleta solo borrador; producción/pruebas separadas; auditoría inmutable para usuario de aplicación; rollback no deja cambio ni auditoría de éxito.
- [ ] Ejecutar `npm test -- organization` y verificar fallo esperado.
- [ ] Implementar CRUD con desactivación lógica, paginación y validación; no aceptar catálogos inventados ni campos de secretos. Registrar cambios permitidos con actor/fecha/empresa y redacción explícita.
- [ ] Ejecutar pruebas API/SQL y `npm run typecheck`; comprobar que respuestas de auditoría no exponen identificaciones completas, tokens ni contraseñas.
- [ ] Guardar commit de organización y configuración.

## Tarea 5: Interfaz conectada de Fase 1

**Archivos:** `apps/web/src/app/*`, `apps/web/src/api/client.ts`, `apps/web/src/components/*`, `apps/web/src/features/{auth,companies,memberships,organization,tax,audit}/*`, `apps/web/src/features/companies/company-switch.test.tsx`.

**Interfaces:** `apiRequest<T>(path:string, options?:RequestInit): Promise<T>` usa cookies y CSRF; proveedores de sesión y empresa activa. Contratos de tareas 1–4; ninguna autorización depende de botones ocultos.

- [ ] Escribir prueba de cambio de empresa: petición pendiente A resuelve después de cambiar a B y no aparece; cerrar sesión borra caché; respuesta 403 muestra falta de permiso sin datos previos.
- [ ] Ejecutar `npm test -- company-switch` y verificar fallo esperado.
- [ ] Implementar acceso, recuperación, MFA, selector, configuración inicial, usuarios/roles, organización, configuración tributaria y auditoría con formularios accesibles. Mostrar solo conteos reales; marca de fase futura en facturación y recepción. Cancelar peticiones y aislar caché por tenant.
- [ ] Conectar formularios y listados a API real; validar loading, errores, vacíos y doble envío. No crear un modo demostración que se confunda con acceso real.
- [ ] Ejecutar pruebas, typecheck y build. Verificar navegación por teclado y tamaño móvil usando herramientas disponibles; si Sites requiere referencia específica de preview, leerla antes de iniciar navegador/servidor.
- [ ] Guardar commit de interfaz conectada.

## Tarea 6: Verificación integrada y entrega

**Archivos:** `tests/integration/phase1.test.ts`, `README.md`, `.env.example`, `docs/runbooks/{local-setup,security,backup-restore,phase1-evidence}.md`.

**Interfaces:** `npm run dev`, `npm run build`, `npm run typecheck`, `npm test` y comandos Supabase documentados para la versión fijada; entorno sin credenciales de producción.

- [ ] Escribir recorrido integrado con dos empresas: bootstrap, MFA, invitación aceptada, selección, CRUD de departamentos y configuración, restricción de usuario operativo, revocación y consulta de auditoría.
- [ ] Ejecutar recorrido, corregir fallos mediante diagnóstico y repetir únicamente comprobaciones afectadas.
- [ ] Ejecutar desde BD limpia pruebas RLS/Auth/API, typecheck y build; guardar comandos, fecha y resultados efectivos. Si falta Docker, red o dependencias, identificar exactamente qué no se pudo verificar y no declarar esas pruebas aprobadas.
- [ ] Documentar instalación, variables sin valores reales, SMTP, bootstrap, restauración verificada con datos sintéticos, rotación de claves de sesión y procedimiento de MFA. Política de retención tributaria permanece pendiente de validación antes de documentos fiscales.
- [ ] Solicitar revisión final de seguridad/código según guía aplicable; resolver defectos materiales antes de entrega.
- [ ] Entregar avance ejecutable y evidencia. Publicar solo componentes compatibles y funcionales con su backend real; si faltan recursos conectados, informar despliegue pendiente. No certificar facturación 4.4 ni producción.

## Autorrevisión del plan

Cobertura: alcance y arquitectura (1), identidad/MFA (2), aislamiento y autorización (1–3), organización/configuración/auditoría (4), interfaz (5), entrega y verificación (6). Los cinco riesgos de Review Focus tienen pruebas asignadas. Contratos mantienen tenantId/userId y estado AAL en servidor. Infraestructura pagada, emisión, secretos tributarios operativos y contabilidad siguen fuera de esta ejecución; no se sustituyen por funcionalidades ficticias.
