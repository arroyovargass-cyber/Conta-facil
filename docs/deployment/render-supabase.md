# Conta Fácil Pruebas · Render Free + Supabase Free

## Estado y alcance

Preparación de código aprobada por el usuario. El archivo `render.yaml` declara solo un servicio web Free, sin base de datos ni disco en Render. La publicación requiere conexión de la cuenta Render y un proyecto Supabase nuevo de la organización elegida por el usuario. El proyecto existente ContaNova no se modifica.

El repositorio debe ser privado. No publicar `.env`, `.local`, usuarios ni respaldos sintéticos, tokens, certificados o contraseñas. Render no ofrece una shell de administración en todos sus planes gratuitos: migraciones y bootstrap se ejecutan por un canal administrativo seguro, no al arrancar cada instancia.

## Construcción y arranque

Build: `npm ci --include=dev && npm run build && npm prune --omit=dev`.

Start: `npm start` ejecuta `dist-server/server.mjs`; sirve la API y la carpeta `dist/assets` junto con `/`, `/invite` y `/reset`. Rutas desconocidas y API desconocida mantienen 404. Solo se publica la salida del frontend; los archivos de código/configuración no se sirven.

Health: `/api/health` comprueba PostgreSQL. Un build verde no demuestra despliegue verde: comprobar el estado del servicio y una petición al dominio efectivo.

`APP_ORIGIN` se obtiene automáticamente de `RENDER_EXTERNAL_URL` si no se configura. Si se añade dominio propio, definir el origen HTTPS exacto y actualizar las redirecciones de Auth. Cookies Secure, HttpOnly y SameSite; la API exige Origin y CSRF. Se confía solo en el último salto del proxy Render; no copiar esa configuración a un servidor públicamente accesible sin proxy.

## Configuración segura

- `DATABASE_URL`: conexión del rol `conta_facil_api`, no del administrador de migraciones. Obtener el hostname de Session pooler en Supabase Connect, puerto 5432, usuario `conta_facil_api.PROJECT_REF`. Es alternativa IPv4 al endpoint directo. No inventar el hostname del pooler.
- `DATABASE_CA_CERT`: opcional si el certificado del proveedor necesita la CA descargada desde su panel. Se verifica el certificado; no usar `rejectUnauthorized:false` ni `sslmode=no-verify`.
- `SUPABASE_URL`: API HTTPS del proyecto de pruebas.
- `SUPABASE_ANON_KEY`: publishable key o clave anon compatible con el proveedor; permanece en servidor en esta arquitectura.
- `SUPABASE_SERVICE_KEY`: secret/service_role solo en servidor para operaciones administrativas de Auth. Obtenerla y guardarla directamente en Environment de Render, nunca en chat o GitHub.
- `SESSION_KEY`: Render genera 256 bits en base64; la aplicación también acepta 64 caracteres hexadecimales. Se normaliza a 32 bytes para AES-256-GCM. Mantenerla entre deploys; cambiarla invalida sesiones existentes.

## Base de datos

Aplicar las tres migraciones versionadas únicamente en el proyecto nuevo de pruebas, con historial de migración Supabase y revisión de asesores. No usar `infra/migrate.mjs` contra alojamiento: es local-only.

La migración `runtime_api_role` crea un rol NOLOGIN y NOINHERIT sin DDL. Se habilita LOGIN y una contraseña aleatoria solo mediante un canal protegido de provisión; esa contraseña no pertenece a las migraciones ni a Git. El rol puede seleccionar/actualizar las tablas internas necesarias para la API, pero no alterar esquema, administrar roles ni modificar/borrar auditoría. Puede hacer SET ROLE authenticated con INHERIT FALSE: las consultas ordinarias siguen ejecutando RLS de usuario. No conceder a authenticated pertenencia inversa al rol de servidor.

Para habilitar la contraseña, usar un comando parametrizado seguro o un script administrativo por stdin que construya el literal correctamente. No pegar una contraseña en el historial del SQL Editor o en esta conversación. Las credenciales de migración no se guardan en Render.

## Auth y correo

En Supabase, Site URL y redirecciones permitidas deben coincidir con el dominio efectivo de Render: `/invite` y `/reset`, conservando los parámetros de invitación. Activar verificación de correo y TOTP y mantener registro público deshabilitado.

Configurar SMTP personalizado para invitar usuarios fuera del equipo del proyecto. El servicio predeterminado de Supabase tiene restricciones de destinatarios. El correo lo envía Supabase; el backend Render llama a su API HTTPS, por lo que no necesita SMTP saliente desde Render Free. Mailpit local no se despliega públicamente.

El primer administrador se crea con `apps/api/scripts/bootstrap.ts` mediante un canal con permisos de migración/alta y configuración HTTPS del proyecto nuevo. No copiar el administrador local, ni publicar contraseñas predeterminadas. La aceptación de correo y MFA completan el alta.

## Criterio de publicación comprobada

1. Servicio Render realmente en plan Free, proyecto Supabase de pruebas en plan Free.
2. Migraciones y asesores verificados en proyecto correcto; ContaNova sin modificaciones.
3. Health devuelve 200 y la página sirve desde el mismo dominio.
4. Invitación, contraseña, MFA, selector y permisos funcionan con dos empresas ficticias.
5. Secretos ausentes del bundle/frontend/logs; acceso cruzado denegado.
6. Probar navegador de escritorio y Android. Informar latencia de arranque tras suspensión.

No se emiten comprobantes ni se conecta a Hacienda en esta fase. Las cuotas gratuitas y la suspensión por inactividad no equivalen a disponibilidad productiva.

## Fuentes revisadas

- https://render.com/docs/blueprint-spec
- https://render.com/docs/free
- https://supabase.com/docs/guides/database/connecting-to-postgres
- https://supabase.com/docs/guides/auth/auth-smtp
