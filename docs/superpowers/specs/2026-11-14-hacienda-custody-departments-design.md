# Conta Fácil — custodia de Hacienda y bandejas departamentales

Fecha:2026-11-14. Estado: aprobado por el usuario al responder «Si»; pendiente de ejecución del plan. Complementa el circuito integral y delimita el siguiente incremento funcional.

## Intención, decisiones y alcance

El usuario solicita la sección donde registrar llave criptográfica y requisitos de Hacienda, el viaje de envío/respuesta y la recepción, vinculando salida con Cuentas por cobrar(CxC) y entrada con Cuentas por pagar(CxP). Eligió expresamente **departamentos y bandejas primero**; saldos, vencimientos, cobros/pagos y contabilidad quedan fuera.

Se conserva la arquitectura nativa modular y la integración directa elegidas previamente. Custodia cifrada en backend reutiliza la infraestructura actual con clave independiente; una bóveda externa sería posible después, pero agrega infraestructura sin resolver los bloqueos tributarios. Registrar secretos en frontend o tablas públicas se descarta por los requisitos ya acordados.

El incremento inmediato entrega: configuración de integración de pruebas, registro seguro y validación local de llave/credenciales, pruebaAPI sin emitir, departamentos/responsables y asignación documental inicial a CxC. CxP tendrá configuración y bandeja preparada, con estado vacío explícito hasta que el siguiente incremento incorpore recepciónXML validada. No crear facturas recibidas ficticias para poblarla. El circuito de recepción y transmisión se especifica abajo, pero no se declara implementado por dibujar sus pasos.

No se habilitan todavía generaciónXML, firmaXAdES de comprobantes, transmisión, mensajes del receptor, correo automático ni descarga de documentos fiscales inexistentes. Los bloqueos de XSD/política de redondeo y datos fiscales del incremento anterior continúan. No hay saldos ni obligación financiera automática por mostrar una factura en una bandeja.

## Circuito integral al que se conectará

**Salida:** departamento de origen → borrador y datos fiscales → cálculo/validación → reserva idempotente de clave/consecutivo → firma → transmisión → recepción técnica → consulta de respuesta definitiva → clasificación documentalCxC → entrega y seguimiento. Un201 no significa aceptación tributaria. Rechazados/errores se muestran en control de excepciones y no como documentos válidos. Una venta al contado no crea por sí sola una deuda.

**Entrada:** carga manualXML primero; correo después → análisis seguro y cuarentena → verificación de receptor/empresa y duplicados → validación estructural, firma/estado aplicable → revisión interna → asignaciónCxP → decisión explícita del receptor → mensaje firmado/enviado → consulta de resultado. Llegar al correo o cargarse no acepta un comprobante ni autoriza un pago. La revisión interna, decisión, transmisión y respuesta fiscal permanecen separadas.

Ambos circuitos conservan empresa, departamento de origen, departamento de gestión, actor, fechas, archivos y eventos. Procesamiento idempotente por empresa/ambiente/documento y trabajos duraderos con reintentos acotados; ante timeout consultar estado antes de reenviar. Callbacks futuros se tratarán como avisos no confiables hasta comprobar documento/respuesta; no aceptar un JSON entrante como autorización tributaria.

La infraestructura gratuita actual puede suspender el proceso web: no prometer ejecución puntual de trabajos mientras esté dormido. Al incorporar transmisión, la cola duradera recuperará pendientes tras reinicio y se verificará el mecanismo de ejecución; las consultas manuales no se anunciarán como un servicio continuo de recepción automática.

## Sección Hacienda: datos visibles y secretos

Por empresa, pestaña Pruebas activa y Producción separada/inactiva en este incremento. Perfil visible: identificación de empresa existente, actividades ya registradas como referencia, estado de los campos fiscales pendientes, sucursales/terminales y lista de requisitos. No inferir ubicación estructurada o actividad validada a partir de texto libre.

Formulario de pruebas: usuarioAPI, contraseñaAPI, archivoPKCS12(.p12/.pfx) y su PIN. Son cuatro valores distintos; no pedir la contraseña del portalOVi. PIN de importación no se restringe a cuatro dígitos ni se rechaza un PIN legado válido por no cumplir el formato de generación de llaves nuevas. Respetar lo que permita abrir realmente el archivo, con límites técnicos amplios de longitud, sin inventar requisitos tributarios.

Carga máxima propuesta2MiB, un archivo, validación realPKCS12, límites de tiempo/memoria y sin extracción a disco plano. Comprobar PIN, presencia de clave privada, coincidencia clave/certificado mediante prueba criptográfica local, fechasUTC y algoritmo admitido según fuente oficial. Rechazar contenedores ambiguos con múltiples claves privadas. No confiar en extensión/MIME. No inventar un parser de cédula desde Subject; si no puede confirmarse titularidad con un perfil oficial verificado, registrar `identity_pending` y bloquear uso para emisión.

Los errores devuelven motivos sanitizados, nunca PEM, PIN, contraseña o salida cruda del parser. En error no persistir archivo/PIN y liberar buffers; la pantalla borra secretos tras la operación y obliga a reintroducirlos al reemplazar. No guardarlos en URL, localStorage, analítica, estado serializado ni capturas.

Metadatos retornables solo a autorizados: identificador/versión, ambiente, huella pública del certificado, vigencia, algoritmo/tamaño de clave, validación técnica, titularidad pendiente/verificada, fecha/actor de cambio y resultado resumido de conexión. Nunca devolver el archivo, clave privada, PIN, contraseña o tokens después de guardarlos. Un certificado público tampoco se descarga desde esta sección; solo metadatos.

## Custodia, rotación y autorización

AES256-GCM con IV aleatorio y autenticación del contexto empresa+ambiente+versión+tipo. Clave maestra independiente de SESSION_KEY, provista exclusivamente al backend en un keyring versionado mediante secretos de despliegue; falta de clave/configuración válida impide guardar/probar secretos. No generar una clave efímera en producción que vuelva ilegible la información al reiniciar.

Tabla privada de versiones cifradas, sin grants a anon/authenticated. Los endpoints verifican sesión, membresía, permisos propios y AAL2 antes de cualquier operación privilegiada. Metadatos públicos tienen RLS y acceso por empresa; contador o encargadoCxC/CxP no reciben secretos ni permiso implícito de administrarlos. Nuevos permisos `hacienda.read`, `hacienda.credentials.manage` y `hacienda.connection.test`, inicialmente solo administrador; todos estos accesos requierenMFA.

Reemplazar crea una versión nueva validada; fallo conserva la anterior, éxito activa nueva y desactiva anterior en transacción. Control optimista evita dos sustituciones silenciosas. La versión anterior permanece cifrada e inactiva según política de retención operativa, sin usarse para trabajos nuevos. La aplicación permite desactivar localmente, pero eso no revoca el certificado ante Hacienda. La revocación oficial se efectúa en su portal; no mostrarla como realizada localmente.

Separar estado de custodia, validación técnica, titularidad y accesoAPI. Ninguno equivale a firmaXAdES válida ni aceptación de comprobantes. Auditoría registra acción, actor, empresa, ambiente y versión, sin contenido secreto; copias incluyen ciphertext y metadatos, la clave maestra se respalda por canal independiente y se prueba recuperación con secretos sintéticos.

## Prueba de acceso sin emisión

Botón «Probar acceso de pruebas»: operación explícita, soloPruebas, permiso específico+AAL2, CSRF y rate limit por empresa/usuario. Backend obtiene la versión activa y usa exclusivamente la configuración oficial de STAG confirmada, sin URLs editables desde frontend. No pruebaProducción ni envíaXML. No aceptar redirecciones a hosts distintos ni devolver tokens.

La guía oficial histórica identifica realm/clientSTAG; antes de implementar el adaptador se reconfirmará el contrato actual con fuente oficial y disponibilidad. Fallo de conectividad o autenticación se distingue de archivo/PIN incorrecto. Un resultado satisfactorio significa únicamente accesoIdP, con timestamp/versión; cambios de credenciales invalidan el resultado previo. Tokens se mantienen en memoria solo para la prueba y se cierran/inutilizan después según contrato oficial. No enviar credenciales a un endpoint de ejemplo o tercero para lograr una prueba verde.

Las pruebas automatizadas usarán credenciales/PKCS12 sintéticos y un servidorHTTP controlado con adaptador inyectable solo desde configuración de pruebas; producción no permite un host arbitrario. Una prueba real STAG exige que el titular registre sus secretos mediante el formulario protegido. No se solicitan por chat. Sin esos datos, se puede entregar la sección local, pero no declarar verificada la integración real.

## Departamentos y responsables

Configuración por empresa elige departamentos activos existentes paraCxC yCxP, o crea explícitamente «Cuentas por cobrar» y «Cuentas por pagar» mediante acción transaccional e idempotente de administrador. Son referenciasUUID con FKcompuesta por tenant, no nombres reservados. No crear departamentos en todas las empresas durante una migración ni alterar membresías automáticamente.

El administrador asigna responsables entre membresías activas autorizadas al departamento destino o con alcance empresa. No basta indicar un user_id válido de otra empresa. Cambios de departamento o responsable se versionan/auditan; modificar el destino por defecto solo afecta asignaciones futuras. Un responsable desactivado se muestra pendiente de reasignación; no se envía información a una cuenta revocada.

No se puede desactivar un departamento destino mientras su ruta esté habilitada: primero se sustituye/deshabilita la ruta explícitamente; las asignaciones históricas conservan sus referencias.

El documento conserva su `department_id` de origen. Una asignación de gestión separada identifica flujoCxC/CxP, departamento destino y responsable. El destino por defecto no mueve documentos históricos, no duplica el documento ni concede permisos financieros generales.

## Bandejas del incremento inmediato

CxC muestra tareas documentales y separa «En preparación» de futuros comprobantes fiscales aceptados/rechazados. Un usuario con gestión de su borrador y permiso explícito de asignación puede solicitar «Asignar revisión a Cuentas por cobrar», únicamente al destino configurado por su empresa. El backend vuelve a verificar origen, destino activo y versión del borrador; una restricción única evita duplicar la tarea para el mismo documento/flujo. No enviar a Hacienda ni crear cartera por esta acción.

La tarea referencia el borrador existente, origen y versión, destino de gestión, responsable opcional y estado interno `pending/in_review/resolved/archived`. La lista no presenta un borrador como factura aceptada ni su importe antes de impuestos como saldo por cobrar. Si cambia el borrador, se indica «documento actualizado; requiere revisión» hasta confirmar la nueva versión; una tarea resuelta no certifica emisión fiscal.

CxP queda disponible con configuración/responsables y un estado vacío: «La recepciónXML se habilitará en el próximo incremento». Sin carga falsa ni saldo cero interpretado como inexistencia de deudas. El futuro ingreso creará tareas desde documentos recibidos validados para la empresa; cuarentena quedará restringida y no se mezclará con documentos aprobados.

Todos los nuevos permisos de bandejas/asignación se conceden inicialmente solo al administrador. Roles existentes no adquieren acceso automáticamente; el administrador podrá crear roles personalizados con estas autorizaciones. La política actual de AAL2 para acciones de gestión se mantiene.

Permisos nuevos `collections.read/manage`, `payables.read/manage` y `document_workflow.assign`; requieren además alcance al departamento de gestión (y al origen al asignar). Asignar desde origen a la ruta configurada es una autorización expresa de acceso documental para los gestores de destino; no habilita a esos gestores a editar el borrador comercial. La bandeja inicial expone solo identificador, nombre comercial del cliente al asignar, origen, estado, versión y responsable. Ese resumen mínimo se conserva en la tarea bajo sus propias políticas; no es una copia de líneas/importes/XML. Un trigger interno acotado marca cambios de versión del borrador en las tareas de la misma empresa, sin conceder SELECT sobre el borrador al gestor de destino ni copiar nuevos datos personales. La confirmación de revisión usa control optimista de tarea y versión de origen. No habilitar una política general de lectura de facturas para poder listar tareas. No ofrece descarga XML/PDF si no existen ni concede permiso de aceptación/rechazo del receptor.

Borrador inaccesible antes de asignar devuelve404. Tarea inaccesible por otra empresa/departamento devuelve404. Cambiar destino exige administrador con acceso a origen/destino; no permitir reescritura arbitraria del tenant o de la referencia de origen. LecturaCxC/CxP no habilita lectura de Hacienda/secretos. El administrador puede ver las bandejas de toda su empresa, sin acceso transversal a otras empresas.

## Modelo y módulos

Módulos separados `hacienda-configuration` (metadatos/endpoints), `credential-vault` (cifrado/validación, sin frontend), `document-workflow` (rutas/tareas/alcance). Tablas de configuración/rutas/tareas públicas con RLS; versiones secretas privadas sin acceso directo. Todas las referencias entre documentos, usuarios, departamentos y empresas deben ser compuestas o verificadas transaccionalmente dentro de la misma empresa.

Tareas iniciales soportan `source_kind=invoice_draft` únicamente. No anticipar una FK a tablas recibidas que aún no existen ni permitir `source_kind` libre. La migración del incremento de recepción ampliará el modelo con FKreal sin duplicar factura/documentos. No generar asientos ni saldos.

La sección de recorrido muestra evidencias reales por paso: llave cargada, prueba local, accesoAPI, XSDpendiente, firmapendiente, envíono realizado. No usar check verdes para pasos no ejecutados ni llamar «Conectado con Hacienda» al simple guardado de credenciales.

## Verificación y criterio de cierre

Pruebas: aislamiento entre dos empresas y departamentos; todos los endpoints de secretos exigenMFA/permisos; ninguna lectura directa/errores/auditoría expone material; manipulación de ciphertext o cambio de tenant/ambiente/AAD falla; PINincorrecto/certificado inválido/vencido/múltiples claves no reemplazan versión válida; rotación concurrente/conflictos; ausencia de clave maestra bloquea operación; parser no consume archivos ilimitados ni usa secretos en argv/logs.

Rutas/responsables: referencias cruzadas rechazadas, usuarios revocados/ajenos no asignables, acción repetida no duplica departamentos/tareas, cambio de configuración no mueve históricos, gestor de destino consulta tarea sin editar borrador ni acceder a secretos, nuevas versiones invalidan revisión previa. CxP vacío no inventa recepción.

Navegador escritorio/móvil: registro sintético sin capturar secretos, metadatos y estados separados, fallo conserva versión anterior, departamentos/responsables, asignación documental y bandejas autorizadas, respuestas tardías descartadas al cambiar empresa/vista/sesión. Suite completa, build, revisión independiente y evidencia local. Toda llamada realSTAG debe registrarse como prueba real o pendiente, nunca simular aceptación.

Cierre de este incremento: custodia/configuración/bandejas iniciales comprobables localmente. Bloque siguiente: completar perfil/catálogos/XSD y firma/transmisiónSTAG; después recepción manual con mensajes y conector de correo. La elección exacta de parserPKCS12/keyring, límites internos de rate limit e índices se deja al implementador, tras verificar documentación/vulnerabilidades vigentes. No se deja a criterio del implementador ampliar a producción, saldos o contabilidad.

## Fuentes y dudas normativas

[Investigación de custodia/circuito](../../development/hacienda-credentials-and-routing-research.md) y [matriz XSD](../../development/phase2b-normative-matrix.md). Confirmar contratoIdP actual, paqueteXSD2026/dependencias, identificación verificable del titular y política de redondeo antes de implementar la funcionalidad afectada. El registro seguro y la organización departamental no sustituyen esas validaciones. Ninguna llave real debe registrarse por HTTP público: HTTPS es requisito de despliegue; pruebas locales usan solamente material sintético.

## Revisión del diseño

Un builder check independiente leyó el diseño y el contexto y no encontró preguntas importantes pendientes para planificar. El usuario ya eligió departamentos/bandejas sin cartera financiera; el usuario aprobó este diseño concreto. Las comprobaciones normativas indicadas no se consideran resueltas por esa aprobación.
