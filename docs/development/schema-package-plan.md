# Siguiente incremento: integridad del paquete oficial 4.4

Alcance: herramienta local de desarrollo, sin cambios de permisos, base de datos,
credenciales ni interfaz. Contrastar el paquete fijado antes de desarrollar el
validador XML. Se reutilizan TypeScript, Zod y SHA256 de Node; sin dependencias nuevas.

1. Pruebas de regresión: alteración de bytes, dependencia ausente o alterada,
   ruta insegura y revisión no confirmada impiden aprobar el paquete.
2. Auditor sin acceso de red: contrasta bytes y hashes del manifiesto y requiere
   revisión explícita. Verificar un paquete no equivale a validar XML ni firmar.
3. CLI con directorio fijo, sin seguir enlaces simbólicos ni resolver imports
   desde schemaLocation. Informe JSON reproducible y salida no cero al bloquear.
4. Reconsulta de fuentes oficiales, actualización de evidencia y ejecución de
   suite/build. No alterar bytes de Hacienda ni activar emisión.

La descarga oficial del 23/11/2026 conserva hash y tamaño registrados; la
ubicación de dependencia intentada devuelve 404. Persiste la discrepancia
anexo/XSD documentada. La herramienta no elimina ese bloqueo normativo.

## Resultado verificado

- Se observó fallo inicial por módulo ausente y después seis casos aprobados.
- CLI ejecutada contra paquete real: salida JSON con tres bloqueos y código 1,
  sin interpretar ese resultado como validación de XML ni aceptación de Hacienda.
- Build de frontend/servidor/worker aprobado y typecheck aprobado, incluido CLI.
- Primer intento de suite con servicios detenidos: 18 archivos fallidos,
  8 pruebas fallidas, 59 aprobadas y 79 omitidas. Errores de conexión Auth/DB.
- Tras iniciar servicios locales: 32 archivos y 146 pruebas aprobados (40,05 s).
- La primera invocación mediante tsx CLI encontró IPC EPERM del sandbox; el
  comando definitivo usa node --import tsx y se verificó correctamente.
- La comprobación aislada de tipos requirió --ignoreConfig y --types node por
  el contrato de TypeScript 7; no se instalaron dependencias para resolverlo.

No se cambió Render, Supabase alojado ni la configuración de certificados.
La entrega está en código local y no se afirma publicada en la aplicación.
Siguiente paso bloqueado: localizar/confirmar paquete oficial vigente completo,
resolver dependencia de firma y adoptar motor XSD1.1; luego generador y firma.
