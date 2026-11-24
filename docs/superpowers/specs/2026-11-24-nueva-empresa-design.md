# Nueva empresa y administración exclusiva del propietario

Estado: diseño aprobado por el usuario e implementado localmente; sin publicación ni despliegue automático.

## Alcance y decisiones confirmadas

Implementar el documento «Desarrollo de pantalla Nueva empresa» aportado por el usuario en el proyecto actual. Solo el propietario, identificado mediante su UUID de usuario verificado, podrá crear empresas, modificar sus datos y configuración, invitar usuarios y asignar o revocar accesos. El usuario eligió esta opción frente a permitir altas a cualquier administrador empresarial. No conceder privilegios por ser el primer usuario, por un correo escrito en el navegador ni mediante metadatos editables.

Reutilizar `private.platform_operators` como registro de superadministradores, las membresías y roles existentes, `tenants`, actividades, sucursales, terminales, configuración tributaria y bóveda de credenciales. El propietario actual fue registrado por operación administrativa explícitamente autorizada y auditada; no incluir su UUID ni correo como regla en el código o las migraciones. No permitir crear otros superadministradores desde el formulario.

## Alternativas y elección

- Administración exclusiva del propietario: elegida por el usuario; protege altas y cambios empresariales en servidor y base de datos.
- Delegación a administradores de cada empresa: descartada por instrucción expresa del usuario.
- Reconstruir autenticación o usar otro generador de aplicaciones: descartado; conservar React/TypeScript/PostgreSQL actuales.

## Flujo e interfaz

En «Mi empresa», incorporar Nueva empresa y Editar empresa sin cambiar el menú general ni el panel principal. Formulario con seis pestañas: información general, domicilio fiscal, información tributaria, facturación electrónica, configuración contable y usuarios/permisos. Reutilizar estilos y componentes; dos columnas cuando quepan y una en móvil. Guardar datos básicos aunque las demás pestañas estén pendientes. Cancelar no crea registros. Tras guardar, refrescar el selector existente y seleccionar la nueva empresa. Una empresa inactiva debe seguir disponible para consulta y reactivación del propietario en esta administración; no habilitar operaciones ordinarias sobre empresas inactivas.

Identificación, razón social y tipo de persona son básicos obligatorios. Conservar nombres y tipos históricos sin reinterpretarlos automáticamente. Normalizar identificaciones por tipo; no inventar cédulas. Duplicados por identificación normalizada en el ámbito de esta instalación SaaS, sin revelar información ajena. Correo, contacto, domicilio, logo privado y demás parámetros se guardan solo cuando el usuario los aporta.

Territorios: reutilizar la jerarquía oficial verificada existente. Barrio como texto cuando corresponda. Actividades: múltiples, una principal; conservar procedencia verificable. Consultar documentación y catálogos oficiales antes de validar códigos. Si falta un catálogo oficial de búsqueda por descripción, identificar la dependencia y permitir preparación manual pendiente de verificación; no simular resultados oficiales. PYME no concede automáticamente exoneración.

## Autorización y conservación

El servidor verifica usuario activo, sesión vigente y MFA `aal2` en cada acción administrativa. La condición de superadministrador se consulta en la base; el navegador solo adapta la interfaz. Las políticas y funciones de autorización deben impedir que un rol empresarial convencional se otorgue administración de empresas o usuarios por la API de datos. Mantener los permisos operativos explícitos de facturación y recepción, separados de la administración de datos y accesos empresariales. El superadministrador accede a una empresa mediante su membresía; crear una empresa lo asocia como administrador en la misma transacción. No habilitar lectura automática de cualquier empresa solo por ser operador de plataforma.

Crear empresa, rol/membresía del propietario, parámetros iniciales y evento de auditoría en una transacción. Idempotencia mediante operación única por actor; doble clic y reintentos no duplican empresas. Edición con versión esperada para evitar sobreescrituras. Datos y configuraciones nuevas conservan `tenant_id`, fecha de creación/modificación y actor. Duplicados existentes se preservan y se documentan; no borrarlos ni reasignar propietarios.

## Configuración y seguridad

Los parámetros contables son preparación: monedas, fechas, inventario y capacidades solicitadas; no generan asientos ni afectan el redondeo fiscal confirmado de las líneas. Las opciones de departamentos son asignaciones reutilizando el módulo existente, no permisos implícitos por nombre de departamento.

Reutilizar la bóveda cifrada para llave .p12, PIN y autenticación. Contraseñas se ingresan en controles de captura, se envían exclusivamente al servidor y no se devuelven en lecturas, auditoría ni almacenamiento del navegador. No almacenar secretos en JSON genérico de empresa. Separar pruebas y producción. La implementación actual de bóveda admite pruebas: cualquier ampliación a producción requiere extender y probar explícitamente su contexto criptográfico y restricciones; mientras no exista ese soporte, mostrar producción pendiente sin aceptar secretos que no puedan custodiarse. Esta pantalla no transmite comprobantes ni ejecuta pruebas externas automáticamente.

Reutilizar sucursales y terminales; mantener consecutivos por empresa/sucursal/terminal/tipo de documento. Registrar configuración y estado de preparación sin consumir, reiniciar o cambiar contadores existentes. Los siete tipos solicitados se preparan como configuración, sin afirmar que ya exista emisión de todos ellos. Verde solo cuando las verificaciones implementadas confirmen la configuración; amarillo para pendientes y rojo para errores comprobados. No confundir este estado con aceptación de Hacienda ni con certificación de producción.

## Entrega y límites

Migraciones aditivas, aplicadas primero solo localmente. No cambiar inicio de sesión; no desplegar ni publicar automáticamente, por instrucción del documento. Las restricciones nuevas para usuarios distintos del propietario no se considerarán activas en Render hasta un despliegue posterior autorizado.

Pruebas directamente relacionadas: alta y reapertura, edición con conflicto de versión, campos requeridos, duplicado y reintento simultáneo, membresía del propietario, usuario no máster denegado incluso con rol administrador, MFA, aislamiento por empresa, parámetros y actividades persistidos, secretos ausentes de respuestas y logs, protección de consecutivos y diseño móvil. Reutilizar las pruebas existentes pertinentes; compilación y TypeScript. Entregar resumen breve con cambios, migraciones locales, comprobaciones y dependencias normativas o de producción pendientes.
