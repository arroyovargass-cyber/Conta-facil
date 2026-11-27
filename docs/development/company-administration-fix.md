# Corrección puntual de Mi empresa

Preparada en `fix/company-administration`, desde `main` (`9a61afd`).
Evidencia original de la corrección aislada. Posteriormente se integró en
`feat/billing44-complete-workspace`; ver la [matriz de cierre](billing44-closeout.md).
No se publicó código ni se aplicaron migraciones remotas.

## Diagnóstico y cambios

- Se reprodujo HTTP 403 al actualizar el domicilio con `conta_facil_api`,
  sin USAGE en `auth`. El trigger invocador `private.company_version()`
  intentaba resolver `auth.uid()` bajo ese rol restringido.
- La migración aditiva `20261126215114_fix_company_version_request_context.sql`
  obtiene `updated_by` de los claims verificados de la transacción. Conserva
  el incremento de versión y la fecha. No concede permisos, cambia RLS ni
  incorpora SECURITY DEFINER. Las migraciones históricas no se modifican.
- El formulario identifica las filas ya guardadas. Solo permite eliminar filas
  nuevas y descarta las nuevas sin código, descripción ni fuente. Las filas
  parcialmente completas y las guardadas que se vacían siguen validándose.
  El servidor mantiene su validación estricta.
- Los errores se muestran en español y abren su pestaña. Los errores del
  domicilio detectados por el servidor señalan expresamente esa sección.

Archivos funcionales: `CompanyWorkspace.tsx`, `company-form.ts`,
`packages/domain/src/company.ts`, `company-registration.ts` y la migración.
Se reutiliza la creación existente de sucursales y terminales.

## Verificación local

- 36 pruebas de dominio/API aprobadas, incluida la regresión 403 → 200.
- 18 pruebas de navegador aprobadas en computadora y móvil, con el servidor
  conectado como `conta_facil_api`, NOSUPERUSER, NOINHERIT, NOBYPASSRLS y sin
  USAGE en `auth`. Las cuentas sintéticas se preparan con una conexión local
  independiente; las solicitudes reales pasan por el servidor restringido.
- Guardado desde las seis pestañas; versión, fecha y actor; rechazo sin MFA,
  sin privilegios de operador o sin membresía; sucursales y terminales.
- Los registros sintéticos de credenciales, facturas y consecutivos públicos
  y privados permanecieron iguales. Se conservó un consecutivo existente 37.
- Compilación de producción, TypeScript y revisión de espacios aprobadas.

Comandos: `vitest run tests/company.test.ts tests/company-form.test.ts
tests/integration/company-registration.test.ts
tests/integration/company-update-auth-schema.test.ts`; `npm run build`;
`node --import tsx infra/test-company-browser.ts` con Chromium local configurado.
