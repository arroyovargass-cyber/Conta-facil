# Avance verificable: ambientes de Hacienda

Plan: `docs/superpowers/plans/2026-11-25-hacienda-pruebas-produccion.md`.
Base: `8788073fd834cb69ebd9720a2981b278fffbe091`. Rama: `feat/hacienda-pruebas-produccion`.

- Decisión del usuario: posee credenciales separadas; acepta procedencia de API oficial HTTPS más XML/firma/correlación. No se está afirmando validación independiente PKI del firmante.
- Regla: no envío ficticio en producción; banderas desactivadas por defecto; no autenticaciones oficiales con credenciales reales durante pruebas automáticas.
- Interfaces compartidas: evidencia final nace después de verificar XML; `response_trust_policy` fijada al emitir; `Job.environment` derivado del documento; revisión de llave `operator_verified` por versión/huella/identidad/ambiente.
- Configuración: dos pruebas nuevas fallaron por ausencia de propiedades; tras implementación, 8/8 verificaciones de configuración pasan.
- Pipeline: pruebas RED→GREEN de rutas por ambiente, política conservada y evidencia. La revisión encontró un bloqueo por la política predeterminada actual; se corrigió con elegibilidad por documento antes de reclamar el trabajo.
- PDF y correo: pruebas RED→GREEN del ambiente, texto y metadatos; los correos de pruebas llevan la marca PRUEBAS. No cambia la seguridad TLS del transporte SMTP.
- Trabajo en paralelo en archivos separados: transporte/respuesta; custodia/revisión; persistencia/cola; API emisión; interfaz. Integración de base de datos y navegador se ejecutará de forma serial.

## Rulings

- Revisión administrativa expresa en lugar de asignar `identity_status=verified`: no existe en los documentos consultados una regla oficial validada que permita inferir correspondencia tributaria del CN. Costo: requiere responsabilidad explícita del administrador; no sustituye validación tributaria de Hacienda.
- Guardar política de respuesta en cada emitido: evita que un cambio posterior de configuración convierta silenciosamente una factura de política por huella en otra por procedencia HTTPS. Facturas anteriores conservan política por huella.
- Evidencia sintética nunca se inserta como evidencia oficial en SQL; pruebas unitarias usan dependencias inyectadas solo en Node test. Costo: integración SQL usa fixtures marcadas internamente y no prueba TLS real de Hacienda.

## Verificación local y revisión

- Task 1 completo: 50 pruebas de perfiles, IdP, token, HTTPS, XSD y respuesta. Sin peticiones oficiales autenticadas.
- Task 2 completo: 7 pruebas unitarias y 30 de integración de custodia/revisión/conexión; revisión administrativa inmutable, sin sustituir identity_status pendiente.
- Task 3 completo: 20 pruebas de cola, capacidades y aislamiento; además, regresión de elegibilidad de política por documento. Las tres migraciones se aplicaron primero en PostgreSQL local.
- Task 4 completo: 46 pruebas focalizadas de API/servicio/dominio; bloqueo compartido de empresa entre revisión y reserva, versión fresca y permisos reales de ruta de emisión.
- `npm test`: 70 archivos, 429 pruebas aprobadas en la ejecución final de 23:16:56 UTC (102,48 s). Una ejecución anterior detectó únicamente una expectativa de nombre de marca desactualizada y se corrigió antes de la ejecución final.
- `npm run typecheck`: aprobado tras todos los cambios de código.
- `NODE_ENV=production npm run build`: aprobado; bundle final `index-C9aFFK9W.js`.
- `npm run test:db`: 9/9 controles SQL/RLS aprobados.
- `npm run test:xml-validator`: 6/6 controles Python aprobados.
- Revisión independiente: hallazgo de política conservada corregido y revalidado; sin bloqueos restantes. La revisión no ejecutó pruebas fiscales reales.
- Navegador: primera ejecución amplia 58 aprobadas, 6 fallos y 8 sin ejecutar. Se corrigió una etiqueta accesible de select, se limitó un localizador ambiguo de estado y se actualizaron dos fixtures de mutación para representar al superadministrador. Una ejecución intermedia detectó dos selectores obligatorios que debían conservar el asterisco accesible; se corrigió la etiqueta sin cambiar validaciones ni permisos. Ejecución final de escritorio/teléfono: **72/72 aprobadas**, 3,3 minutos.
- El propietario eligió la marca visible Conta Ágil y proporcionó identificación de proveedor para configurarla en el servidor, sin incrustarla en el código. Se preservan los espacios de cifrado y cookies para compatibilidad.
- Estado remoto previo: una configuración activa de pruebas con conexión sin probar, sin facturas electrónicas preparadas/emitidas; producción todavía sin credenciales registradas. Sin secretos consultados.

## Migraciones de esta entrega

1. `20261125173658_hacienda_environment_enrollment.sql`: custodia y revisión administrativa por ambiente.
2. `20261125173701_invoice_environment_evidence.sql`: documentos, numeración, cola y evidencia inmutable por ambiente.
3. `20261125230940_invoice_job_trust_policy_selection.sql`: selección de trabajos por política conservada, exclusivamente interna.

- La preparación de código y validaciones locales está completa. Publicación de la rama, migraciones remotas y despliegue se registrarán como operaciones separadas; no se ha enviado una factura real ni correo externo.
