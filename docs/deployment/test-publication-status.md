# Publicación de Conta Fácil Pruebas: estado comprobado

Fecha de actualización: 2026-11-17 (Costa Rica). Solicitud vigente: publicar un entorno gratuito para que el
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

## Publicación en curso: Render Free

El usuario confirmó expresamente el espacio **My Workspace**. Se creó un único
servicio web Node en Virginia, plan **free**, con despliegue automático apagado.
No se creó una base Render, disco, worker ni recurso de pago.

- Servicio: `srv-dbudpelg1s2s73bi7cj0`.
- Despliegue inicial: `dep-dbudpf5g1s2s73bi7dt0`.
- Commit fuente: `7c00b3fb2e049eb48f7819ea277b40d550100214`.
- Panel: https://dashboard.render.com/web/srv-dbudpelg1s2s73bi7cj0
- URL asignada: https://conta-facil-pruebas.onrender.com
- La actualización de la publishable key generó otro despliegue en cola:
  `dep-dbudpn0lujjs738tmso0`; no se dispararon reintentos adicionales.
- Consulta de logs del proveedor respondió 503; no hay evidencia de build exitoso.
- Estado verificado al crear: `build_in_progress`. **No equivale a servicio listo**.

La carga web de GitHub dejó 100 archivos fuente coincidentes, pero faltan 63,
incluidos manifiestos de raíz, migraciones y pruebas. El ZIP completo versionado
contiene los 164 archivos auditados. Como GitHub sigue rechazando escritura con
403, el build extrae ese ZIP antes de instalar dependencias. Comprueba primero
SHA-256 `1eec161e08b7bd0dbba7fcb65055bc922fa1f7b6981f7aade20bace3c53b2931`
y rechaza rutas absolutas, recorrido de directorios y enlaces simbólicos.
Este puente no modifica GitHub; una actualización requiere cambiar deliberadamente
el archivo y su checksum o publicar el árbol completo de fuentes.

Se configuraron Node 24.22.1, producción, puerto 10000, proxy de un salto,
URL/publishable key de Supabase, SESSION_KEY aleatoria privada y STAG apagado.
No hay contraseñas ni llaves tributarias en el build, código o documentación.

## Bloqueos y trabajo pendiente

- Faltan `SUPABASE_SERVICE_KEY` y `DATABASE_URL` en el servidor. El usuario debe
  introducir la clave privada directamente en Environment del panel Render;
  no enviarla por chat. Para la base usar el rol restringido `conta_facil_api`,
  TLS validado y el hostname oficial de Session pooler, nunca un host inventado
  ni credenciales del usuario postgres. El rol continúa NOLOGIN hasta provisionar
  su contraseña de forma segura.
- Completar configuración antes de verificar el arranque; el despliegue inicial
  puede fallar por variables ausentes. No anunciar acceso basándose solo en la URL.
- Verificar estado terminal `live`, `/api/health`, página y registros del servidor.
- Configurar Site URL y redirecciones de invitación/reset con el dominio real;
  comprobar correo y enviar la invitación del primer administrador. No se envió
  invitación ni se creó usuario hasta esta actualización.
- Completar contraseña, identificación y MFA y probar aislamiento con empresas
  ficticias.
- Railway mantiene el trial vencido; no se activó ningún plan de pago.

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

## Actualización de conexión (17 de noviembre)

El usuario confirmó el hostname de Session pooler
`aws-1-us-east-1.pooler.supabase.com`. Se habilitó LOGIN para `conta_facil_api`,
sin ampliar privilegios. Se generó contraseña aleatoria y verificador SCRAM;
solo el verificador se envió a la migración alojada. La contraseña quedó en
configuración privada de Render y en archivo local ignorado con modo 0600.
Se guardó DATABASE_URL con usuario `conta_facil_api.ryobvhcarlpayqzaumdf`,
puerto Session pooler 5432 y base postgres; la aplicación exige TLS validado.
El despliegue generado es `dep-dbuefhu7bikc739neaig`.

Los builds anteriores terminaron correctamente; el intento
`dep-dbueb2psrm7s73ek27vg` falló al arrancar por SUPABASE_SERVICE_KEY ausente.
La ausencia persiste como bloqueo hasta verificar un intento posterior.
La prueba directa desde este entorno a la base devolvió ECONNREFUSED;
no se deshabilitó TLS ni se afirmó conectividad validada. Verificar desde Render.
No se enviaron invitaciones ni se crearon usuarios en esta operación.

El intento `dep-dbuefhu7bikc739neaig` terminó update_failed a las
23:51:13 UTC: build exitoso, arranque detenido por SUPABASE_SERVICE_KEY ausente.
El usuario informa que la variable aparece en el panel; falta verificar guardado
y aplicación en el servicio exacto. No se reintentó de nuevo automáticamente.
