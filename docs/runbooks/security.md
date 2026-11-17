# Seguridad de Fase 1

## Controles implementados

Autenticación delegada a Supabase Auth; directorio de identificación privado. Sesión opaca en cookie HttpOnly/SameSite, Secure al ejecutar con NODE_ENV=production. Tokens cifrados AES-256-GCM en base; la clave de 32 bytes permanece en variable de servidor. Caducidad absoluta de 8 horas e inactividad de 30 minutos. Revocación de membresía consultada por RLS en cada operación; cierre de sesión revoca las sesiones de aplicación del usuario y solicita revocación global a Auth.

Origin exacto y CSRF en mutaciones autenticadas; límite de intentos por identificación e IP en PostgreSQL, verificación de TOTP por proveedor y AAL2 en backend/RLS para administradores. Los endpoints públicos de recuperación y aceptación siguen comprobando Origin, límites y credenciales del proveedor.

Operaciones ordinarias establecen rol authenticated y claims de un JWT previamente verificado con Auth. Funciones SECURITY DEFINER restringidas al esquema privado, con search_path fijo y EXECUTE explícito. Tablas expuestas con RLS; las relaciones compuestas impiden vínculos entre empresas. Las mutaciones de roles/membresías usan transacciones privilegiadas aisladas con autorización revalidada y bloqueo por empresa. No hay privilegios de escritura directa a esas tablas para usuarios.

Auditoría de campos afectados sin valores, junto a la mutación. Eventos de acceso separados sin secretos. Los usuarios no pueden modificar auditoría. No es protección contra un administrador de base: antes de producción se requiere exportación protegida, retención validada y monitoreo.

## Operación pendiente antes de producción

HTTPS y proxy de confianza explícito; los límites usan la IP de conexión y no confían en X-Forwarded-For. Un proxy no configurado agrupará clientes en un mismo límite; revisar ese comportamiento antes del despliegue. No aceptar cabeceras de IP arbitrarias.

Migrar el acceso de administración de BD a un rol de backend con privilegios mínimos y separar credenciales de migración. El entorno local usa postgres para transacciones internas y SET LOCAL ROLE para consultas ordinarias; no distribuir esa credencial como configuración de producción.

SMTP real y dominios de redirección verificados, gestor externo de secretos, rotación, alertas, políticas de respaldos/retención y pruebas de navegador. La CSP no está activada en el servidor API porque no sirve HTML; debe establecerse al alojar el frontend. Deshabilitar caché de rutas autenticadas en el proxy. No guardar archivos XML ni certificados: funcionalidad diferida.

Limpieza de registros temporales se ejecutará de forma programada y acotada: rate_limits vencidos, sesiones vencidas y payloads de invitación no necesarios, preservando auditoría y obligaciones normativas. La aplicación actual no elimina esos datos automáticamente.

## Recuperación de MFA y rotación

No hay bypass ordinario de MFA. Recuperación por email de cuentas con factor verificado responde que requiere soporte verificado. El procedimiento requiere comprobar identidad y autorización fuera de esta aplicación, registrar responsable y evidencia, revocar sesiones de aplicación y Auth, y restablecer factores usando herramientas administrativas del proveedor. No introducir un endpoint público que borre factores.

Para rotar SESSION_KEY en esta fase, programar cierre de todas las sesiones, revocarlas y sustituir la clave en el gestor del servidor. Los usuarios vuelven a autenticarse. No permite una rotación transparente de sesiones; las futuras credenciales tributarias necesitan un esquema de claves versionadas separado.
