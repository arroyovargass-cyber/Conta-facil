# ContaNova · revisión histórica de enlace descartado

**Decisión vigente (2026-11-14): propuesta descartada por el usuario. No aplicar estas migraciones en ContaNova. Continuar en proyecto separado de Conta Fácil; usar ContaNova solo como referencia de estructura.**

Proyecto: `ramtbawbjqxtzcdzfiek`, nombre ContaNova, organización Free. Fecha: 2026-11-09.

## Estado comprobado

El usuario eligió reutilizar ContaNova. Supabase aceptó su reactivación y el proyecto pasó de INACTIVE a ACTIVE_HEALTHY. Se inspeccionaron tablas, funciones, disparadores, roles e historial antes de intentar cambios.

Tablas anteriores: empresas, usuarios, usuario_empresa, cuentas, saldos_iniciales, asientos y asiento_detalle. Las siete tienen RLS y no contienen registros. Auth no contiene usuarios. No hay funciones ni disparadores personalizados en public/private/auth, ni esquema private ni rol conta_facil_api. El asesor de seguridad no reportó avisos. Existe únicamente la migración anterior core_contable_inicial (20260918214135).

## Cambios concretos pendientes de autorización

1. `supabase/migrations/20261109165510_phase1.sql`: añade tablas propias de empresas/usuarios/permisos/organización/configuración y auditoría de Conta Fácil; esquema privado para sesiones/directorio/invitaciones; funciones, políticas RLS y disparadores exclusivos de esas tablas. El catálogo de permisos contiene datos técnicos iniciales. No elimina ni renombra las siete tablas anteriores, ni crea asientos contables.
2. `supabase/migrations/20261109171447_harden_phase1.sql`: refuerza MFA y acceso al selector en las tablas recién añadidas. Sustituye dos políticas que crea la primera migración y añade comprobaciones restrictivas; no sustituye políticas de las tablas españolas anteriores.
3. `supabase/migrations/20261109175102_runtime_api_role.sql`: crea rol interno `conta_facil_api` inicialmente NOLOGIN/NOINHERIT, sin superusuario, creación de bases ni administración de roles. Concede acceso acotado a las tablas nuevas y capacidad de SET ROLE authenticated para las consultas ordinarias. No contiene contraseña ni habilita conexión hasta la provisión posterior.

No hay colisiones de nombres detectadas. Las tablas de organización de Conta Fácil son distintas de las tablas contables anteriores, que se conservan; antes de habilitar contabilidad futura se deberá definir una migración de convergencia para evitar duplicar datos de empresas.

## Validación y límites

Los SQL son los mismos comprobados localmente con 38 pruebas de aplicación y 9 pruebas pgTAP. Eso no certifica su ejecución en Supabase alojado. Tras autorización y aplicación se comprobarán tablas, políticas, historial y asesores remotos, conservando las tablas anteriores.

Las migraciones son cambios persistentes de esquema y permisos sobre un proyecto existente. Un error de autorización podría afectar el acceso a las tablas nuevas y los roles compartidos, aunque no se prevé modificar registros anteriores. Este alcance necesita autorización explícita después de esta revisión.

SHA256 de los archivos revisados:

```
867b752c14c8439273ba4bfb72ac926d35a97d7e0d604f93b1febf73a64de068  20261109165510_phase1.sql
fa5c2f28c2aef42c2297d15e73534a575781708071b7fa8e4b9bacd5710f6152  20261109171447_harden_phase1.sql
012e8f1f7b7385c475f0f4b30e538419376362b53b4bf0a27f2453d0a04fd2b6  20261109175102_runtime_api_role.sql
```

## Bloqueo actual

La revisión automática rechazó aplicar la primera migración porque la autorización para enlazar/revisar ContaNova no aprobaba explícitamente la migración persistente y sus cambios de autorización sobre el servicio existente. No se intentó ejecutarla por otro canal. Se verificó después que siguen solo las siete tablas anteriores y la migración original: ninguna de las tres migraciones de Conta Fácil fue aplicada.

Pendientes independientes: conexión Render y repositorio GitHub privado (la sesión actual no puede crearlo). Reactivar el proyecto y seleccionar su URL no equivale a tener Conta Fácil publicada o totalmente conectada.
