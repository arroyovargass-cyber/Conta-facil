# Evidencia de Fase 2A — clientes, catálogo y borradores

Fecha: 2026-11-14. Desarrollo y verificación locales. No certifica cumplimiento tributario, conexión con Hacienda ni despliegue en línea.

## Entrega funcional

- Clientes por empresa: identificación alfanumérica conservada como texto, datos de contacto, búsqueda literal, paginación, desactivación y control de versión.
- Productos/servicios: código comercial propio, CRC/USD, precio exacto, CABYS/unidad opcionales pendientes de verificación oficial. No se asigna tarifa tributaria por defecto.
- Borradores por departamento: una a cien líneas, copias históricas, importe comercial exacto antes de impuestos, edición, archivo/restauración, operación idempotente y conflictos409. No hay clave ni consecutivo tributario.
- Gestión de catálogos y borradores requiere MFA, además de los permisos y el alcance correspondientes. La gestión seleccionada en un rol personalizado incorpora su permiso de lectura; la interfaz lo explica.
- RLS limita filas y líneas incluso en consultas directas; claves compuestas rechazan referencias entre empresas. La cabecera archivada también exige restauración previa a cualquier cambio comercial directo.

## Cómo comprobarlo

1. Ejecutar los pasos de instalación local del README y aplicar `npm run db:migrate` únicamente contra localhost.
2. Entrar con una cuenta autorizada y configurar MFA. No existen credenciales predeterminadas.
3. Crear departamento, cliente y producto CRC con precio `0.2`.
4. En Borradores seleccionar cliente, departamento y producto, cantidad `0.1`. El importe antes de impuestos es `CRC 0.02`.
5. Guardar, abrir, editar observaciones y guardar nuevamente. Archivar, filtrar Archivados y restaurar.
6. Desactivar cliente/producto o cambiar la moneda actual del catálogo: el borrador existente conserva sus datos y moneda. Referencias nuevas deben estar activas y coincidir en moneda.
7. Abrir un registro desde dos pestañas y guardar versiones distintas: la segunda recibe409 y conserva el texto introducido hasta recargar explícitamente.

## Verificación

- `npm test`: 68 pruebas aprobadas, incluidas regresión de Fase1, integración real Auth/MFA y PostgreSQL. Casos: dos empresas/departamentos, consultas directas, revocación, permisos personalizados, duplicados simultáneos, versiones concurrentes, rollback, referencias históricas y cien líneas Unicode que superan32KiB de cuerpo.
- `npm run test:db`: nueve aserciones pgTAP aprobadas; las cinco nuevas pruebas específicas de RLS de facturación se ejecutan en la suite de aplicación.
- `npm run build`: TypeScript, Vite y backend compilados correctamente.
- `npm run test:browser`: 22 casos aprobados después de correcciones (11 por cada tamaño), incluidos los diez casos previos de Fase1. Chromium escritorio y Pixel7 emulado; no equivale a teléfono físico ni auditoría completa de accesibilidad.
- No se graban QR, contraseñas ni tokens en capturas. Las vistas previas muestran datos ficticios; trace/video/capturas automáticas están desactivados.

## Revisión independiente y correcciones

Un revisor independiente (`gpt-6-astra`) revisó el rango `a60a9bb..54b20eb` contra diseño y plan, sin modificar archivos ni ejecutar suites por separado. Detectó dos problemas importantes y una observación de archivo reclasificada como importante por su efecto sobre la integridad de datos:

1. La moneda actual del producto impedía guardar un borrador histórico cuya moneda seguía igual. Prueba falló con400 y pasó preservando referencias históricas; la moneda actual sigue validándose al añadir referencias nuevas o cambiar la del borrador.
2. Respuestas tardías de detalle podían sustituir un editor nuevo; controles de cambio de registro seguían activos durante guardados. Se reprodujeron seis fallos de navegador (tres casos por escritorio/móvil) contra la versión anterior. Se añadieron generaciones por editor y bloqueo durante escrituras, también ante doble envío.
3. Una actualización directa podía editar cabeceras archivadas. La prueba reprodujo un UPDATE aceptado indebidamente; el trigger ahora rechaza cambios comerciales con23514, incluida una restauración combinada con edición. Restaurar y luego editar explícitamente sí funciona.

No hubo hallazgos críticos. No se difirieron observaciones menores: la única se elevó y corrigió. La revisión fiscal, el rendimiento productivo y la publicación remota quedaron fuera de su dictamen; sus resultados de prueba son los ejecutados por el implementador y registrados aquí.

## Decisiones tomadas durante ejecución

| Decisión | Motivo y límite/coste si resulta insuficiente |
| --- | --- |
| Continuar en `feat/fase-1` existente | Conserva servicios y dependencias; no ofrece una rama separada para este incremento. No se modificó main. |
| Mantener ledger manual en vez de scripts cloud sin ruta ejecutable | Conserva trazabilidad; exige disciplina de registro manual. Este documento retiene las decisiones duraderas. |
| Generar nombres de migración con CLI | Sustituye la fecha propuesta del plan sin alterar comportamiento. |
| Añadir `invoice-options` | El resumen global no representa permisos departamentales; añade una solicitud acotada al abrir el módulo. |
| Validar actividad de referencias con lectura de transacción sin locks que exijan permisos administrativos | Permite facturar a lectores de catálogos; una desactivación concurrente posterior puede dejar un borrador comercial. Emisión futura debe revalidar todo. |
| Permitir a lectores de borradores ver departamentos autorizados sin `organization.read` | Roles personalizados de facturación funcionan sin permisos ajenos; revela nombres/metadatos de esos departamentos autorizados. |
| Incorporar lectura al seleccionar gestión de un módulo nuevo | Guardar y consultar el resultado necesitan lectura; la capacidad de consulta acompaña deliberadamente a gestión. |
| Elevar la observación de cabeceras archivadas a importante | El archivo debe conservarse en base de datos, no solo en botones; se implementó la protección. |
| Mantener fuera la validez fiscal | Ninguna función fiscal habilitada. El siguiente incremento requiere XSD y reglas oficiales verificadas. |
| Entregar localmente sin afirmar preparación remota ni rendimiento productivo | Faltan publicación HTTPS, configuración de secretos y validación de carga antes de comercializar. |
| Ejecutar suites por el implementador, sin atribuirlas al revisor | Evidencia reproducible real, pero no segunda ejecución independiente del revisor. |

La auditoría de publicación revisó107 archivos sin encontrar los valores actuales de secretos locales ni artefactos privados. `git diff --check` pasó. Las capturas finales esperaron la carga de opciones.

## Migraciones y destino

Aplicadas únicamente al PostgreSQL local de pruebas. **No se modificó ContaNova ni el Supabase remoto en este incremento.**

| Archivo | SHA256 |
| --- | --- |
| `20261114041305_phase2a.sql` | `99013b4537fa97a0caf862b81cd81be0f0ea921450347ef93bc34a0ce49fa0dd` |
| `20261114042453_phase2a_department_permissions.sql` | `2d7e6df9af4e3913be7b17c09abbe94a51facb7c9135be31587016260711a60b` |
| `20261114151438_phase2a_archived_headers.sql` | `5a913a5a961f55061122847a74b9fba8389623b4b6449593c4f8952c41c61a4d` |

Las migraciones agregan objetos; una restauración local sigue el [procedimiento de copias](../runbooks/backup-restore.md). No borrar tablas con documentos para simular rollback. La migración remota requiere comprobar el proyecto separado de pruebas y seguir el flujo revisado de despliegue.

## Lo que falta después de 2A

Recuperar XSD oficiales vigentes y completar matriz normativa; cálculos tributarios, descuentos/exoneraciones, clave y consecutivo, XML, validación XSD, firma, envío y respuesta definitiva en STAG, PDF/correo y demás comprobantes. La [investigación oficial](phase2-official-research.md) registra fuentes y bloqueos. CABYS y formatos de identificación comerciales aún no se declaran validados tributariamente.

La última publicación comprobada continúa bloqueada por403 de escritura de GitHub y ausencia de conexión Render; no se reintentó ni se publicó código durante este incremento. Ver [estado de publicación](../deployment/github-publication-status.md). La fase2 completa y producción no están terminadas.
