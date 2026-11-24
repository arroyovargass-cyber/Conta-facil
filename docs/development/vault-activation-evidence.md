# Activación de captura de llaves de pruebas — 24/11/2026

Solicitud: habilitar en el servicio publicado la configuración de credenciales y llave criptográfica. No habilita firma fiscal ni envío, y no cambia NODE_ENV del servidor a test.

## Inspector

Perfil `pkcs12-official-security-20261124`, revisión oficial `906f55c2199f543702480c0499fb889df4fecb03`. La versión sigue siendo 3.5.10-dev; no se presenta como versión estable. Se verificó https://openssl-library.org/source/ (estable 3.5.9) y los doce parches de https://openssl-library.org/news/vulnerabilities-3.5/index.html. La compilación comprueba que todos son ancestros del pin y parte de directorios limpios; se probó la eliminación de archivos residuales de compilación e instalación.

La atestación local al artefacto incluye revisión, perfil, versión y SHA-256 del binario. Solo se admite el perfil exacto, comprobado antes de ejecutar. No se presupone resistencia a un artefacto o filesystem de despliegue ya comprometido. Las consultas de versión y el proceso de PKCS12 no heredan secretos del servidor. Se conservan límites de archivo, salida, tiempo, concurrencia, PIN, MAC, vigencia, clave RSA y correspondencia certificado/clave. Solo sale metadato público; el cifrado y los permisos multiempresa existentes no cambian.

## Verificación

- 47 pruebas relacionadas aprobadas en 8 archivos: política, integridad, PKCS12, límites del worker, bóveda, permisos, conexión controlada y almacenamiento bajo la configuración de producción con HTTPS y material sintético.
- Dos pruebas de navegador aprobadas, computadora y móvil: guardar certificado sintético, rechazar PIN incorrecto, limpiar campos y almacenamiento del navegador, desactivar localmente.
- Compilación de producción y TypeScript aprobados.
- Revisión independiente encontró reutilización de artefactos y consulta de versión antes de comprobar integridad/con entorno heredado: corregidos. Tres pruebas de regresión fallaron al retirar las protecciones y pasaron al restaurarlas.
- No se usan llaves, PIN ni credenciales personales en pruebas; no se probó la identidad tributaria de ninguna empresa.

## Operación

Se comprobó en Supabase Pruebas que existen cero versiones cifradas antes de provisionar raíz. Debe verificarse nuevamente justo antes del cambio. Nunca sustituir a ciegas un keyring que proteja versiones activas o históricas. Generar raíz independiente de SESSION_KEY, conservar respaldo privado con permisos0600 fuera de Git y mezclar únicamente HACIENDA_KEYRING y HACIENDA_ACTIVE_KEY_ID en el servicio Render existente. La raíz no se imprime en el chat, código, registros ni respuestas públicas. La recuperación requiere conservar esa raíz; no regenerarla una vez guardadas credenciales.

No hay migración de base de datos. HACIENDA_STAG_PROBE_ENABLED permanece desactivado. La captura habilitada no significa aceptación de Hacienda ni emisión disponible.
