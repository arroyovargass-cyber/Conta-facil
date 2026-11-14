# Hacienda Custody and Departmental Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar registro seguro de credenciales de pruebas, metadatos verificables, configuración de responsables y bandejas documentalesCxC/CxP sin emisión ni cartera financiera.

**Architecture:** Bóveda privada cifrada en backend, inspectorPKCS12 aislado y metadatos con autorización empresarial. Rutas/tareas documentales independientes preservan departamento de origen y permiten compartir un resumen mínimo con el destino configurado, sin abrir acceso al borrador ni a secretos.

**Tech Stack:** React/TypeScript/Fastify/PostgreSQL existentes; Node crypto, worker_threads y OpenSSL3.5LTS actualizado. Sin servicio de bóveda de pago ni dependenciasnpm nuevas para analizar claves.

**Spec:** `docs/superpowers/specs/2026-11-14-hacienda-custody-departments-design.md`, aprobado por respuesta «Si».

## Global Constraints

- SoloPruebas; Producción permanece inactiva. Cargar credenciales o conseguir un token no habilita XML/firma/transmisión.
- No saldos, vencimientos, cobros/pagos, contabilidad ni recepciónXML ficticia. CxP muestra estado vacío explícito.
- PKCS12 máximo2MiB; PIN/usuario/contraseñaAPI son valores diferentes, nunca devueltos ni registrados. Material real requiere HTTPS; desarrollo local solo sintético.
- AES256-GCM, IV aleatorio y AAD empresa/ambiente/versión/tipo; clave independiente de SESSION_KEY, keyring versionado provisto fuera de Git.
- Metadatos de Hacienda/operaciones de secretos requieren permisos propios y AAL2; pertenecer aCxC/CxP no concede acceso a llaves.
- Departamento origen inalterado; FKcompuestas por tenant; rutas y responsables explícitos, sin ampliar membresías automáticamente.
- Directo en la rama existente; revisión independiente final. Solo migraciones locales en este incremento, sin cambiar ContaNova ni publicar infraestructura.

## Review Focus

- Sustitución/probe concurrente con revocación o cambio de credenciales: no persistir resultados ni activar versiones obsoletas.
- PKCS12 legado, PIN no ASCII o con espacios/símbolos: no recortar/cambiar el secreto ni filtrar valores por argv, errores o logs.
- Desactivar responsable, membresía, rol o departamento después de configurar: marcar asignación pendiente, no seguir notificando ni exponer tareas a usuarios revocados.
- Destino sin permiso sobre origen: puede gestionar solo resumen de tarea, no líneas/documento ni secretos; cambios del origen invalidan revisión.
- Respuestas tardías al cambiar de empresa/editor y secretos del formulario tras éxito/error: no restaurar datos anteriores ni conservar credenciales en estado persistente.

---

### Task 1: Bóveda y análisisPKCS12 aislado

**Files:** crear `apps/api/src/security/{credential-vault,pkcs12-inspector,pkcs12-worker}.ts`, `tests/{credential-vault,pkcs12-inspector}.test.ts`, `tests/support/pkcs12.ts`, `infra/prepare-openssl.mjs`, `infra/local-vault-env.mjs`; modificar `config.ts`, `.env.example`, `package.json`, `render.yaml` y `infra/local-env.mjs`.

**Interfaces:** `VaultContext={tenantId:string;environment:'test';version:number;kind:'api_access'|'pkcs12'}`; `Keyring={active:string;keys:Record<string,Buffer>}`; `encryptCredential(payload:Buffer,context:VaultContext,keyring:Keyring):{keyId:string;blob:Buffer}`, `decryptCredential(envelope,context,keyring):Buffer`; `inspectPkcs12(file:Buffer,pin:string):Promise<CertificateMetadata>` retorna exclusivamente huellaSHA256, fechasISO, algoritmo y bits, `technical_status:'valid_local',identity_status:'pending'`. Nunca retornaPEM/clave/PIN.

**Decisión técnica comprobada:** el entorno tieneOpenSSL3.5.7. La [lista oficial de vulnerabilidades3.5](https://openssl-library.org/news/vulnerabilities-3.5/index.html) consultada2026-11-14 identifica correcciones hasta3.5.10. El inspector exige3.5.10 o parche posterior compatible de la rama3.5, reconfirmado al ejecutar. No presentar3.5.7 como parcheado. [PKCS12](https://docs.openssl.org/3.5/man1/openssl-pkcs12/) permite `-legacy`; [passphrase-options](https://docs.openssl.org/3.5/man1/openssl-passphrase-options/) permite `fd:number`, sin contraseña en argv/env.

- [ ] Escribir pruebasRED de cifrado: contenido oculto, IV distintos, roundtrip, cambio de tenant/versión/ambiente/tipo y byte manipulado rechazados, clave ausente/inválida rechazada, keyring con clave anterior aún puede descifrar; SESSION_KEY no sirve como sustituto.
- [ ] Escribir pruebasRED del inspector con PKCS12 sintéticos generados en ejecución: RSA2048/4096, PIN4dígitos y14caracteres/noASCII/espacios; PINincorrecto, sin clave, múltiples claves, clave/certificado distintos, expirado/futuro, algoritmo incompatible y exceso2MiB rechazados sin datos sensibles. Probar límite de tiempo/salida y concurrencia acotada.
- [ ] Ejecutar `npx vitest run tests/credential-vault.test.ts tests/pkcs12-inspector.test.ts`; observar módulos ausentes. Usar únicamente fixtures sintéticos; no llaves del usuario.
- [ ] Implementar keyring: `HACIENDA_KEYRING` JSON{id:hex32bytes}, `HACIENDA_ACTIVE_KEY_ID`; ambos opcionales como conjunto, al faltar la bóveda permanece inhabilitada. Rechazar ID activo ausente/clave duplicada de SESSION_KEY. No imprimir valores. `npm run vault:local-keys` ejecuta `infra/local-vault-env.mjs`, verifica localhost y agrega claves independientes únicamente cuando faltan ambas, preservando secretos/permisos existentes y rechazando configuración parcial sin imprimirla; producción no genera claves en memoria.
- [ ] Implementar preparación reproducible del binario actualizado bajo `.local/openssl` (ignorado), con descarga oficial/hash publicado verificado, sin cambiar OpenSSL del sistema. Comprobar versión/proveedores antes de analizar archivos. Build prepara binario/worker y falla de forma explícita si no puede cumplir el requisito; documentar compilador/herramientas requeridas. No debilitar el mínimo para lograr pruebas verdes.
- [ ] Implementar inspector en worker de corta vida con OpenSSL fijo: archivo por stdin y PIN por descriptor dedicado, nunca shell/argv/env; sin archivos planos. PKCS12 conserva verificaciónMAC; compatibilidadlegacy de contenedor sin rebajar algoritmo de firma. Límite8s, entrada2MiB, salida8MiB, dos inspecciones simultáneas y cola máxima4; exceso429. El worker selecciona una única clave y certificado coincidente, prueba firma/verificación local y entrega solo metadatos; buffers temporales se limpian en lo posible y el proceso termina. No afirmar borrado garantizado de toda memoriaJS.
- [ ] Compilar worker aparte a `dist-server/pkcs12-worker.mjs`, resolver archivoTS en desarrollo y compilado en ejecución. Ejecutar las pruebas y `npm run build`; verificar que el artefacto del worker existe y no aparece en el bundle del navegador. Commit.

### Task 2: Esquema, permisos y controles de integridad

**Files:** crear migración con `supabase migration new hacienda_custody_workflow` (no inventar nombre temporal), `tests/integration/hacienda-workflow-security.test.ts`; modificar autorización de roles en `modules/companies.ts` y su formulario en `apps/web/src/app.tsx`.

**Interfaces:** tablas públicas `hacienda_configuration` (tenant,ambienteTest,revision,versión activa,metadatos permitidos,último estadoAPI), `document_routes` (tenant,flowcollections/payables,destino,asignado opcional,enabled,version), `document_work_items` (tenant,source_kindinvoice_draft,source_id,source_department_id,source_version/current_version,flowcollections,target_department_id,assignee_id opcional,cliente al asignar,state,version,actor/fechas). Tabla privada `hacienda_credential_versions` con contexto inmutable, dos payloads cifrados/key_id separados (api_access ypkcs12) y estadoactivo. FKcompuestas a borrador/departamento/membresía; no FK a recibidos inexistentes. Ningún campo de importe/saldo/PEM en tareas.

- [ ] Escribir pruebasRED reales: dos empresas/departamentos, alias de referencias cruzadas, permisos mínimos, authenticated/anon sin SELECT de versiones secretas ni INSERT/UPDATE de configuración/tareas, metadatosHacienda denegados sinMFA, gestorCxC sin lectura de origen/secretos. Confirmar que no se crean departamentos ni se amplían membresías al migrar.
- [ ] Ejecutar `npx vitest run tests/integration/hacienda-workflow-security.test.ts`; observar tablas/funciones ausentes.
- [ ] Implementar migración: RLS/grants mínimos; `hacienda.read`, `hacienda.credentials.manage`, `hacienda.connection.test`, `collections.read/manage`, `payables.read/manage`, `document_workflow.assign`, inicialmente solo administrador; actualizar seed y catálogo de rolespersonalizados. Gestión incluye lectura correspondiente; `hacienda.credentials.manage` implica `hacienda.read`, no inventar `hacienda.credentials.read`.
- [ ] Helpers privados con search_pathseguro y execute revocado por defecto: autorizaciónHacienda exige sesiónválida+AAL2+alcanceempresa+permiso; bandejas usan alcance del destino; asignación comprueba origen/permiso y destino configurado. Responsable elegible exige perfil/membresía activos, alcanceempresa/departamento y permiso de lectura del flujo. No exigir sesión abierta del responsable para configurarlo.
- [ ] Escrituras de configuración/tareas/bóveda se reservan al backend runtime con claims verificados, transacción y reautorización dentro de la operación; endusers obtienen solo lecturaRLS de metadatos/tareas permitidos. APIrole sinDDL/BYPASSRLS, sin DELETE de secretos/historial. Política de acceso a ciphertext verifica contexto/permiso de operación, no concede acceso a terceros.
- [ ] Trigger acotado de cambios eninvoice_drafts actualiza current_version de tareas del mismo tenant y su versión de concurrencia. Campo `needs_review` compara versión confirmada y actual; no copia datos personales nuevos ni concede lectura de origen. Inmutabilidad de tenant/source/cliente al asignar; ruta habilitada impide desactivar departamento destino hasta reemplazar/deshabilitar ruta explícitamente.
- [ ] Aplicar solo local `npm run db:migrate`; repetir pruebas, `npm run test:db` y comprobación de grants/rolruntime. Commit de migración/pruebas/permisos.

### Task 3: Registro, sustitución y desactivación de credenciales

**Files:** crear `apps/api/src/modules/hacienda-configuration.ts`, `apps/api/src/services/credential-store.ts`, `tests/integration/hacienda-configuration.test.ts`; registrar rutas en `app.ts`.

**Interfaces:** GET `/api/companies/:tenantId/hacienda` devuelve solo configuración/metadata/capacidades; POST `/hacienda/credentials` acepta `{environment:'test',expected_revision:integer>=0,username,password,pin,pkcs12_base64}`; POST `/hacienda/credentials/deactivate` acepta `{environment:'test',expected_revision}`. DTOsecreto permanece en backend. `CredentialStore` cifra/recupera exclusivamente para operación autorizada y nunca serializa secretos en respuestas; `withApiAccess` entrega solo username/password al adaptador, sin descifrar el payloadPKCS12.

- [ ] Escribir pruebasRED: administradorAAL2 guarda/lee solo metadata, PINincorrecto no sustituye versión activa, prod/fields extra rechazados, ausenciakeyring503, manipulaciónciphertext no se descifra, antiguo key_id soportado, replay de revision/conflicto concurrente409, desactivar no borra ni anuncia revocaciónoficial. Token/password/PIN/base64/PEM ausentes en respuesta/logs/auditoría, incluso en errores.
- [ ] Ejecutar `npx vitest run tests/integration/hacienda-configuration.test.ts`; observar404 de rutas ausentes.
- [ ] Implementar cargaJSON acotada3MiB (exceso413 mediante manejo sanitizado de Fastify, no500) y decodificaciónBase64 canónica hasta2MiB; username/password/PIN1–1024 caracteres sin trim de secretos. Para el transportefd dePIN rechazarNUL/CR/LF explícitamente sin truncarlos (limitación técnica de lectura por línea, no regla de Hacienda); conservar Unicode y espacios. Primero verificar permisoMFA y rate limit antes de analizar; revalidar autorización/revision después del trabajo y antes de persistir.
- [ ] Validación costosa fuera del lockDB; confirmación transaccional con lockpor empresa/ambiente y revisiónoptimista, cifrado ligado a la nueva versión, activación atómica y versión anterior inactiva. Nunca sustituir por fallo; estado técnico/identidad/accesoAPI independientes. Identidadpendiente bloquea emisión futura, sin inferir cédula desdeSubject.
- [ ] Rate limit registro5por empresa y10por usuario cada15min utilizando mecanismo existente, respuesta429sinsecretos. Auditoríaacción/actor/ambiente/versión; no usar trigger genérico que copie objetos secretos o sus valores. Desactivar incrementa revisión y deja accesoAPI como no probado.
- [ ] Ejecutar pruebas más suites de seguridad/bóveda/parser, typecheck y commit.

### Task 4: AdaptadorIdP de pruebas sin emitir

**Files:** crear `apps/api/src/services/hacienda-idp.ts`, `tests/hacienda-idp.test.ts`, ampliar `hacienda-configuration.ts`, `tests/integration/hacienda-connection.test.ts`; actualizar `config.ts` y documentación de endpointfuente.

**Interfaces:** `IdpClient.probe({username,password}):Promise<{status:'success'|'authentication_failed'|'service_unavailable';sessionClosed:boolean}>`; POST `/hacienda/connection-test` con `{environment:'test',expected_revision}` y permisoespecífico+AAL2. Respuesta solo estado/timestamp/versión, nunca tokens.

**Fuentes y puerta de habilitación:** guíaoficial `https://www.hacienda.go.cr/docs/Guia_IdP.pdf` identifica `client_id=api-stag` y token/logout bajo `https://idp.comprobanteselectronicos.go.cr/auth/realms/rut-stag/protocol/openid-connect/`. La consulta pública de discovery desde este entorno devolvió403, por lo que la disponibilidadoperativa no está confirmada. `HACIENDA_STAG_PROBE_ENABLED` esfalsepor defecto y solo se habilita en despliegue tras reconfirmación; no editarURLsdesdefrontend. Mantener funciones de registro aunque pruebaexterna esté pendiente. No usar credenciales de ejemplos.

- [ ] Escribir pruebasRED con servidorHTTP controlado e inyección de transporte solo enNODE_ENVtest: form-urlencoded correcto, success+logout, invalidgrant, error403/timeout/redirect/cuerpo enorme/noJSON, tokens nunca retornados. Probar desactivación/reemplazo/revocaciónmientraspruebaenCurso: resultadoobsoleto no se almacena ni aparece como vigente.
- [ ] Ejecutar `npx vitest run tests/hacienda-idp.test.ts tests/integration/hacienda-connection.test.ts`; observar módulo/ruta ausentes.
- [ ] Implementar fetchTLS a destinosfijos, redirecterror, timeout10s y cuerpo máximo64KiB. Detectar autenticaciónfallida solo con respuesta específica, no confundir bloqueoHTTP/caídared con PINincorrecto. Obtener tokens y cerrar sesión con refresh_token según contrato; conservarlos únicamente en memoria durante la prueba. Si logout falla, reflejar sessionClosedfalse, sin afirmar que se revocó.
- [ ] Aplicar limit5/empresa y5/usuario cada15min, descifrar solo versiónactiva autorizada, verificar revisiónactual/permisos antes de red y de guardar estado. Al deshabilitar flag o faltar confirmaciónoficial devolver503ycapacidadfalse, nunca éxito simulado. Inyección de dependencias/transporte para tests queda prohibida fuera deNODE_ENVtest; no configurarla mediante petición ni variables de usuario.
- [ ] Ejecutar pruebas y `npm test`; documentar prueba realSTAG como pendiente sin credenciales/formularioHTTPS. Commit.

### Task 5: Rutas, responsables y tareas documentales

**Files:** crear `apps/api/src/modules/document-workflow.ts`, `packages/domain/src/document-workflow.ts`, `tests/integration/document-workflow.test.ts`; registrar en `app.ts`.

**Interfaces:** GET/PATCH `/api/companies/:tenantId/document-routes`; POST `/document-routes/setup` crea explícitamente destinos por defecto, idempotente; GET `/document-routes/eligible-assignees?flow=collections|payables&department_id=UUID`; POST `/invoice-drafts/:id/collection-review` con `{expected_version}`; GET `/document-work-items?flow=collections|payables&state=...&search=...&cursor=...`; PATCH `/document-work-items/:id` con `{expected_version,expected_source_version,state,assignee_id}`. Estados `pending/in_review/resolved/archived`. No endpointsfinancieros/recepciónfalsa.

- [ ] Escribir pruebasRED: setup repetido no duplica, elegir destinos existentes, erroresFKcross-tenant, no acceso de responsablesajenos/revocados/sinlecturaflujo, cambio de ruta no muevehistóricos, destinoactivo obligatorio. Asignación revisa origen+versión y permiso; solicitudes concurrentes devuelvenmisma tarea. Actor de origen sin permisos de destino recibe solo confirmación mínima de asignación, no acceso a bandeja.
- [ ] Escribir pruebasRED de gestor de destino: ve resumen sin líneas/importes y no puedeGET/PATCHborrador/Hacienda; RLSfiltra otrosdepartamentos. Actualizar estado requiereMFA/gestión/versiónvigente y responsableelegible. Cambiodeorigenaumentarevisión y obliga nueva revisión; no se puede resolver contra versiónantigua. Revocación inmediata retira acceso. Cambiarconfig no muevehistoria ni edita department_iddelborrador.
- [ ] Ejecutar `npx vitest run tests/integration/document-workflow.test.ts`; observar404/tablasfuturas según estado de implementación.
- [ ] Implementar rutas con transaccionesbackend y claims, verificaciónconjunta de permisos/empresa/alcance y locks en orden empresa→ruta→borrador→tarea. Setup reutiliza departamentoexacto activo del mismo tenant o crea el nombre, sin reactivar ni otorgar membresías de forma silenciosa. Configuración requiere company.manage y organization.manage; asignación requiere document_workflow.assign e invoices.manage sobre origen y destinoactivo configurado. No crear trabajoCxP en este incremento.
- [ ] Listas50porpágina, búsqueda literalmax100 y ordenestable. Gestión no otorga permiso sobreorigen. Responsabledesactivado se muestra como requiere reasignación, sin notificaciónexterna. Al cerrar tarea registrar versiónconfirmada de origen y actor; una tarea resuelta jamás significa facturaaceptada ni deuda. Política de archivo conserva historial, no DELETEfísico.
- [ ] Repetir pruebas, seguridadRLS y `npm test`; commit.

### Task 6: Secciones React de Hacienda, rutas y bandejas

**Files:** crear `apps/web/src/features/hacienda/{HaciendaWorkspace,CredentialForm,ConnectionStatus}.tsx`, `apps/web/src/features/workflow/{WorkflowSettings,WorkInbox}.tsx` y estilos; modificar `app.tsx` y `Drafts.tsx`; crear `tests/browser/hacienda-workflow.spec.ts`.

**Interfaces:** componentes reciben tenantId/permisos y usanclientesAPIexistentes. Navegación «Hacienda», «Cuentas por cobrar», «Cuentas por pagar»; configuraciónrutas accesible a administrador. En detalledeborrador, botón «Asignar revisión a Cuentas por cobrar» aparece solo con permisos, borradorguardado y sin cambioslocales; nunca se llama «Emitir».

- [ ] Escribir browserRED escritorio/móvil: registrodesintéticos, validaciónerrores, metadatos/versiones y campossecretoslimpios tras éxito/error; no secretos enURL/storage/DOMtrasoperación ni screenshots. Produccióninactiva, estadosarchivoclave/accesoAPI/firma/envío separados; siSTAGinactivo el botón explica que pruebaexterna está pendiente. Se prueba el backend de conexión con transportecontrolado enTask4, sin fingirHaciendareal enbrowser.
- [ ] Escribir browserRED de setup/rutas/responsable/asignaciónCxC, tarea marcadaenpreparación, cambioorigen requiere revisión, lectorCxCsinlecturaorigen, CxPvacíoexplicado. Retener respuestas y cambiar empresa/vista/sesión: no mostrar datos/erroresanteriores. Rolespersonalizados muestran nuevas autorizaciones con textosclaros.
- [ ] Ejecutar `npm run build && npx playwright test tests/browser/hacienda-workflow.spec.ts`; observarcontrolesausentes.
- [ ] Implementar inputssecretosno controlados, passwordtype yfileinputsin valoresprecargados; leerarchivo solo al enviar yresetear enfinally; no guardarpayload en estadoReact/persistente. MostrarAAL2/permisosnecesarios sin deshabilitar seguridad. Rutas seleccionan departamentoactivo y responsables elegibles; no autoconceder acceso para poblarselector.
- [ ] Reutilizar generaciones/montajeporempresa; deshabilitarcambiodeversión/registro durantewrites y tratar409conrecarga explícita. Formulariosaccesibles por teclado, etiquetasen español y sin desbordamiento. UIbandejapropia no usa datosdeorigen que el backend no devuelva. No QR/PIN/token en capturas; datos/llaves sintéticos únicamente.
- [ ] Repetirbrowsernuevo y carreras2A/2B1, build; commit.

### Task 7: Verificación, operación y entrega

**Files:** crear `docs/development/hacienda-custody-workflow-evidence.md`, `docs/runbooks/hacienda-vault.md`; actualizarREADME, instrucciones de build/local y el estado de esteplan/diseño.

- [ ] Probar restauración con ciphertextsintético y keyringseparado; incluirclaveanterior y nuevaactiva y comprobarlectura. Documentar que perder/borrarclave vuelve ilegiblessecretos y que desactivar no revoca anteHacienda. No incluirkeyringreal en backup de fuente oZIP.
- [ ] Ejecutar `npm test`, `npm run test:db`, `npm run test:browser`, `npm run build`; verificarworker/binarioactualizados y suite completa sin fallos. Guardar resultadosreales, hashes de migración/artefactosfuente, pruebascripto/tiempo/límites y cobertura depermisos.
- [ ] Revisiónindependiente final del diffcontra diseño/ReviewFocus/ledger; resolver hallazgos importantes medianteRED→GREEN. Repetir pruebas afectadas y suite según cambios; sin revisores por tarea ni implementación delegada.
- [ ] Auditar código/respuestas/logs/capturas/ZIP por secretosyarchivosprivados; `git diff --check` ygrants/RLS deben pasar. Entregar vistas con informaciónficticia, ZIPsolo fuente y evidencia conestado STAGreal pendiente o comprobado, nunca inferido de doblesdetest. Conservar rama; no merge/push/despliegue/migraciónremota.

## Revisión del plan

El plan cubre custodia/rotación/compatibilidad yrecuperación(Task1–3), accesoAPIseparado(Task4), departamentos/asignación/responsables/sinlecturadeorigen(Task2/5), experienciaycarreras(Task6) y cierre(Task7). No queda tarea que dependa de tablasrecibidas inexistentes ni de un esquemaXSD declarado vigente sin confirmación. La actualizaciónOpenSSL y la disponibilidadIdP son puertas explícitas: no degradar seguridad ni simular integración para completar la entrega.
