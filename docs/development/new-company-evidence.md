# Nueva empresa — entrega local, 24/11/2026

Implementación del diseño aprobado en `docs/superpowers/specs/2026-11-24-nueva-empresa-design.md`. La entrega local se publicó después de la autorización expresa del usuario; ver el registro de publicación al final.

## Cambios

- Nueva empresa y edición en seis pestañas, dentro de Mi empresa, con acceso inicial también desde el selector para un máster sin empresas. Datos generales, logo privado, domicilio, actividades, configuración de facturación y parámetros contables.
- Únicamente un operador de sistema registrado, con cuenta activa, sesión vigente y MFA, puede crear empresas, modificar configuración y administrar accesos. No se concede el privilegio por correo, orden de ingreso o metadatos del navegador. Se conserva el aislamiento por membresía incluso para el máster.
- Alta transaccional e idempotente; el creador queda como administrador. Detección de identificación normalizada duplicada también mediante trigger. Edición exige versión; el endpoint antiguo rechaza escrituras sin versión. La API de datos no permite UPDATE directo a empresas.
- Se conservan empresas, actividades históricas y consecutivos. Empresas inactivas pueden reabrirse administrativamente; siguen sin habilitarse sus operaciones normales. Credenciales de pruebas usan el componente y la bóveda cifrada existentes, separados del JSON empresarial.
- Los parámetros contables no generan asientos ni cambian el redondeo fiscal. PYME no aplica exoneración automática. Estado pendiente explícito mientras no exista emisión XML/firma/transmisión integrada.

## Archivos

Dominio: `packages/domain/src/company.ts`. API: `apps/api/src/modules/company-registration.ts`, `companies.ts`, `app.ts` y `services/company-logo.ts`. Interfaz: `apps/web/src/features/companies/CompanyWorkspace.tsx`, `company.css` y conexión en `app.tsx`. Pruebas nuevas y ajustes explícitos de fixtures de superadministrador en las suites relacionadas.

## Migraciones aplicadas solo localmente

- `20261124183531_company_administration.sql`: configuración y versión empresarial, responsables, actividad principal, operaciones idempotentes, preparación de secuencias y autorización exclusiva.
- `20261124185414_company_identity_guards.sql`: protección de identificaciones normalizadas y cierre de escrituras directas sin versión. Duplicados históricos sin cambios se conservan; nuevos duplicados se rechazan.

No se ejecutaron estas migraciones en Supabase alojado. La asignación del propietario como operador realizada anteriormente por solicitud expresa es distinta de estas migraciones; la exclusividad nueva aún no está activa en Render.

## Verificación

- 70 pruebas aprobadas en 11 archivos relacionados: dominio, logos, empresas, permisos, MFA, aislamiento, credenciales y seguridad de facturación. Incluyen cinco altas concurrentes, reintento, versión obsoleta, vías alternativas de escritura, más de 30 actividades históricas, conservación del contador 7 y rechazo de archivos y territorios inválidos.
- 10 pruebas Playwright aprobadas en computadora y móvil: alta y reapertura, seis pestañas, parámetros, actualización visible de consecutivos, usuario convencional, primera empresa e inactivas y fallo de carga completa.
- 9 verificaciones pgTAP de aislamiento y seguridad aprobadas.
- `npm run build` incluye TypeScript y compilación de cliente, servidor y worker: aprobado. Formato y `git diff --check`: aprobados.

Una revisión independiente encontró cinco problemas importantes y dos menores. Se corrigieron los cinco importantes con regresiones: carga parcial que podía omitir actividades, vía antigua sin versión, límite retroactivo de actividades, alta inicial sin empresa y solicitud de otra conexión desde una transacción. La carga simultánea se probó con cinco altas; además se eliminó la adquisición anidada de conexiones. Las validaciones estructurales del logo y los consecutivos visibles tras guardar también quedaron corregidos y probados. Se corrigió un error del helper de navegador antes de comprobar los fallos funcionales contra el bundle anterior y verificar la versión final.

## Decisiones y dependencias

- Se trabajó en la rama aislada del checkout limpio existente para reutilizar los servicios locales. El selector incorpora controles de administración empresarial; menú general, panel principal e inicio de sesión se conservan.
- La consulta oficial reutiliza https://api.hacienda.go.cr/fe/ae; devuelve actividades asociadas a la identificación para revisión. La búsqueda general de actividades por descripción requiere un catálogo oficial verificable. Los códigos y condiciones declarados manualmente siguen pendientes de verificación, incluida la información histórica.
- Producción no acepta credenciales desde esta pantalla hasta ampliar y probar su custodia; la bóveda actual admite pruebas. Los territorios usan el catálogo oficial ya aportado. No se hicieron consultas con identificaciones personales durante las pruebas automatizadas.
- Las capacidades alojadas, las credenciales de producción y las respuestas reales de Hacienda quedaron fuera de la revisión local por requerir despliegue o acceso externo. La emisión electrónica real continúa pendiente. No se declara producción lista.


## Publicación autorizada — 24/11/2026

- Solicitud expresa: «apliquemos esos faltantes para verlo en línea»; reemplaza la restricción anterior de no publicar automáticamente para esta entrega.
- PR integrado: https://github.com/arroyovargass-cyber/Conta-facil/pull/2. Commit de aplicación: `138f82c586d5ad7b97de4942680548513ea9f3de`.
- Supabase Pruebas `ryobvhcarlpayqzaumdf`: migraciones `company_administration` y `company_identity_guards`, registradas por el servicio como `20261124193644` y `20261124193652`. No volver a aplicarlas por tener otra marca de tiempo local.
- Verificación alojada: se conserva 1 empresa y 1 operador; nuevas tablas creadas con RLS; lectura anónima denegada; UPDATE directo de authenticated a tenants denegado; trigger de identificación y función de propietario presentes. No se crearon empresas de prueba ni se enviaron invitaciones durante esta publicación.
- Render, mismo servicio gratuito: `dep-dc2uep8n74is73dqgu7g`, estado `live`, finalizado el 24/11/2026 a las 13:39:45 de Costa Rica. Despliegue automático permanece apagado.
- Verificación externa: `/api/health` HTTP200, raíz HTTP200, `/api/company-administration` sin sesión HTTP401. JS `index-zsQOCpiV.js` y CSS `index-BYZiROaJ.css` coinciden por SHA-256 con el build local verificado; el JS incluye Nueva empresa y Superadministrador del sistema. No hubo errores de servidor registrados en la ventana consultada tras el arranque.
- URL: https://conta-facil-pruebas.onrender.com. Acceso: iniciar sesión con MFA, Mi empresa → Nueva empresa. No se ingresó en la cuenta del propietario ni se afirmó haber probado su sesión privada en el entorno alojado.
- Continúan pendientes el catálogo general verificable de actividades, custodia de producción y emisión real de Hacienda; esta publicación habilita preparación y administración empresarial.
