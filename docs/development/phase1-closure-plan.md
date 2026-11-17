# Cierre funcional de Fase 1

Autorización: el usuario pidió continuar desarrollando. Se ejecutan pendientes del diseño/plan de Fase 1 ya aprobado; no se inicia Fase 2 ni se cambia la arquitectura.

- [x] Sesiones: CSRF estable entre pestañas sin guardar tokens en claro; logout idempotente cuando la sesión caduca y limpieza de la interfaz ante 401 protegido. Pruebas Auth/HTTP y transporte frontend antes de implementar.
- [x] Listados: búsqueda literal y filtros de estado en servidor, paginación coherente y permisos RLS conservados. Descartar respuestas tardías entre vistas/filtros y actualizar actividades tras guardar. Pruebas con más de una página, comodines y empresas ajenas.
- [x] Navegador: Playwright con Chromium instalado, Auth/PostgreSQL locales reales y usuarios ficticios. Recorrer login/MFA/empresa/organización, varias pestañas, caducidad y vista móvil. Guardar capturas sin contraseñas ni secretos.
- [x] Revisión independiente de los cambios, suite completa, build y evidencia. Mantener pendiente la publicación hasta resolver permisos GitHub y conexión Render.

No se usan datos reales ni se modifican migraciones remotas para estos cambios. No se declaran completadas comprobaciones que no puedan ejecutarse.
