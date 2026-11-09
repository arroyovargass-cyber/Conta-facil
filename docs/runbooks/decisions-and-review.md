# Decisiones, revisión y pendientes

## Decisiones del implementador

1. Repositorio aislado en `/workspace/conta-facil`, rama `feat/fase-1`, porque `/workspace/.git` era un marcador protegido sin repositorio. Costo si la decisión no corresponde al flujo posterior: incorporar el repositorio a un remoto o workspace existente requerirá importación explícita.
2. Ledger manual porque las guías cloud no exponen sus scripts como ejecutables locales. Costo: el progreso se registra manualmente, no por los helpers de la guía.
3. Primera alternativa al agotamiento de disco: Compose con PostgreSQL Alpine y servicios oficiales reducidos. También excedió espacio por VFS; no se declara comprobada esa topología.
4. Alternativa finalmente comprobada: PostgreSQL Debian 17.11 y pgTAP extraídos localmente, y binarios oficiales GoTrue/PostgREST/Mailpit en loopback. No se alteró Docker ni se instalaron paquetes de sistema. Costo: el launcher restringido y el Compose portable son caminos distintos; Compose completo requiere su propia validación.
5. Se omitió QA de navegador porque faltan cua_repl.js y la ruta de preview soportada exigida por Sites. Costo: presentación, teclado, foco y comportamiento móvil no se verificaron en navegador, aunque compilan y existen pruebas de componentes/alcance.
6. Invitaciones a una membresía existente, incluso inactiva, se rechazan con 409; la administración de esa membresía se hace en su pantalla, sin mezclar alcance anterior con nuevos roles. Es la alternativa explícita solicitada por revisión. Costo: no se usa una nueva invitación para reactivar miembros.
7. Roles personalizados de esta entrega conceden consulta; los privilegios administrativos se mantienen en el rol administrativo con MFA. Costo: permisos personalizados de modificación requieren extensión revisada antes de habilitarse.

## Revisión independiente

Un revisor independiente examinó código, diseño y plan; no encontró un bypass Critical confirmado de MFA o RLS. Identificó cinco problemas Important; todos corregidos en un pase con pruebas que reprodujeron el fallo:

- Correo de invitación apuntaba a `/verify`: rutas INVITE/CONFIRMATION corregidas, prueba de bootstrap por correo real y aceptación completa.
- Continuaciones/modales de empresa anterior: captura de versión/empresa, descarte de recargas obsoletas y limpieza de formularios. Pruebas CompanyScope.
- Edición de membresías seleccionaba rol inicial y borraba departamentos: respuesta incluye IDs, formulario conserva valores; prueba de render y API.
- Límite por identificación usaba datos antes de normalizar: contador por país/tipo/valor normalizado compartido entre instancias; prueba de formatos equivalentes.
- Invitación aceptada sobre membresía anterior mezclaba permisos: rechazo explícito y bloqueo por empresa; prueba de conflicto y alcance preservado.

También se añadió `Cache-Control: no-store` en API, con prueba que falló antes del cambio.

## Menores diferidos de la revisión

- Consultar sesión rota CSRF compartido; otra pestaña puede necesitar recargar antes de mutar.
- Si la sesión ya expiró, logout puede devolver 401 y la pantalla actual requiere recargar para volver al acceso.
- La prueba concurrente usa el mismo actor para dos revocaciones; verifica bloqueo y último administrador, pero no exactamente dos actores distintos revocándose entre sí.
- Los filtros visuales buscan entre filas cargadas; la búsqueda completa en servidor queda pendiente.
- Bootstrap con email existente o fallo SMTP deja empresa/invitación pendientes y aún no hay comando de reenvío/recuperación. Revisar resultado antes de repetir; no asumir rollback externo de Auth/correo.

El revisor no juzgó QA visual, Docker Compose completo, seguridad productiva ni normativa tributaria. No hubo segunda revisión: se comprobaron las correcciones con pruebas y la batería completa.
