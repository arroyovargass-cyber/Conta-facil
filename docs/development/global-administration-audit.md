# Auditoría global de Conta Ágil

Fecha: 27 de noviembre de 2026. Base: `db177b1`.
Rama: `fix/global-platform-administration`.

## Diagnóstico y corrección

Supabase confirma un único operador de plataforma: la cuenta propietaria
previamente identificada. Su perfil está activo. Sin embargo, `has_access`,
`member_access`, catálogos, Hacienda, el trabajador y los listados/edición de
empresas todavía exigían membresía empresarial. Tener el registro de operador
no garantizaba acceso a una empresa sin esa membresía.

Se reutiliza `private.platform_operators` con `role_code=SUPER_ADMIN_GLOBAL`.
El registro persiste en PostgreSQL; la sesión lo consulta por el usuario
autenticado. No se agregan operadores, tablas de roles paralelas ni identificadores
de cuentas en el frontend. El propietario con sesión válida y MFA recibe los
permisos registrados para todas las empresas activas y sus departamentos. La
administración central también permite revisar y reactivar empresas inactivas.

Las consultas y los helpers compartidos ejecutan la autorización; el indicador
de interfaz se obtiene de la sesión. El backend y RLS vuelven a verificar cada
operación. Los usuarios ordinarios conservan empresa, departamento, roles y MFA.
`user_metadata` no concede autoridad. El trabajador comprueba el actor efectivo
y la vigencia del rol global, manteniendo la recuperación de envíos inciertos.

Se protege el registro privado con RLS, lectura exclusiva del backend y sin
INSERT/UPDATE/DELETE/TRUNCATE para roles de aplicación. Sus cambios privilegiados
quedan auditados. Las facturas emitidas siguen inmutables. Los requisitos fiscales,
certificados, numeración, respuestas auténticas y ambiente no dependen de la
categoría administrativa del usuario.

## Alta íntegra y alcance por módulo

| Área                                        | Resultado de esta intervención                                                                                                     | Límite o configuración particular                                                                                              |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Empresas y domicilio fiscal                 | Listado, apertura y guardado global sin membresía; versión, actor y fecha conservados                                              | Datos reales de cada emisor                                                                                                    |
| Rol del propietario                         | Registro persistente `SUPER_ADMIN_GLOBAL`, visible desde sesión y protegido de usuarios secundarios                                | Sesión válida y MFA obligatorias                                                                                               |
| Alta de empresa                             | Transacción e idempotencia existentes reutilizadas; fallo de estructura revierte el alta completa                                  | Identificación y configuración validadas                                                                                       |
| Estructura inicial                          | Sucursal `001`, terminal `00001`, departamentos Facturación/CxC/CxP propios                                                        | Códigos editables; numeración de emisión sin confirmar                                                                         |
| Configuración inicial                       | Roles comunes existentes, parámetros contables preparatorios, dos ambientes tributarios y de Hacienda vacíos; rutas deshabilitadas | No copia secretos, clientes, movimientos ni consecutivos ajenos                                                                |
| Empresas inicialmente inactivas             | Se crean solo metadatos vacíos y rutas deshabilitadas; versión inicial 1                                                           | Hacienda, credenciales y operaciones fiscales permanecen bloqueadas hasta reactivación                                         |
| Clientes, productos, venta rápida           | Mismos componentes y endpoints, autorización global desde los helpers comunes                                                      | Datos comerciales y fiscales propios por empresa                                                                               |
| FE/TE 4.4, CABYS, impuestos y exoneraciones | Código fiscal general existente conservado; propietario sin dependencia de roles empresariales                                     | No cambia reglas, XSD, cálculo, firma o integridad; esta auditoría no emite comprobantes reales                                |
| Cuentas por cobrar/pagar                    | Acceso global a bandejas y configuración disponible                                                                                | Asignar un responsable nominal conserva la relación empresarial existente, distinta de la autorización global para administrar |
| Proveedores y recepción automática          | Funciones operativas completas todavía ausentes                                                                                    | No se presentan como implementadas por disponer de permisos o una bandeja                                                      |
| Contabilidad y estados financieros          | Se mantienen parámetros de preparación existentes                                                                                  | No existe todavía un motor contable ni estados financieros operativos                                                          |
| Actualizaciones futuras                     | Regla permanente añadida a AGENTS.md; permisos nuevos registrados alcanzan al propietario en empresas existentes y nuevas          | Cada módulo requiere implementación, migración de permisos y sus propias pruebas                                               |

Se conserva la membresía auxiliar que el flujo anterior asigna al creador para
compatibilidad; la autoridad global no la necesita. No se agregan membresías a
todas las empresas ni se concede autoridad global a administradores secundarios.
Las funciones centrales de altas, accesos y credenciales conservan el control
exclusivo del propietario establecido en los requisitos anteriores.

## Archivos y migraciones

- `apps/api/src/modules/companies.ts`: selector con autorización global y RLS.
- `apps/api/src/modules/company-registration.ts`: administración sin filtro de
  membresía; inicialización transaccional propia de cada empresa.
- `apps/api/src/modules/identity.ts`: rol de plataforma desde PostgreSQL.
- `packages/domain/src/company.ts`: valores organizativos iniciales solo para altas.
- `apps/web/src/app.tsx` y `features/companies/CompanyWorkspace.tsx`: rol visible
  y valores iniciales mediante componentes existentes.
- `apps/web/src/styles.css`: desplazamiento vertical del menú fijo, para poder
  cerrar sesión y alcanzar todos sus controles en pantallas cortas.
- `AGENTS.md`: protocolo global, autoridad del propietario, aislamiento y pruebas.
- Pruebas de integración y navegador: acceso global, revocación, aislamiento,
  inicialización, botones y selección inequívoca de las empresas sintéticas.

Migraciones aditivas, aplicadas únicamente al PostgreSQL local:

1. `20261127061829_global_platform_administration.sql`: etiqueta y protección del
   registro existente, auditoría y helpers de autorización global.
2. `20261127063905_inactive_company_initialization.sql`: INSERT acotado a Hacienda
   vacía o rutas deshabilitadas, para completar empresas inicialmente inactivas.
3. `20261127161159_optimize_global_company_selection.sql`: comprobaciones de
   propietario y MFA una vez por sentencia, manteniendo RLS y el aislamiento ordinario.

No se editan migraciones históricas publicadas. Para publicar, aplicar las tres antes
del código, que consulta la nueva columna de rol. No aplicar una reversión
destructiva ni eliminar operadores para volver al código previo.

## Evidencia de verificación

- Referencia inicial: 19 pruebas existentes aprobadas.
- Reproducción: acceso global, rollback y autorización del trabajador fallaron
  antes de la corrección. El alta inactiva reprodujo HTTP 403 antes de la segunda
  migración.
- Pruebas focalizadas finales de autoridad e inicialización: **13 aprobadas**,
  con el login real `conta_facil_api`, sin superusuario/BYPASSRLS ni USAGE en `auth`.
- Regresión general final: **607 pruebas aprobadas en 82 archivos**, después de
  las tres migraciones, la optimización del selector y la corrección del menú.
- SQL/RLS: **16 comprobaciones aprobadas**. Se separó el actor ordinario del
  propietario global; se mantienen aislamiento, escritura autorizada, rechazo
  cruzado, reasignación, auditoría, MFA y revocación, y se añade el acceso global
  sin membresías y el bloqueo de conceder el rol desde la aplicación.
- Navegador: **92 escenarios aprobados**, 46 en computadora y 46 en Android
  simulado, con servidor restringido y las cuatro banderas de prueba/emisión de
  Hacienda apagadas. Se verificaron creación, edición, guardado, cambio de
  empresa, facturación, permisos y cierre/reingreso con MFA.
- Prueba focalizada de navegador: cuatro escenarios aprobados entre computadora
  y Android simulado, incluyendo creación/guardado reales, cierre/reingreso y
  propietario sin membresía. La corrección del menú fue necesaria para alcanzar
  el botón de cerrar sesión; no se forzó el clic fuera de pantalla.
- Build/TypeScript aprobados.
- Revisión independiente estática: encontró el caso de alta inactiva; revisó la
  corrección sin hallar problemas adicionales. No sustituye las pruebas ejecutadas.

Comandos y registros locales de la versión final:

| Verificación                   | Comando                                                                           | Registro local                             |
| ------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------ |
| Regresión general              | `npm test`                                                                        | `.local/global-admin-release-suite.log`    |
| SQL/RLS                        | `npm run test:db`                                                                 | `.local/global-admin-sql-final.log`        |
| Computadora y Android simulado | `CHROMIUM_PATH=<navegador-local> node --import tsx infra/test-company-browser.ts` | `.local/global-admin-browser-verified.log` |
| Compilación y tipos            | `npm run build`                                                                   | `.local/global-admin-final-build.log`      |

Los registros y las credenciales sintéticas locales se excluyen de Git. Las
pruebas se ejecutan con servicios locales, no contra la base de datos alojada.

Supabase alojado se inspeccionó en modo de solo lectura. Los 16 conjuntos de
tablas empresariales comprobados mantienen RLS. El rol del servidor no es
superusuario, no omite RLS y no tiene USAGE en `auth`. `anon`, `authenticated` y
el rol de aplicación no pueden modificar el registro de operadores. El código
fuente tampoco contiene los identificadores reales de las empresas o del
propietario en la interfaz.

Graphify indexaba exactamente `db177b1`. Ayudó a localizar dependencias; sus
definiciones SQL históricas se contrastaron con las funciones efectivas de
Supabase y el árbol de trabajo. No se realizaron commits artificiales ni reindexados.

El navegador detectó lentitud en el listado global con miles de empresas
sintéticas. EXPLAIN ANALYZE midió 4570,893 ms para 3850 filas y, tras calcular
autorización una vez por sentencia, 8,158 ms para 3883 filas en el mismo entorno.
La medición corresponde a la consulta, no al tiempo total de cargar la pantalla.
No se guardan decisiones entre sentencias o usuarios; MFA y revocación se
comprueban nuevamente. La revisión estática también verificó esta equivalencia.
Una prueba nueva espera el POST real y comprueba su identificador guardado,
evitando dar un botón por correcto a partir de una notificación anterior.

## Pendientes y riesgos comprobados

- Falta aplicar las tres migraciones y publicar esta nueva corrección con la
  autorización específica exigida por AGENTS.md. En esta intervención no se
  modificaron Supabase alojado ni Render.
  Render conserva el despliegue automático desactivado y la rama publicada `main`;
  la rama de revisión no publica cambios por sí sola.
- Comprobar la cuenta propietaria en el entorno publicado después de la entrega.
  No se crearon empresas ficticias ni se emitieron comprobantes en producción.
- La recepción automática, proveedores completos, contabilidad y estados
  financieros continúan pendientes; no se desarrollan dentro de esta auditoría.
- El asesor de seguridad de Supabase conserva el aviso de detección de
  contraseñas filtradas deshabilitada. Revisar su
  [configuración oficial](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
  Es una configuración previa, no una vulnerabilidad introducida por este cambio.
