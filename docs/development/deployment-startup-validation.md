# Validación de arranque del entorno de pruebas

El despliegue de Render compilaba correctamente, pero fallaba antes de abrir el
puerto por SUPABASE_SERVICE_KEY ausente. La validación anterior de Zod mostraba
ese campo y dejaba oculta la ausencia de DATABASE_URL hasta el siguiente intento.

Se conserva la configuración existente y se agrega una comprobación al iniciar
producción: reportar juntas las variables obligatorias ausentes o en blanco.
APP_ORIGIN puede proceder de RENDER_EXTERNAL_URL, como antes. El diagnóstico
incluye exclusivamente nombres conocidos, nunca valores de configuración.
No habilita arranque sin secretos ni cambia permisos, TLS o integración fiscal.

Prueba de regresión: configuración incompleta con clave sintética ya presente y
otra clave en blanco. Debe listar todas las ausencias, omitir la clave presente
y no revelar su valor. Se observó fallo antes del cambio y aprobación después.

El build pasó. La primera suite completa, sin servicios locales ni permiso de
red, tuvo 20 archivos fallidos (10 pruebas fallidas, 84 omitidas y un error EPERM).
Se reiniciaron servicios locales y se repitió con acceso de red para verificar
el código en su entorno requerido. Resultado final: 31 archivos y 140 pruebas
aprobados en 41,74 segundos; build y comprobación de formato aprobados.

Publicación pendiente: GitHub rechaza escritura con 403; Render utiliza el ZIP
previamente publicado con checksum fijado. Este cambio no se aplica al servicio
hasta publicar una nueva versión de fuentes y actualizar ese checksum.
