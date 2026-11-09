# Evidencia de Fase 1

Fecha: 2026-11-09. Estado: avance funcional local; revisión independiente completada y cinco hallazgos importantes corregidos. No producción.

## Resultados finales observados

- `npm run build`: TypeScript y Vite completados (2062 módulos, JavaScript ~267 KB sin gzip).
- La API devuelve Cache-Control: no-store, verificado por prueba.
- [Decisiones y revisión](decisions-and-review.md): cinco Important corregidos, cinco menores diferidos y límites de la revisión.
- `npm test`: 27/27 pruebas aprobadas en nueve archivos, tras las correcciones de revisión. Incluye bootstrap mediante el correo real, recuperación, límites de identificación normalizada entre instancias, conservación del formulario de permisos y revocación simultánea.
- `npm run test:db`: 9/9 aserciones pgTAP aprobadas: aislamiento, inserción/actualización cruzada, cambio de tenant, auditoría inmutable, MFA, revocación y anónimo.
- Migraciones aplicadas en base nueva `conta_clean_verify` con Auth vacío; 9/9 pgTAP.
- Respaldo/restore en base separada; conteos de empresas y auditoría coincidentes.
- Integración con Auth real: login, TOTP, recuperación, invitaciones con email coincidente, vencimiento y repetición.
- PostgREST real con JWT de operativo: solo departamentos autorizados; después de revocar membresía no devuelve documentos.

## Límites explícitos

Sin prueba visual/teclado en navegador: falta cua_repl.js y la ruta de preview requerida por Sites. No se publicó un frontend aislado ni se crearon proyectos externos. Docker Compose completo no pudo arrancar por espacio/red; componentes oficiales ejecutados localmente y PostgreSQL Debian con pgTAP fueron la alternativa comprobada.

No se validaron XML/XSD/firma, cálculos tributarios ni comunicación con Hacienda. No existen módulos fiscales operativos ni contabilidad. Actividades y configuración se guardan como borrador, sin certificación de catálogo oficial. Roles personalizados limitados a consulta; administración y cambios estructurales requieren el rol administrativo y MFA. Datos de prueba son sintéticos y los conteos de interfaz no representan actividad fiscal.

Pendientes de operación productiva: proyecto/hosting/SMTP, secretos, roles DB mínimos, retención validada, exportación externa de auditoría, limpieza programada de temporales y QA de navegador. Los centros de costos y departamentos ya existen; no hay reparto de comprobantes porque aún no se implementaron documentos.
