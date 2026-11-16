# Conta Fácil Pruebas · provisión Supabase verificada

Fecha: 2026-11-14. Proyecto independiente creado en la organización inicial elegida por el usuario.

- Nombre: Conta Fácil Pruebas.
- Ref: `ryobvhcarlpayqzaumdf`.
- Organización: `oiacegvmouqhbmphuurp`, plan Free.
- Cotización recibida antes de crear: US$0, recurrencia mensual.
- Región: us-east-1.
- API: https://ryobvhcarlpayqzaumdf.supabase.co
- Panel: https://supabase.com/dashboard/project/ryobvhcarlpayqzaumdf
- Estado comprobado al crear: ACTIVE_HEALTHY.

## Esquema instalado

Se comprobó inicialmente que public/private no tenían tablas ni historial de migración. Se aplicaron:

| Archivo fuente | Migración alojada | Versión remota |
| --- | --- | --- |
| 20261109165510_phase1.sql | phase1 | 20261114023721 |
| 20261109171447_harden_phase1.sql | harden_phase1 | 20261114023734 |
| 20261109175102_runtime_api_role.sql | runtime_api_role | 20261114023740 |
| 20261114024053_hosted_access_hardening.sql | hosted_access_hardening | 20261114024320 |

Quedaron 15 tablas públicas y 6 privadas, todas con RLS. Hay 9 entradas técnicas en permission_catalog; no se cargaron empresas, usuarios, contraseñas ni datos comerciales locales. El rol backend permanece NOLOGIN, NOINHERIT, sin superusuario, creación de bases o administración de roles; su contraseña se provisionará por canal seguro cuando se configure Render.

## Refuerzo motivado por la verificación alojada

La primera inspección detectó seis tablas privadas sin RLS. Se comprobó mediante privilegios efectivos que anon no tenía USAGE/SELECT y authenticated no tenía SELECT en ellas: el aviso genérico de exposición no demostraba acceso a esos datos. Aun así, se agregó defensa en profundidad con políticas exclusivas del backend, preservando sus permisos y los helpers SECURITY DEFINER.

También se encontraron grants predeterminados de Supabase sobre las tablas públicas que difieren del PostgreSQL local. La cuarta migración revoca los grants implícitos a anon/authenticated solo en tablas de Conta Fácil y concede únicamente los previstos. No modifica otras aplicaciones ni el esquema de ContaNova.

La nueva prueba falló antes del cambio y pasó después. Batería local: 39/39 pruebas de aplicación, 9/9 pgTAP y build completos. Una revisión independiente de la cuarta migración no encontró hallazgos Important/Critical.

## Pruebas remotas

Se ejecutaron nueve aserciones de aislamiento pgTAP contra el proyecto alojado. Los dos usuarios/empresas ficticios y sus sesiones se crearon dentro de una transacción que terminó en ROLLBACK; se capturaron los resultados y se exigieron exactamente nueve líneas exitosas antes de revertir. Resultado final verificado: passed=true, assertions=9, fixtures_rolled_back=true, auth_users=0, companies=0.

Cubren aislamiento de empresas/departamentos, inserción y actualización cruzadas, cambio de tenant, auditoría inmutable, exigencia de MFA, revocación de sesión y acceso anónimo.

Tras el refuerzo, list_tables confirma RLS en las 21 tablas y el asesor de seguridad devuelve lints vacíos. Esto no es una certificación de producción ni sustituye el recorrido HTTP/Auth sobre Render.

## Independencia y pendientes

ContaNova mantiene únicamente su migración previa core_contable_inicial (20260918214135); ninguna migración de Conta Fácil fue aplicada allí.

La base está provisionada; la aplicación web NO está publicada aún. Render sigue sin integración conectada y el repositorio privado arroyovargass-cyber/conta-facil no existe; la sesión GitHub previa no permite crearlo. Faltan provisión segura de credenciales de runtime, Auth/SMTP/redirecciones, deploy y QA de navegador. No se solicitaron claves por chat ni se activaron planes de pago.

## Actualización para publicar el entorno de pruebas — 2026-11-16

El usuario solicitó trabajar en la publicación del entorno, autorizando actualizar exclusivamente Conta Fácil Pruebas. Se verificaron antes estado ACTIVE_HEALTHY, cuatro migraciones iniciales, cero usuarios/empresas y ausencia de avisos de seguridad. Se aplicaron las ocho migraciones posteriores del código verificado. El historial remoto tiene ahora doce migraciones.

Resultado: 29 tablas public/private, todas con RLS, 23 códigos de permiso y ningún aviso del asesor de seguridad. anon y authenticated carecen de SELECT sobre versiones cifradas de credenciales. El rol backend conserva NOLOGIN, NOINHERIT, sin superusuario, BYPASSRLS, creación de bases ni administración de roles; falta provisionar su contraseña por un canal seguro al conectar el hosting.

La prueba `supabase/tests/hosted_preflight.sql` ejecutó quince aserciones: aislamiento entre empresas/departamentos, escritura cruzada, auditoría, MFA, revocación de sesión, acceso anónimo, metadatos de Hacienda, tareas y prohibición de escritura directa/lectura de ciphertext. Pasaron 15/15. La transacción revirtió fixtures y creación temporal de pgTAP. La comprobación posterior confirmó cero usuarios, cero empresas, cero perfiles de fixture y pgTAP no persistido. No se copiaron datos locales ni se creó todavía el usuario administrador.

La invitación del administrador queda pendiente del servicio web HTTPS, redirecciones de Auth, credenciales del runtime y correo. No se configuraron URLs ficticias ni se envió una invitación con destino localhost. ContaNova no recibió cambios.
