# Facturación electrónica nacional: emisión y entrega al cliente

Estado: alcance elegido por el usuario; diseño propuesto para aprobación. No se implementa ni se anuncia emisión operativa con este documento.

## Objetivo y enfoque elegido

Completar el primer circuito real de **factura electrónica nacional 4.4**, integrado con los borradores actuales, usando la API oficial de Hacienda. El usuario eligió FE nacional primero frente a incorporar también tiquetes y notas desde este bloque. Mantener la arquitectura React/TypeScript/PostgreSQL/Supabase y el entorno de pruebas gratuito existentes. Los demás comprobantes se incorporarán después usando los componentes comunes. Producción no se activa como consecuencia de superar pruebas STAG.

No reconstruir el editor ni crear un catálogo de clientes paralelo. Borradores conserva documentos incompletos; Facturación administra documentos preparados para emitir, su evidencia fiscal y su entrega. Un borrador emitido queda vinculado a una copia fiscal inmutable, sin que cambios posteriores en clientes, productos, empresa o credenciales modifiquen el documento histórico.

## Interfaz y flujo

Agregar la sección Facturación, con Nueva factura, continuar desde borrador, lista de emitidas, detalle y estado de Hacienda, descarga XML/PDF/respuesta, reintento técnico seguro y estado del correo. Nueva factura reutiliza receptor registrado/ocasional, líneas CABYS/IVA/descuentos y cálculo decimal actuales. Añadir condición de venta, plazo cuando proceda, medios de pago y desglose de importes, sucursal, terminal, actividad del emisor y tipo de cambio cuando corresponda. CRC y USD se conservan; no suponer tipo de cambio 1 para USD. Campos condicionales sin respaldo normativo o tratamientos no soportados bloquean emisión con explicación, sin impedir guardar borrador.

Acción principal: revisar → validar datos y requisitos → confirmar emisión en STAG → reservar numeración una sola vez → generar XML → firmar → validar y verificar firma → transmitir → consultar resultado definitivo → conservar evidencia → generar PDF y entregar por correo. Mostrar antes de confirmar empresa emisora, receptor, moneda, total, ambiente, departamento y correo destinatario. No enviar un comprobante ni un correo al cliente solo por guardar un borrador.

Estados separados: documento (borrador/preparado/emitido), firma, transmisión (pendiente/enviado/resultado incierto/procesando/error técnico), resolución de Hacienda (pendiente/aceptado/rechazado) y correo (pendiente/en proceso/aceptado por proveedor/error). HTTP201 de recepción no significa aceptación tributaria. Una respuesta SMTP no acredita entrega al buzón. No convertir un rechazo fiscal en error reintentable ni permitir editar XML ya firmado.

## Datos, permisos e idempotencia

Conservar tenant_id y departamento, actor y fecha, versión de origen, copia fiscal del emisor/receptor/líneas/totales, versión de credenciales utilizada, clave, consecutivo, fecha de emisión y hashes de artefactos. Crear relaciones compuestas para impedir referencias entre empresas. Lectura y descarga respetan membresía y permisos departamentales; la condición de máster no concede acceso automático a empresas ajenas. La configuración de emisor, secretos, numeración y correo permanece exclusiva del propietario con MFA; emitir requiere permiso explícito de facturación y ámbito correspondiente.

Ampliar la preparación de secuencias existente para separar ambiente, empresa, sucursal, terminal y tipo de comprobante. Preservar valores previos; revisar su asignación de ambiente antes de utilizarlos. Las reservas son atómicas y no se reutilizan ante errores. La clave y su composición se implementan únicamente con reglas verificadas del anexo, con fecha coherente con Costa Rica y sin truncar identificaciones no soportadas. Identificación del proveedor de software (`ProveedorSistemas`) es configuración explícita del sistema y no se sustituye por la cédula del receptor/emisor sin validación.

Una operación de emisión única y una restricción en base evitan doble clic, reintentos y doble conversión de un borrador. Congelar los bytes firmados antes del primer envío. Ante timeout o resultado incierto, consultar la misma clave y aplicar las reglas verificadas del proveedor antes de repetir; no generar otra clave para ocultar un posible envío recibido. Las respuestas deben coincidir con la clave/documento/empresa esperados y conservarse sin sobrescribir evidencia anterior.

## XML, firma y requisitos oficiales

Reutilizar el motor decimal vigente y la política confirmada: mitad hacia arriba en las líneas, cinco decimales fiscales y suma de líneas para totales. Distinguir bienes/servicios y operaciones gravadas/exentas/exoneradas/no sujetas al formar el resumen XML, siguiendo catálogos y reglas verificados. No inferir impuestos por descripción ni completar códigos inexistentes. Usar el XSD FE aportado, sus dependencias fijadas y un motor compatible con XSD1.1 sin acceso de red durante la validación. No alterar XSD ni añadir firmas de ejemplo para conseguir resultados verdes.

La firma es XAdES-EPES enveloped v1.3.2 o superior, RSA2048/4096 y digest SHA256/512 según el anexo aportado. Verificar criptográficamente XML y SignedProperties con un verificador independiente, resolver localmente referencias y exigir política y certificado aplicables. La inspección PKCS12 ya disponible solo demuestra requisitos técnicos locales; no equivale a validar identidad del emisor, cadena o política fiscal. Los secretos permanecen en la bóveda y procesos acotados; nunca vuelven al navegador o los registros.

Habilitar únicamente destinos oficiales STAG contrastados, sin URLs de receptor/callback enviadas por usuarios. Autenticación/token/renovación/cierre, recepción y consulta tienen límites, manejo de 401/429/5xx y trazabilidad sin tokens. La respuesta XML de Hacienda se procesa con límites, sin entidades ni descargas; verificar estructura, clave, resolución y requisitos criptográficos aplicables antes de declarar resultado definitivo. No confiar en una carga manual ni en un callback sin autenticidad comprobada para marcar aceptación.

## Procesamiento y archivos

Usar trabajos duraderos en PostgreSQL con reclamación atómica, leases, intentos limitados y recuperación de trabajos interrumpidos. Mantener firma, envío, consulta, PDF y correo como pasos recuperables con artefactos privados y hashes. El servicio web gratuito puede ejecutar lotes acotados al recibir una operación o reiniciar; la cola no puede depender de temporizadores en memoria. Si se necesita despertar el servicio inactivo, usar una tarea limitada a trabajos pendientes y un mecanismo de servicio autenticado, sin crear trabajadores de pago. Documentar los límites del plan gratuito y no prometer ejecución continua cuando el servicio duerme.

La autorización del usuario se comprueba al solicitar emisión y antes de iniciar efectos irreversibles. La consulta de un comprobante ya enviado y la conservación de su respuesta son tareas de sistema vinculadas al documento autorizado, no reutilización indefinida de una sesión personal ni falsificación de JWT del usuario. La revocación bloquea nuevas emisiones y nuevos envíos pendientes según su estado; no abandona la recuperación de respuestas de documentos ya transmitidos.

Guardar XML firmado, respuesta de Hacienda y PDF en almacenamiento privado con control por empresa y permisos. El PDF debe coincidir con la copia fiscal, incluir identificación del documento, detalle, moneda, impuestos, totales, referencia de consulta y leyendas verificadas. No usar un imprimible de borrador como PDF de factura emitida.

## Entrega al cliente y cuentas por cobrar

Después de aceptación comprobada, generar automáticamente un trabajo de correo con PDF, XML firmado y respuesta de Hacienda. Esta espera es una política propuesta del producto para evitar presentar documentos pendientes como aceptados; no se afirma que sea un mandato tributario general. Permitir reenvío autorizado e idempotente y registrar destinatario, intentos y resultado real. Un rechazo se muestra al emisor para su corrección mediante el procedimiento y comprobante aplicables; no se entrega como factura aceptada.

Preparar un transporte SMTP configurable en el servidor, con remitente verificado, TLS y secretos privados. Cada empresa tiene nombre y destinatarios propios; no suplantar un dominio no autorizado. Las pruebas iniciales usan captura de correo local y después un destinatario de pruebas confirmado. La configuración del proveedor y del remitente real se completa por canal seguro, sin solicitar contraseñas en chat ni activar servicios de pago automáticamente.

Vincular la factura y su resultado con la bandeja departamental de Cuentas por cobrar existente, conservando origen y permisos, sin convertir automáticamente ventas al contado en deuda. No desarrollar todavía saldos, cobros o asientos contables.

## Evidencia disponible y dependencias de activación

Revisión 24/11/2026: existen borradores fiscales, motor de IVA, empresas y preparación de secuencias, bóveda de pruebas y diagnóstico XML. Faltan generador de factura, firma fiscal, recepción/consulta integrada, PDF fiscal y transporte de correo. El portal oficial ATV respondió200, pero sus enlaces FE4.4 y API devolvieron404; la política PDF referida literalmente por el anexo devolvió403 desde este entorno. El XSD y guía API aportados por el usuario permanecen disponibles. Las divergencias de revisión y límites API/XML requieren contrastarse; no cambiar el manifiesto a runtime habilitado por conveniencia.

Antes de activar el primer envío: paquete XSD/dependencias y revisión confirmados, documento/huella/política de firma verificables, identificación del proveedor de software, perfil completo del emisor y correspondencia de su llave, acceso STAG comprobado, numeración de pruebas confirmada y remitente/transporte de correo de pruebas configurados. Si una dependencia normativa está bloqueada, continuar el código y pruebas independientes; bloquear solo la transición afectada y documentar lo necesario para resolverla. No declarar finalizada la emisión real por pasar pruebas simuladas.

## Verificación y entrega

Pruebas: factura desde borrador y venta ocasional, emisor y receptor válidos, distintas tarifas/descuentos y tratamientos admitidos, monedas y pago; 2×CRC1000+IVA13%=CRC2260 en interfaz/servidor/XML/PDF; XSD completo con firma real sintética, verificación criptográfica y rechazo de alteraciones; doble clic y envíos simultáneos; timeout y reconciliación sin duplicados; respuesta auténtica aceptada/rechazada/pendiente; correo con adjuntos coherentes y reenvío; revocación, aislamiento de empresas/departamentos, archivos privados y recuperación tras reinicio. Las integraciones simuladas se identifican como tales.

Cierre funcional del circuito: demostrar una factura aceptada realmente por STAG, conservar sus evidencias y comprobar el envío al destinatario de pruebas confirmado. Producción requiere autorización y comprobaciones separadas. Entregar resumen breve, migraciones, pruebas, URL cuando se publique y cualquier dependencia todavía pendiente, sin atribuir certificación oficial al sistema.
