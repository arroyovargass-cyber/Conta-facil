# AGENTS.md — Conta Ágil (Conta-facil)

## Alcance y objetivo

Estas instrucciones se aplican a todo el repositorio. Conta Ágil es un sistema multiempresa de facturación electrónica y futura contabilidad para Costa Rica. Priorizar correcciones pequeñas, verificables y seguras, reduciendo el consumo de créditos y tokens sin sacrificar calidad, seguridad ni cumplimiento fiscal.

## 1. Graphify primero, cuando esté disponible

- Antes de investigar o modificar código, leer estas instrucciones y consultar Graphify para identificar el repositorio, la vigencia del índice y su cobertura.
- Comparar el commit indexado con el HEAD de la rama de trabajo en GitHub. Verificar que el índice incluya los archivos y símbolos relevantes; un estado "ready" por sí solo no demuestra cobertura.
- Con un índice útil, realizar una consulta focalizada sobre las funciones, dependencias, llamadores, pruebas e impacto del cambio. Preferir resultados compactos y ampliar únicamente cuando haga falta.
- Si Graphify no está conectado, su índice está desactualizado para el alcance solicitado, carece de código relevante o devuelve resultados sin fundamento, utilizar GitHub o el árbol de trabajo directamente. No repetir consultas fallidas ni inventar dependencias.
- Confirmar siempre los contratos y líneas críticas en el código vigente antes de editar. Graphify es una ayuda de navegación, no sustituye el código fuente ni las pruebas.
- No reindexar mediante commits artificiales, eliminar repositorios, cambiar planes ni contratar servicios sin autorización.
- Registrar decisiones técnicas duraderas en la memoria de Graphify solo si está disponible, resulta útil y su uso está autorizado; nunca guardar secretos ni datos de clientes. Si no está disponible, reutilizar la documentación existente.

## 2. Flujo obligatorio de trabajo

1. Identificar el objetivo, los criterios de aceptación y el estado real del código. Leer instrucciones más específicas del directorio si existen.
2. Distinguir errores de configuración, permisos, datos, interfaz, lógica de negocio e infraestructura. Usar GitHub, Supabase o Render únicamente cuando sean pertinentes.
3. Localizar los archivos, símbolos y pruebas afectados. Reutilizar implementaciones existentes; evitar exploraciones completas repetidas.
4. Proponer o implementar el cambio mínimo coherente con el alcance autorizado. Si basta una configuración, no crear código nuevo.
5. Ejecutar pruebas focalizadas y las regresiones necesarias, incluyendo seguridad, multiempresa y fiscalidad cuando corresponda.
6. Informar qué cambió, qué se verificó, qué queda pendiente y cualquier bloqueo. No declarar éxito sin evidencia.

## 3. Presupuesto de contexto y créditos

- Mantener las consultas, prompts y diffs breves y específicos. No releer archivos completos si bastan símbolos, rangos o cambios recientes.
- Reutilizar resultados previos únicamente cuando su versión y alcance sigan siendo válidos.
- No reconstruir módulos, duplicar permisos, tablas o servicios, realizar refactorizaciones ajenas a la tarea ni instalar dependencias sin necesidad demostrada.
- No generar informes extensos ni repetir documentación existente salvo solicitud o necesidad técnica.
- Dividir tareas amplias por dependencias y criterios de aceptación; detener la ampliación de alcance no autorizada.
- No prometer porcentajes de ahorro: medir consumo real cuando existan métricas comparables.

## 4. Mapa del repositorio

- `apps/web/`: interfaz React y TypeScript.
- `apps/api/`: servidor Fastify, autenticación, servicios y flujos fiscales.
- `packages/domain/`: validaciones y lógica compartida de negocio.
- `supabase/migrations/`: migraciones SQL versionadas.
- `tests/`: pruebas unitarias, integradas y de navegador.
- `docs/`: especificaciones, evidencia y guías operativas.
- `render.yaml`: configuración de alojamiento. Verificar también el estado efectivo de Render antes de cualquier operación de publicación.

Consultar solo las áreas necesarias y comprobar que este mapa sigue vigente.

## 5. Seguridad y datos

- Preservar RLS, MFA, permisos efectivos, aislamiento por empresa y departamento, auditoría e integridad de documentos.
- No ampliar privilegios, eliminar validaciones o introducir bypass para resolver errores de autorización. Reproducirlos con el rol restringido real del servidor.
- No solicitar ni registrar contraseñas, PIN, tokens, llaves privadas, secretos de servicio ni datos personales innecesarios. No incluirlos en prompts, commits, logs o memoria.
- Utilizar datos sintéticos para pruebas. No ejecutar pruebas de escritura sobre bases remotas ni consultar datos sensibles cuando basten metadatos.
- No editar migraciones históricas aplicadas. Proponer migraciones aditivas, revisables y con plan de verificación cuando sean necesarias.
- No desplegar, activar servicios, modificar datos remotos, aplicar migraciones remotas, cambiar permisos o realizar acciones fiscales reales sin autorización expresa y específica.
- Antes de un commit autorizado, verificar si el cambio puede desencadenar CI, despliegues o automatizaciones. Si el riesgo no puede determinarse, detener la escritura y comunicarlo.

## 6. Facturación electrónica de Costa Rica

- Priorizar el cierre del flujo nacional 4.4 antes de ampliar comprobantes o módulos contables.
- Verificar la normativa y documentación oficial vigente de Hacienda y BCCR cuando corresponda: XSD, anexos, catálogos CABYS, actividades, unidades, impuestos y reglas de cálculo.
- Distinguir requisitos oficiales, decisiones internas y condiciones pendientes de verificar. No inventar equivalencias de códigos ni asignar automáticamente IVA del 13%.
- Reutilizar la preparación fiscal, `emissionReadiness`, numeración transaccional y pipeline existentes. Mostrar bloqueos concretos sin desactivar controles.
- Conservar pruebas y producción independientes, sus credenciales, numeraciones y evidencias. No reiniciar consecutivos históricos ni modificar comprobantes emitidos.
- Verificar coherencia de importes entre interfaz, base de datos, XML y PDF. Un envío HTTP exitoso o una prueba sintética no demuestra aceptación fiscal.
- No emitir facturas ficticias en producción. No reenviar automáticamente operaciones de resultado incierto; consultar primero su estado según el flujo existente.

## 7. Pruebas y entrega

- Seleccionar pruebas según el impacto: Vitest, integración, SQL/RLS, Playwright, validación XML y verificación de tipos o build si procede. Consultar los scripts vigentes en `package.json`.
- Probar caminos autorizados y denegados, aislamiento, concurrencia e idempotencia cuando el cambio los afecte.
- Usar regresiones amplias si el impacto es transversal; el ahorro de créditos no justifica omitir pruebas necesarias.
- Entregar un resumen breve: hallazgo, archivos afectados, corrección, pruebas con resultados reales, riesgos y pendientes. Identificar el commit o versión revisada, estado de Graphify y si fue necesario usar GitHub como respaldo.
- Distinguir explícitamente lo implementado, lo probado, lo desplegado y lo validado oficialmente. No afirmar que se realizaron acciones no ejecutadas.

## 8. Plataforma global y propietario

- Toda funcionalidad general, corrección o módulo se desarrolla para la plataforma completa. Las empresas existentes y futuras reciben el mismo código según sus permisos y configuración; no condicionar funciones a una empresa o cuenta codificada en el frontend.
- Separar funciones generales, configuración empresarial, datos fiscales/contables y autorizaciones individuales. Los catálogos públicos verificables se comparten; clientes, credenciales, certificados, documentos y consecutivos permanecen aislados.
- El propietario tiene el rol de plataforma `SUPER_ADMIN_GLOBAL`, persistido en el registro privado de operadores y vinculado a su identificador autenticado. Su autorización no requiere membresías ni roles empresariales y no puede ser modificada por administradores de empresa o usuarios secundarios.
- No aceptar el rol global desde formularios, parámetros del cliente ni `user_metadata`. No concederlo a otros usuarios. Mantener MFA, validación de sesión y revocación, RLS, auditoría, documentos definitivos inmutables y comprobaciones tributarias también para el propietario.
- El alta de empresa debe inicializar atómicamente la estructura general disponible con datos propios e idempotencia. Nunca copiar secretos, movimientos, impuestos supuestos o numeraciones de otra empresa. Los requisitos fiscales que necesitan confirmación real permanecen pendientes y visibles.
- Probar cada cambio transversal en una empresa existente y otra nueva, con propietario global sin membresía, administrador secundario y usuario limitado. Verificar operaciones de botones, aislamiento, configuración independiente y persistencia tras cierre/reingreso; no basta su apariencia.
- Los módulos contables, estados financieros, recepción automática y otros perfiles fiscales pendientes deben identificarse como tales. Un permiso global no convierte un módulo ausente en una función operativa.

Las herramientas, reglas de seguridad y autorizaciones efectivas del entorno prevalecen sobre este documento. Si un agente no lee AGENTS.md automáticamente, incluir una referencia explícita en su prompt de trabajo.
