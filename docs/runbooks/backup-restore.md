# Respaldo y restauración

Solo se verificaron datos sintéticos locales. La retención tributaria debe validarse antes de almacenar comprobantes.

1. Crear un respaldo cifrado y con acceso restringido mediante el servicio gestionado; para pruebas locales usar `pg_dump -Fc`. El dump contiene datos de identidad, hashes de Auth y tokens de sesión cifrados: tratarlo como secreto, no como código.
2. Crear una base aislada de restauración; nunca restaurar sobre la operativa para comprobar un respaldo.
3. Restaurar con `pg_restore --exit-on-error`. Revisar roles/grants si el destino es otro clúster; mantener funciones de Auth y RLS. Restaurar también archivos privados y claves mediante sus mecanismos propios cuando existan, fuera de Git.
4. Comparar conteos y registros de control, aplicar pruebas de permisos con datos sintéticos y verificar que los servicios apuntan a la base correcta.
5. En recuperación real revocar todas las sesiones restauradas y tokens de invitación antes de habilitar tráfico. Un respaldo puede reintroducir membresías antiguas: reconciliar revocaciones posteriores desde auditoría externa protegida.

Evidencia de esta sesión: dump completo local restaurado en `conta_restore_verify`; conteos de empresas y auditoría coincidentes. Las migraciones también se aplicaron desde cero en `conta_clean_verify` y pasaron las nueve aserciones pgTAP. Esto no demuestra disponibilidad, RPO/RTO ni recuperación de una instalación productiva.
