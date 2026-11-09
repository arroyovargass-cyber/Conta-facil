# Conta Fácil — Diseño propuesto de Fase 1

Fecha: 2026-11-09. Estado: propuesta para aprobación; enfoque modular aprobado. No es una certificación tributaria ni una entrega funcional.

## Propósito y alcance

Crear la base real de una plataforma SaaS costarricense multiempresa. La primera entrega permitirá iniciar sesión, escoger empresa autorizada, administrar su estructura y controlar quién puede hacer cada operación. La facturación electrónica 4.4 tiene prioridad sobre la contabilidad, pero su implementación comienza en Fase 2.

Incluye autenticación, recuperación, MFA de administradores, empresas, membresías, ocho roles iniciales, permisos personalizados, departamentos, centros de costos, sucursales, terminales, configuración tributaria y auditoría. Excluye emisión XML, cálculo tributario, firma, transmisión, importación de correo, aceptación de comprobantes, suscripciones pagadas y contabilidad. No mostrará facturas ni indicadores financieros ficticios como si fueran reales.

## Enfoques y decisión

El usuario aprobó el enfoque recomendado: aplicación modular con backend central Node.js/TypeScript, interfaz React/TypeScript/Tailwind y PostgreSQL/Supabase Auth. Se consideró React con Supabase y Edge Functions: reduce infraestructura inicial, pero requiere servicios adicionales para firma y trabajos prolongados. Se elige el primero por centralizar autorización e integraciones futuras.

## Arquitectura y entrega

Monorepo con apps/web, apps/api, packages/domain, packages/contracts, supabase y docs. Frontend React con Vite; API Node.js con Fastify y validación de entradas. Módulos: identidad, empresas, autorización, organización, configuración y auditoría. Los módulos futuros se conectarán mediante contratos y eventos, sin implementar todavía procesos tributarios.

Primero se entregará ejecución reproducible local con Supabase local y datos sintéticos. Se podrá desplegar la interfaz en Sites; una interfaz publicada por sí sola no constituye una entrega funcional. La API Node necesita alojamiento compatible y Supabase necesita proyecto configurado. No se creará infraestructura de pago ni se modificará un proyecto existente sin identificarlo y obtener la autorización de costos necesaria. La ausencia de credenciales no se sustituye por autenticación ficticia: se documentará y probará el entorno local, y el despliegue conectado se reportará pendiente.

## Identidad, sesiones y recuperación

UUID de Supabase como identidad interna. Identificación visible almacenada como texto, con tipo, país emisor y valor normalizado; preserva ceros y letras. Normalización conservadora: eliminar espacios exteriores y separadores solo para tipos que lo permitan; no imponer formatos tributarios no confirmados. Unicidad de la identidad global por país, tipo y valor; el acceso acepta tipo e identificación para resolver ambigüedades.

Supabase Auth gestiona hashes y verificación de contraseñas. Como el acceso por contraseña usa email o teléfono, un directorio privado del backend resuelve identificación a email verificado; el usuario entra con identificación y contraseña. No usar cédulas como correos inventados. El email se recoge para recuperación, con unicidad compatible con Auth; invitaciones pendientes no conceden membresía activa. Registro inicial por invitación y bootstrap administrativo mediante comando del servidor, sin registro público ni contraseñas predeterminadas. El primer administrador y su empresa se crean mediante el bootstrap autorizado; los administradores invitan a miembros, y la plataforma registra empresas adicionales con autorización expresa.

Cookies HttpOnly, Secure en HTTPS y SameSite; protección CSRF y comprobación de origen para mutaciones. Refresh token solo servidor/cookie protegida, nunca localStorage. Recuperación responde genéricamente y envía un enlace al email verificado mediante Auth/SMTP; la contraseña nunca se entrega a administradores. Rate limit compartido en PostgreSQL por IP e identificador protegido, con expiración y espera progresiva; no depender de memoria de una instancia. Logs sin contraseñas, tokens, identificaciones completas ni contenido de cookies.

MFA TOTP obligatorio para superadministrador y administrador de empresa. El usuario pendiente de enrolamiento solo puede completar MFA, recuperar acceso o cerrar sesión; operaciones administrativas requieren AAL2 verificado en servidor y base de datos. La desactivación global o revocación de membresía se comprueba en cada petición, además de revocar sesiones. Expiración por inactividad, cierre de sesión y registro de accesos; la revocación no depende de esperar a que expire el JWT. Restablecimiento de MFA exige procedimiento administrativo documentado y auditado, sin bypass por correo ordinario.

## Modelo de datos

Tablas globales: profiles (UUID, estado), permission_catalog (módulo/acción), private.login_directory, private.platform_operators y registros privados de sesiones/rate limit.

Tablas por empresa: tenants; memberships (usuario, estado, alcance global o restringido); departments; cost_centers; branches; terminals; roles; role_permissions; membership_roles; membership_departments; tax_settings; economic_activities; audit_events. tenants usa su id como tenant_id de las entidades dependientes. UUID, fechas UTC, índices por empresa y claves únicas (tenant_id, id) para relaciones compuestas que impidan vincular departamentos, roles o terminales de otra empresa. Identificaciones son texto. Configuración versionada y desactivación lógica para entidades referenciadas.

Los roles iniciales son superadministrador de plataforma, administrador de empresa, contador, facturación, recepción, jefe de departamento, operativo y auditor. El superadministrador se modela globalmente, los otros siete son plantillas de empresa. La plataforma no recibe acceso implícito a datos tributarios: necesita membresía expresa para entrar a una empresa. El alta/bootstrap puede crear empresas y asignar administradores mediante operación privilegiada aislada y auditada.

No se crean tablas contables ni comprobantes vacíos en Fase 1. Se reservan límites de dominio: terceros, productos, comprobantes, asignaciones de costos, archivos y eventos. Fases posteriores usarán las mismas empresas, membresías y centros de costos; importes serán decimales exactos, nunca flotantes para cálculos tributarios.

## Autorización y aislamiento

Denegar por defecto. Permiso efectivo = usuario activo + sesión válida + membresía activa + permiso módulo/acción + alcance departamental + MFA cuando corresponda. Las concesiones personalizadas se agregan a roles; Fase 1 no incorpora reglas de denegación contradictorias. Un alcance restringido requiere departamento explícitamente autorizado; registros sin departamento se reservan a alcance empresarial o asignadores autorizados.

El tenant_id de una ruta o selector es entrada no confiable. Backend comprueba membresía y alcance en cada consulta, cambio y exportación futura. RLS aplica a todas las tablas expuestas; UPDATE usa USING y WITH CHECK. Las consultas ordinarias usan el JWT del usuario y preservan RLS; service_role solo en operaciones administrativas aisladas, nunca para consultas genéricas ni frontend. Directorio y secretos en esquema privado, sin grants públicos. Funciones privilegiadas solo si son indispensables, con search_path fijo, EXECUTE restringido y comprobaciones explícitas. Evitar políticas recursivas y comprobarlas con usuarios reales de prueba.

Cambiar roles y membresías exige permiso administrativo no delegable a un rol operativo. Evitar autoescalamiento y eliminación del último administrador activo. Invitación no activa hasta verificación y aceptación por el titular. Un administrador no puede conceder poderes de plataforma. Auditoría transaccional registra actor, empresa, acción, entidad, resultado y cambios permitidos; el usuario de aplicación no puede editarla ni borrarla. Cambios de roles tienen efecto inmediato porque se consultan en base, no desde user_metadata ni claims obsoletos.

## Configuración tributaria y secretos

Razón social, nombre comercial, tipo/identificación, contactos, ubicación y actividades económicas con fuente verificable. Separar configuración de pruebas y producción. No inventar actividades, códigos CABYS, catálogos de ubicaciones ni estados tributarios. Campos sin fuente validada permiten guardar borrador, pero no marcar configuración como verificada.

Fase 1 prepara contratos y referencias de secretos, pero no ofrece carga de certificados ni captura de contraseña tributaria hasta contar con gestor de secretos y cifrado operativo. La interfaz indica configuración pendiente. No almacenar secretos en tablas públicas, navegador, fixtures ni logs. En Fase 2 el cifrado deberá usar claves externas al almacenamiento y permitir rotación con versión de clave.

## Experiencia de usuario

Interfaz en español, adaptable a escritorio y Android, navegación lateral, empresa activa siempre visible, formularios accesibles, errores claros y confirmación para desactivar o revocar. Rutas: acceso, MFA, recuperación, selector de empresa, inicio de configuración, empresa, usuarios/permisos, departamentos/centros, sucursales/terminales, configuración tributaria y auditoría.

Inicio muestra progreso de configuración y conteos reales de usuarios, departamentos y sucursales. Facturación y recepción se identifican como próximas fases sin acciones que aparenten emitir documentos. Cambiar de empresa limpia cachés y selecciones; claves de consulta incluyen tenant_id. Listados paginados y filtros procesados en servidor.

## Fuentes y revisión normativa

- Portal de anexos: https://atv.hacienda.go.cr/ATV/ComprobanteElectronico/frmAnexosyEstructuras.aspx
- Anexos 4.4: https://www.hacienda.go.cr/docs/ANEXOS_Y_ESTRUCTURAS_V4.4.pdf
- Actualización: https://www.hacienda.go.cr/docs/ActualizacionAnexosyEstructurasVersion4.4CEv2.pdf
- API: https://www.hacienda.go.cr/docs/ComprobantesElectronicosAPI.html
- Auth: https://supabase.com/docs/guides/auth/passwords
- MFA: https://supabase.com/docs/guides/auth/auth-mfa
- RLS: https://supabase.com/docs/guides/database/postgres/row-level-security

Revisión preliminar realizada; no se ha completado validación normativa. El comunicado advierte cambios de identificaciones y referencias; su expresión «presente año» no se convierte en fecha absoluta sin verificar publicación. La documentación API distingue recepción técnica y validación posterior. Antes de emisión se deben recuperar los archivos vigentes desde OVi, guardar versión/hash/fecha, revisar cada XSD, campos condicionales, firma, IdP, catálogos y modificaciones con validación normativa. No asumir que un enlace histórico representa la última versión. El changelog Markdown de Supabase no fue recuperable; se consultó su equivalente HTML https://supabase.com/changelog. Anuncia cambios incompatibles en CLI v3 (destino local por defecto y configuración local_smtp); fijar versión y consultar --help antes de generar comandos o configuración. No se aplicarán cambios remotos implícitos.

## Pruebas y aceptación de Fase 1

1. Migraciones desde base limpia; datos sintéticos de dos empresas, usuarios compartidos y exclusivos, alcance departamental y auditor.
2. Pruebas RLS y API de lectura, inserción, actualización, eliminación/desactivación y relaciones cruzadas; UUID ajenos y tenant_id manipulado no revelan ni modifican datos.
3. Acceso por identificación, errores genéricos, recuperación, rate limit, cookies/CSRF, sesión revocada y usuario desactivado.
4. MFA exigido para administrador, AAL1 sin acceso administrativo y enrolamiento controlado.
5. Roles personalizados sin autoescalamiento, pérdida inmediata de acceso y protección del último administrador.
6. Auditoría de mutaciones exitosa en la misma transacción, acceso de solo lectura y ausencia de secretos en logs/respuestas.
7. Recorrido funcional de alta de empresa, invitación, selección, departamentos y configuración; verificar móvil, teclado y estados vacíos.
8. Evidencia con comandos/resultados, instrucciones de reproducción y limitaciones. No declarar producción por pasar pruebas de Fase 1; faltan criterios tributarios de fases 2–4.

## Secuencia propuesta después de aprobación

Definir plan ejecutable; preparar repositorio y entorno; migraciones y pruebas de aislamiento; identidad y sesiones; permisos/organización; interfaz conectada; pruebas de integración y revisión de seguridad; entrega de avance reproducible. El implementador decide detalles rutinarios de componentes, versiones compatibles y nombres de rutas, documentándolos. Antes de desplegar servicios conectados se resolverán proyecto Supabase, hosting Node, dominio, SMTP y costos; eso no bloquea la implementación local aprobada.
