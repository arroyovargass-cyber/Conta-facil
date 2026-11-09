# Despliegue aprobado: Render Free + Supabase Free

Estado: preparación autorizada. No confundir preparación con publicación verificada.

1. Servir dist/ y API en el mismo proceso Fastify; conservar 404 JSON de API y excluir archivos privados. Tests HTTP para inicio, callbacks, archivos y rutas inválidas.
2. Configuración de producción explícita: APP_ORIGIN HTTPS, cookies Secure, PostgreSQL con TLS validado, timeouts y máximo pequeño de conexiones. Build reproducible y npm start, Render Blueprint Free sin base de datos Render ni servicios pagados.
3. Rol de conexión dedicado para API, sin DDL ni superusuario; acceso ordinario bajo SET LOCAL ROLE authenticated y RLS. Pruebas locales con ese rol para permisos y aislamiento.
4. Crear repositorio privado de Conta Fácil bajo GitHub conectado y publicarlo allí, preservando secretos locales. Actualización autorizada por el usuario: reutilizar el proyecto Supabase ContaNova (ramtbawbjqxtzcdzfiek) de la organización Free. Reactivar e inspeccionar su esquema antes de aplicar cambios; preservar sus datos y evitar colisiones con tablas, políticas y funciones existentes.
5. Migraciones y revisión de seguridad en proyecto de pruebas. Secretos únicamente en configuración segura de Render; correo y redirecciones de Supabase usando URL efectiva del servicio. No copiar datos ni usuarios locales.
6. Deploy gratuito, verificar URL, salud, sesión y recorrido de invitación/MFA. Si falta conexión externa o secretos, dejar preparación verificable y precisar bloqueo sin declarar despliegue completo.

Decisiones: sin nuevo diseño de producto; implementa el despliegue que el usuario aprobó. Render se conecta mediante su integración encontrada, sin pedir tokens en chat. No se aprueban cobros ni upgrades implícitos.
