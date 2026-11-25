# Evidencia de Facturación nacional STAG — 25/11/2026 (Costa Rica)

## Resultado implementado

Facturación agrega preparación desde el editor fiscal existente, opciones contado/crédito, pagos, USD explícito, detalle de totales y conservación de receptor ocasional o registrado. Una copia preparada se actualiza expresamente con versiones; un comprobante emitido queda inmutable. Listados ligeros, aislamiento por empresa/departamento y permisos separados para preparar, emitir y descargar.

Se integraron numeración STAG confirmada por el propietario, reserva atómica, clave de50 dígitos, XAdES-EPES RSA en worker aislado, validación completa FE/MensajeHacienda contra XSD oficial1.1 offline, verificación criptográfica independiente, transporte oficial de recepción/consulta, artefactos privados con hashes, PDF con ₡ y entrega SMTP. Un HTTP201 nunca marca aceptación fiscal; una respuesta solo puede finalizar tras XSD, clave/identidades/importes y firma con confianza explícita.

La cola PostgreSQL usa leases, fencing, intentos limitados y recuperación de consultas. Antes del POST se persisten bytes firmados y una frontera incierta. Consultar/reintentar no crea otro comprobante. El reenvío confirmado crea una entrega independiente e idempotente; incertidumbre SMTP impide repetirla automáticamente. Se corrigió una carrera de creación del primer trabajo: acciones, pipeline y recuperación comparten un advisory key canónico, incluso con UUID en mayúsculas.

Correo automático exige `send_email=true` congelado en la copia. Se conservan estados separados y auditoría mínima sin copiar XML, receptor ni credenciales en detalles de eventos. Cuentas por cobrar mantiene el vínculo con la tarea departamental del borrador, sin generar deuda al contado.

## Verificación

- `npm test`: **340 aprobadas**,62 archivos; ejecución final local registrada en `.local/fe-emission/publication-suite.log` (25/11/2026 12:50 UTC).
- `npm run typecheck` y `npm run build`: aprobados. También se comprobó el build con `NODE_ENV=production` y preparación del motor XML por hashes.
- `npm run test:db`:9 comprobaciones SQL/RLS aprobadas.
- `npm run test:xml-validator`:6 comprobaciones Python aprobadas.
- Navegador: preparación API real y persistencia, edición, confirmación de numeración y acciones manuales; computadora y Android simulado. **12 aprobadas**, con confirmación de acciones conservada al refrescar el detalle (`.local/fe-emission/resume-browser.log`).
- SMTP local real: captura Mailpit con XML/PDF/respuesta sintéticos y tres adjuntos MIME; ningún correo se envió a una persona real.
- Firma real con claves sintéticas y verificación independiente Python lxml/cryptography; modificación de contenido/SignedProperties rechazada.
- Ejemplo fiscal comprobado:2×CRC1000 sin descuento, subtotal2000, IVA260, total2260, coincidente entre cálculo, servidor, XML y PDF.

La primera suite general identificó pruebas antiguas de administración sin operador explícito; se corrigieron fixtures y se conservó la prueba de denegación a no propietarios. La cola global necesitó aislamiento de trabajos sintéticos de otros archivos; no se añadió un filtro por empresa a la cola de producción.

## Migraciones aditivas

1. `20261124213845_national_invoice_preparation.sql`: copias fiscales y permiso de emisión.
2. `20261124214503_emission_jobs.sql`: cola privada.
3. `20261124214507_prepared_invoice_editing.sql`: actualización versionada de preparados.
4. `20261125010329_emission_worker_access.sql`: capacidades de trabajos y artefactos privados.
5. `20261125010826_invoice_download_permission.sql`: descarga autorizada.
6. `20261125011021_emission_recovery_scan.sql`: consultas de transmisiones inciertas.
7. `20261125011324_emission_issuance_control.sql`: numeración confirmada, emisión inmutable y actor emisor.
8. `20261125011503_invoice_artifact_metadata.sql`: disponibilidad de archivos sin exponer contenido.
9. `20261125012351_invoice_state_audit.sql`: auditoría de estados sin secretos.
10. `20261125013502_invoice_manual_actions.sql`: acciones idempotentes y entregas explícitas.
11. `20261125013851_serialize_emission_job_creation.sql`: concurrencia segura incluso antes de existir un trabajo.

No se asignaron impuestos a documentos anteriores ni se reiniciaron consecutivos históricos. No se crearon servicios pagados.

## Límites y activación pendiente

`HACIENDA_STAG_EMISSION_ENABLED` permanece explícitamente **false** en Render. El inspector de llave aún informa identidad pendiente: falta un contrato oficial verificable que ligue el certificado criptográfico al emisor. También falta aprovisionar, por fuente oficial, la confianza del firmante de respuestas STAG. Ningún valor de prueba se promueve a configuración real.

Faltan identificación real de proveedor del software, credenciales/perfil/numeración de pruebas verificados y configuración SMTP/remitente/destinatario para la demostración real. Las exoneraciones parciales con clasificación que exige precisión adicional no verificada siguen bloqueadas. La fuente PDF incorporada cubre ₡ y español; otros glifos sin cobertura se rechazan expresamente, sin cambiar identidades silenciosamente.

No hubo factura enviada ni aceptada realmente por STAG, ni se declara listo para producción. El cierre exige la evidencia real descrita en `docs/runbooks/national-invoice-stag.md`.

## Publicación

PR preparada: https://github.com/arroyovargass-cyber/Conta-facil/pull/4. Código verificado: `a043575a87527530fee8921567be7378873e46e1`. La revisión automática rechazó fusionar esta PR en la rama principal sin autorización explícita; no se intentó eludirla mediante otra vía de publicación.

Las11 migraciones se aplicaron al proyecto separado `ryobvhcarlpayqzaumdf`, en el mismo orden del listado anterior. Versiones remotas: `20261125125544`, `20261125125550`, `20261125125556`, `20261125125601`, `20261125125605`, `20261125125610`, `20261125125615`, `20261125125620`, `20261125125624`, `20261125125628`, `20261125125632`.

Comprobación remota posterior: RLS activo en electronic_invoices y las cuatro tablas privadas nuevas; el rol authenticated no puede insertar/actualizar facturas ni leer bytes de artefactos o abrir credenciales. Anon no puede abrir credenciales; conta_facil_api solo dispone de la capacidad interna prevista. La tabla histórica de secuencias conserva0 filas antes y después, sin reinicio o modificación. El asesor de seguridad no añadió incidencias: mantiene el aviso previo de protección de contraseñas filtradas deshabilitada en Auth.

Render conserva el plan gratuito y la rama main con auto-deploy desactivado. La configuración de bloqueo de emisión quedó guardada sin reemplazar variables existentes. La versión live observada es `25383998592ceae0e1bf7c14dc5f2cb336efd820`, deploy `dep-dc33mlflot8c738v363g`: corresponde a la versión anterior de la aplicación, no a esta funcionalidad.

Pendiente de autorización: fusionar PR4 en main, desplegarla en Conta Fácil Pruebas y comprobar la nueva aplicación publicada. Esto no autoriza activar emisiones STAG reales o producción ni elimina las dependencias oficiales pendientes.
