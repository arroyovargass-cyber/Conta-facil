# Lectura segura de XML antes de recepción/validación

Incremento independiente de las reglas fiscales: inspección de XML de factura
4.4 en backend, sin persistencia, aceptación ni transmisión. No desbloquea XSD.

- Parser SAX estricto con namespaces; saxes 6.0.0 fijado y lockfile actualizado.
  Su documentación confirma que no carga DTD ni resuelve entidades externas.
- Rechazar cualquier DTD e instrucción de procesamiento; aceptar únicamente
  UTF-8 y XML 1.0 en este primer perfil. Límites internos: 2 MiB, 64 niveles,
  20 000 elementos y 64 atributos por elemento. No son límites de Hacienda.
- Raíz FacturaElectronica y namespace oficial fijado en el manifiesto revisado.
  Reconocer esa raíz no demuestra validez, autenticidad ni pertenencia al tenant.
- Resultado seguro: códigos, sin texto de proveedor/cliente ni valores del XML.
  XSD no ejecutado y emisión deshabilitada incluso al estar bien formado.
- Casos: XXE local/remoto, expansión de entidades, XML malformado, namespace
  incorrecto, codificación inválida y límites de recursos. Suite/build al cerrar.

Investigación 23/11: W3C publica su esquema xmldsig de 2002, pero contiene un
DOCTYPE; se conserva solo como candidato en /tmp. No se incorporó ni aprobó
como dependencia de Hacienda. OVi carga páginas públicas mediante un frontend
que comparte operaciones CMS; no se llamaron operaciones de modificación CMS.
El navegador nuevo no pudo abrir OVi por ERR_CERT_AUTHORITY_INVALID; no se
desactivó la validación TLS para tratar ese contenido como fuente confirmada.

## Verificación y uso

`npm run fiscal:xml:inspect -- /ruta/al/archivo.xml` retorna JSON y código 0 si
el archivo está bien formado y usa la raíz/namespace FE soportados. Retorna
código 1 al bloquear. Incluso con código 0 no se validó XSD, firma, receptor,
CABYS, impuestos ni estado de Hacienda. No tomar ese código como aceptación.

El comando abre únicamente el archivo solicitado, rechaza enlaces simbólicos
en el componente final y archivos no regulares, y limita la lectura a 2 MiB+1
antes de emitir diagnóstico. No hay consulta de red ni endpoint de recepción.

Resultado: 33 archivos y 160 pruebas aprobados en 42,09 segundos, build completo,
comprobación de tipos de CLI, formato y git diff --check aprobados. Catorce casos
nuevos cubren lector XML. Prueba real de CLI con archivo sintético: código 0;
con enlace simbólico al mismo archivo: código 1 y XML_FILE_UNREADABLE. Auditoría
npm de dependencias de producción: cero vulnerabilidades reportadas.

La primera instalación npm falló por caché de HOME de solo lectura; se utilizó
/tmp/conta-npm-cache. No se cambió HOME ni se instaló software del sistema.
Se observó fallo de pruebas por módulo nuevo ausente antes de implementarlo.
No se modificaron datos alojados ni se publicó este incremento en Render.

## Lo que continúa pendiente para terminar la facturación

1. Confirmar el paquete XSD oficial vigente, resolver dependencias y escoger
   motor XSD1.1 con resolución offline controlada.
2. Capturar perfil fiscal estructurado, catálogos oficiales y reglas de redondeo
   pendientes; generar XML y numeración con idempotencia por empresa/ambiente.
3. Implementar y comprobar firma XAdES real; no insertar firmas sintéticas para
   presentar un XML como conforme.
4. Colas de transmisión STAG, consulta definitiva, recuperación y evidencias;
   luego PDF/correo y extensión a los demás tipos de comprobante.
5. Conectar esta inspección a recepción y cuarentena bajo permisos/RLS, verificar
   receptor y duplicados, y generar mensajes del receptor cuando corresponda.

Estas etapas siguen abiertas. El acceso del administrador es otro pendiente
operativo; no se envió invitación como parte de esta entrega.
