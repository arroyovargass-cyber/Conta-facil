# Evidencia de preparación Render + Supabase

Fecha: 2026-11-09. Estado: código listo para provisión; servicio online aún no creado.

- `npm test`: 38/38 pruebas, 12 archivos. Las suites de emisión de invitaciones, recuperación y operaciones multiempresa usan una conexión real del rol limitado `conta_facil_api` en PostgreSQL local.
- `npm run test:db`: 9/9 pgTAP.
- `npm run build`: TypeScript, frontend Vite y backend ESM compilados correctamente.
- `render.yaml` validado con el JSON Schema oficial https://render.com/schema/render.yaml.json usando Draft 2020-12. Se corrigieron los tipos YAML de `off` y valores numéricos de ambiente antes de validar.
- Revisión independiente enfocada en despliegue: sin hallazgos Critical/Important; hosting/config 10 pruebas verificadas por el revisor. Se añadió una prueba adicional del rol limitado en la batería global.
- Menor diferido: el test aislado runtime-role utiliza sesión administrativa y SET ROLE; por sí solo no prueba el login del rol. Las cuatro suites integradas sí conectan con usuario/contraseña reales de `conta_facil_api`, lo que cubre el cambio de rol en operaciones reales.

Decisiones: servir archivos estáticos y API juntos para conservar cookies/origen; exigir TLS validado y configuración HTTPS; Render genera clave aleatoria de sesión; usar rol dedicado sin DDL con consultas ordinarias bajo RLS. Mantener nombres/proyecto de ContaNova sin cambios.

Bloqueos externos al preparar esta evidencia: Render aún sin conexión confirmada; elección de organización Supabase pendiente. La única organización encontrada es Free y contiene ContaNova inactivo. No se debe crear proyecto sin la elección requerida por el proveedor. El plan aprobado no autoriza cobros ni upgrades.

Pendiente de comprobar con infraestructura real: disponibilidad Node/runtime y aceptación del Blueprint por Render, conexión/certificado del pooler Supabase, proxy/IP de Render, SMTP y MFA sobre HTTPS, QA visual y aislamiento en la base alojada. No declarar esas verificaciones aprobadas por pasar las pruebas locales.
