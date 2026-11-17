# Publicación de Conta Fácil Pruebas: estado comprobado

Fecha: 2026-11-16. Solicitud vigente: publicar un entorno gratuito para que el
usuario entre y pruebe las funciones existentes. No habilitar funciones fiscales
pendientes ni planes de pago. No modificar ContaNova.

## Lo ejecutado

- Verificación de conexiones de GitHub, Railway y Supabase.
- Base independiente `ryobvhcarlpayqzaumdf` confirmada ACTIVE_HEALTHY, vacía de
  usuarios/empresas antes de las operaciones.
- Ocho migraciones del código validado aplicadas al proyecto de pruebas; doce
  migraciones totales, 29 tablas con RLS y 23 códigos de permisos.
- Asesor de seguridad Supabase: cero avisos. Sin SELECT de anon/authenticated
  sobre versiones cifradas de credenciales.
- Quince comprobaciones alojadas aprobadas en `supabase/tests/hosted_preflight.sql`.
  Fixtures y extensión pgTAP revirtieron; consulta posterior confirma cero usuarios,
  empresas y perfiles temporales, y pgTAP no persistido.
- Corregida conexión TLS del bootstrap: ahora reutiliza `databaseOptions` como
  la aplicación, valida certificado y evita que sslmode en la URL sustituya esa
  configuración. Prueba RED (SSL ausente) → GREEN antes de cualquier red/correo.
- Suite local tras la corrección: 139/139 pruebas en 31 archivos, 9/9 pgTAP y
  build de frontend/servidor/worker aprobados.
- Correo del administrador confirmado por el usuario. Payload de empresa
  ficticia preparado únicamente en `.local/deployment/bootstrap-company.json`,
  ignorado por Git, con permisos 0600. No se publica el correo en código ni se
  envía invitación antes de disponer del destino HTTPS correcto.

## Bloqueos comprobados

| Servicio | Resultado | Acción necesaria |
| --- | --- | --- |
| Railway | Creación rechazada: `Your trial has expired. Please select a plan to continue using Railway.` | No se activó ningún plan ni se creó proyecto. No asumir que autoriza cobros. |
| GitHub | Leer main funciona; crear rama `pruebas` devuelve 403 `Resource not accessible by integration`. | Reconectar con permisos efectivos de escritura para este repositorio. |
| Render | Integración encontrada disponible, pero no instalada/conectada en esta sesión. | Instalar y conectar Render para operar el servicio Free ya preparado. |
| Runtime | Rol backend continúa NOLOGIN; faltan variables protegidas y proveedor Auth/correo. | Provisionar por canal seguro al disponer del hosting; no pegar secretos en chat. |
| Acceso del usuario | No hay URL pública ni usuario creado o invitación enviada. | Verificar despliegue, redirecciones, correo e invitación/MFA antes de anunciar acceso. |

## Pasos de conexión del usuario

1. En ChatGPT/Codex, abrir Configuración → Apps → GitHub. Desconectar la conexión
   actual y volver a conectarla con la cuenta propietaria del repositorio.
2. Autorizar `arroyovargass-cyber/Conta-facil`; aceptar solicitudes adicionales o
   pendientes si aparecen. Revisar https://github.com/settings/installations .
   No hace falta cambiar otra vez la visibilidad pública. Si la integración solo
   permite lectura, la reconexión no debe anunciarse como escritura verificada.
3. En Apps, instalar y conectar Render. Mantener el servicio en Free.
4. Verificar nuevamente permisos y estado de las conexiones antes de reintentar
   publicación. No se imprime ni solicita ningún token por el chat.

## Trabajo pendiente al conectar

Publicar el código auditado en GitHub sin sobreescribir cambios remotos; crear el
servicio Free; configurar variables únicamente en servidor y conexión del rol
restringido con TLS; verificar dominio HTTPS y health. Configurar Site URL y
redirecciones de invitación/reset con el dominio real; verificar correo y enviar
la invitación del primer administrador. Completar contraseña, identificación y
MFA, y comprobar acceso y aislamiento con empresas ficticias.

La publicación permitirá probar pantallas y procesos internos. Con el inspector
de desarrollo actual, las llaves reales siguen bloqueadas; STAG continúa apagado
por defecto. XML, firma fiscal, transmisión y recepción siguen pendientes. No se
promete disponibilidad continua de un servicio gratuito suspendible.

## Correspondencia de migraciones aplicada

| Archivo local | Versión alojada |
| --- | --- |
| `20261114041305_phase2a.sql` | `20261116160507` |
| `20261114042453_phase2a_department_permissions.sql` | `20261116160512` |
| `20261114151438_phase2a_archived_headers.sql` | `20261116160515` |
| `20261116033650_hacienda_custody_workflow.sql` | `20261116160520` |
| `20261116034223_harden_hacienda_workflow_references.sql` | `20261116160524` |
| `20261116040247_workflow_assignment_lookup.sql` | `20261116160528` |
| `20261116040700_workflow_minimal_source_access.sql` | `20261116160532` |
| `20261116043612_revoke_inactive_workflow_scope.sql` | `20261116160537` |

El nombre de cada migración enlaza el archivo fuente con el historial remoto;
los timestamps los generó el servicio de migraciones, no el migrador local.
