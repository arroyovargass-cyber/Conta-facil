# Hacienda y bandejas departamentales: evidencia del incremento

Fecha: 2026-11-16. Rama `feat/fase-1`, conservada sin merge, push o despliegue.
Base del incremento: `501c6af`. Base anterior funcional: `d72251b`.

## Resultado funcional local

- Sección Hacienda con identificación de empresa, referencias de actividades,
  sucursales y terminales sujetas a sus permisos, requisitos fiscales pendientes,
  credenciales de pruebas, metadatos y desactivación local con confirmación.
- Cifrado AES-256-GCM con contexto autenticado por empresa/ambiente/versión/tipo,
  raíces independientes y versión de clave. Payloads API y PKCS12 separados.
- Validación local aislada de PKCS12, MAC/PIN, RSA 2048/4096, correspondencia y
  vigencia del certificado. La identidad tributaria sigue pendiente.
- Adaptador de autenticación STAG y cierre de sesión separados, con destinos
  HTTPS oficiales fijos, respuestas acotadas y controles de revisión/autorización.
  Permanece deshabilitado por defecto. No hubo prueba real contra Hacienda.
- Configuración explícita de departamentos y responsables, sin conceder membresías.
  Asignación idempotente desde borrador guardado y limpio a tarea CxC, preservando
  el origen. Destino accede a resumen mínimo, sin líneas, importes ni documentos.
- Revisiones internas versionadas; cambios de origen requieren revisar otra vez.
  Los cambios de ruta afectan tareas futuras. CxP presenta recepción pendiente.
- Nuevas vistas adaptables y campos secretos no controlados por estado React,
  limpiados tras éxito/error/cambio de empresa; respuestas tardías descartadas.

## Puertas que permanecen cerradas

**No listo para producción.** El inspector preparado es el snapshot oficial
**OpenSSL 3.5.10-dev** del commit `84dda7853c130429210b37bee9e5b62366ca8bce`, no
una distribución estable validada para admitir material real. Con ese binario,
la carga está bloqueada fuera de `NODE_ENV=test`; los recorridos automatizados
usan solo certificados sintéticos. No eludir el bloqueo cambiando el ambiente
del servicio. Falta confirmar versión/parches e instalación objetivo.

`HACIENDA_STAG_PROBE_ENABLED=false` sigue siendo predeterminado. La guía oficial
IdP identifica los destinos usados; discovery devolvió 403 en la investigación,
por lo que disponibilidad operativa y prueba real STAG continúan pendientes.
Los dobles de transporte y las respuestas de pruebas no demuestran integración
real ni aceptación de comprobantes.

No se habilitan XML tributario, XSD validado, firma XAdES, transmisión,
consulta de aceptación final, mensajes del receptor, recepción de XML/correo,
XML/PDF fiscales, saldos, cobros/pagos o contabilidad. Continúan los impedimentos
previos de actualización del XSD, política de redondeo y datos fiscales.
Desactivar credenciales aquí no las revoca ante Hacienda.

## Pruebas y alcance

Resultados finales después de las correcciones:

- `npm test`: **138/138** en 30 archivos.
- `npm run test:db`: **9/9** comprobaciones pgTAP.
- `npm run test:browser`: **36/36**, escritorio y móvil.
- `npm run build` (incluido en la suite web): TypeScript, frontend, servidor y
  worker compilados correctamente; inspector requerido presente.
- `git diff --check` y revisión de formato de los archivos corregidos: correctos.

Ejecución contra servicios locales y empresas/usuarios/certificados sintéticos.

- Cifrado: contexto/byte manipulado, IV aleatorio, raíces separadas de sesiones,
  rotación y restauración desde ciphertext serializado con keyring separado.
- PKCS12 reales sintéticos: legado y actual, PIN con Unicode/espacios, PIN erróneo,
  falta de clave, EC incompatible, ausencia de MAC, expirado/futuro y certificados
  coincidentes duplicados. Límites de archivo y admisión dos workers + cuatro cola.
- Worker con CLI controlado en cwd desechable: múltiples claves, certificado
  no coincidente, salida mayor de 8 MiB y proceso detenido al superar el tiempo.
  El binario de la aplicación nunca se sustituye. Esos casos de salida controlada
  verifican defensas del worker; no se presentan como PFX maliciosos end-to-end.
- Registro/API: permisos/MFA/empresa, Base64 canónico, request máximo 3 MiB,
  ausencia de keyring, sustitución concurrente, fallo conserva versión anterior,
  historial inmutable, respuestas/auditoría sin secretos y rate limits.
- IdP: servidor local controlado; formato form-urlencoded, logout, invalid_grant,
  bloqueos, redirección, JSON inválido, cuerpo excesivo y timeout. Reemplazo,
  desactivación y revocación de sesión durante consulta descartan el resultado.
- Workflow: destinos/responsables/versiones, referencias cruzadas, idempotencia,
  resumen sin origen, lectura/gestión departamental y acceso directo RLS.
- Browser: escritorio/móvil, secretos limpios, producción inactiva, STAG apagado,
  identificación/requisitos visibles, borrador limpio, CxC, origen actualizado,
  CxP vacío y respuesta tardía después de cambiar empresa.

## Revisión independiente y correcciones

Revisión de código de `501c6af..ea4d2bf`, sin mutar datos/archivos. Encontró dos
hallazgos importantes y ninguno crítico. Ambos se reprodujeron antes del arreglo:

1. Departamento destino inactivo aún permitía lectura/actualización: API devolvía
   200/200 y SQL autenticado devolvía una tarea. Ahora el alcance departamental se
   retira en backend y RLS; la consulta histórica permanece para permisos explícitos
   de toda la empresa. Prueba RED→GREEN en `document-workflow.test.ts`.
2. Edición del origen y asignación/revisión podían bloquearse en sentido inverso:
   se reprodujo `40P01` y HTTP 500 en ambos recorridos. La serialización usa
   `FOR NO KEY UPDATE` sobre empresa, compatible con el KEY SHARE de auditoría.
   Ahora la edición concluye y la versión obsoleta recibe 409. Dos pruebas
   deterministas RED→GREEN en `workflow-locking.test.ts`.

Se realiza una sola pasada de corrección y verificación; no se solicitó una
segunda revisión como sustituto de pruebas.

Menor diferido: la etiqueta «Versión revisada vigente» se muestra cuando el origen
no cambió, incluso si la tarea sigue pendiente. El estado «Pendiente» permanece
visible; conviene renombrar esa etiqueta para describir solo que no hubo cambios.

## Decisiones y costes

- Snapshot oficial fijado en Git ante ausencia del release estable 3.5.10:
  coste de mantenimiento/procedencia; validación de producción sigue bloqueada.
- Snapshot permitido solo en pruebas sintéticas automatizadas: la carga manual
  con ese binario permanece deshabilitada en desarrollo normal y producción.
- Proyecciones privadas autorizadas en vez de grant SELECT de borradores al
  backend de bandejas: funciones adicionales a mantener, acceso mínimo preservado.
- Idempotencia por bloqueo de empresa + consulta de ID autorizado, sin ON CONFLICT
  que exigía lectura RLS del destino al origen: escritores SQL confiables ajenos
  al contrato API podrían recibir conflicto único y necesitar su propia gestión.
- Conexión exige lectura de Hacienda además de su permiso específico porque
  devuelve metadatos públicos: los roles personalizados deben seleccionar ambos.
- La regresión inicial de revocación de roles bloqueaba su propio FK de auditoría;
  se reemplazó por revocación concurrente de sesión. Las mutaciones administrativas
  siguen serializadas; esa prueba no pretende simular una eliminación simultánea
  de rol. Las nuevas regresiones reproducen por separado la inversión real de locks.

## Operación y artefactos

Ver [runbook de bóveda y recuperación](../runbooks/hacienda-vault.md). No se usaron
llaves ni contraseñas del usuario. El ZIP se genera con `git archive` de archivos
versionados, excluyendo `.env`, `.local`, binarios, node_modules y secretos.
El hash del ZIP se entrega en un manifiesto adyacente; no puede incluirse a sí
mismo sin cambiarlo. Las capturas muestran información sintética y formularios
limpios. No se alteraron Supabase remoto, ContaNova, infraestructura ni GitHub.

## Hashes de migraciones locales del incremento

- `20261116033650_hacienda_custody_workflow.sql`: `bf6b81792e32007b1cd39dc186984fd76e80b7dce17bdda1ec48d1f4ed3a2a7e`
- `20261116034223_harden_hacienda_workflow_references.sql`: `cf2380efb923bee538c8f1361d1bb7f887847ff0afc4bf7eb397e224060725bc`
- `20261116040247_workflow_assignment_lookup.sql`: `4bfc3c8386906de2073391aac38a4cec043bffcc0910b53c968363fc1c22ae0e`
- `20261116040700_workflow_minimal_source_access.sql`: `e7f3c4c078936deebd804a8a66e69acad24e619ebed65aeea87b520b97fa6831`
- `20261116043612_revoke_inactive_workflow_scope.sql`: `ee5bcd82cbfe7f016e2503c106a9c66aba7b005e7603a0a023df8150dc1e5ee9`
