# Datos fiscales y venta rápida — 23 de noviembre de 2026

## Entrega implementada

- Clientes con identificación, nombre comercial, actividad, contacto, domicilio y datos de exoneración. Los registros anteriores conservan sus datos.
- Borradores con receptor registrado o venta rápida. El receptor ocasional queda en el comprobante sin depender de un cliente permanente; guardar en Clientes es opcional y está desmarcado inicialmente. El guardado opcional verifica permisos y duplicados dentro de la empresa.
- Copias de los datos del receptor y de las líneas en cada borrador. Cambiar el catálogo no cambia documentos ya guardados; las modificaciones expresas del borrador sí se permiten.
- CABYS por código o descripción mediante la API pública de Hacienda, consulta de identificación con revisión manual, divisiones territoriales del archivo oficial aportado y unidades del XSD. Las consultas fallidas permiten continuar el registro manual.
- Configuración revisable por producto y por línea: CABYS, unidad, cantidad, precio antes de impuestos, descuento, tratamiento tributario, código de tarifa de IVA y exoneración documentada.
- Desglose por línea y general, calculado con aritmética decimal entera compartida por interfaz y servidor. El imprimible utiliza el registro guardado y está identificado como borrador sin validez tributaria.
- Borradores incompletos, control de versiones, creación idempotente, acceso por empresa y departamento, y escape de contenido en el imprimible.

## Política de cálculo confirmada por el usuario

Mitad hacia arriba a cinco decimales en la línea. Los totales suman los importes redondeados de las líneas sin un redondeo adicional de cabecera. Esta es la política confirmada para esta aplicación; no se presenta como una regla normativa general.

Caso verificado: 2 unidades × ₡1.000 = subtotal ₡2.000; IVA 13 % = ₡260; total ₡2.260. La pantalla, el servidor, el borrador reabierto y el imprimible coinciden.

Los importes de IVA se muestran antes de exoneración, con la exoneración separada. Las operaciones exentas, no sujetas y gravadas al cero por ciento conservan tratamientos diferentes. No se asigna automáticamente un IVA del 13 %.

## Migraciones

Aplicadas y verificadas localmente y, posteriormente, en **Supabase Pruebas `ryobvhcarlpayqzaumdf`**:

1. `20261123200903_invoice_fiscal_quick_sales.sql`: campos fiscales, configuración de productos, receptor ocasional, cliente opcional, líneas incompletas y totales calculados.
2. `20261123201844_receiver_fiscal_conditions.sql`: domicilio y condiciones de actividad y correo del receptor.

Los campos fiscales históricos quedan sin clasificación cuando no existían; no se imputan impuestos retroactivos. Se mantienen las restricciones y políticas de aislamiento existentes. En Supabase, los identificadores generados por el servicio son `20261123211414` y `20261123211428`, respectivamente; no volver a aplicar estos SQL por tener otra marca de tiempo local.

## Fuentes

- Estructuras y anexos: https://atv.hacienda.go.cr/ATV/ComprobanteElectronico/frmAnexosyEstructuras.aspx
- API pública de consulta: https://api.hacienda.go.cr/docs
- XSD aportado: `docs/reference/hacienda/v4.4/FacturaElectronica.uploaded-20261123.xsd`, SHA-256 `926ba81325bc21102755bd8e4e570a63caaca086e680a877c3a6d15d6ee8a62f`.
- La procedencia y huella del catálogo territorial se conservan en `docs/reference/hacienda/v4.4/locations.provenance.json`.

Las tasas no se infieren de una descripción o un CABYS. La consulta facilita el llenado; el tratamiento requiere revisión. Las autorizaciones especiales de exoneración no verificadas se señalan como pendientes.

## Verificación ejecutada

- `npm test`: 207 pruebas aprobadas en 38 archivos.
- `npm run test:db`: 9 verificaciones de seguridad de base de datos aprobadas.
- Playwright, suites existentes de borradores y vista fiscal: 20 pruebas aprobadas en computadora y móvil.
- Playwright, `invoice-fiscal.spec.ts`: 4 pruebas aprobadas en computadora y móvil, incluyendo total, reapertura, imprimible y descarte de consultas que llegan después de una edición manual.
- Compilación de producción y comprobación TypeScript aprobadas; `git diff --check` sin errores.

Las pruebas cubren cliente registrado, venta ocasional con y sin guardado, duplicados, tarifas distintas, descuentos ordinarios, exoneración parcial, borradores incompletos, datos históricos, ubicación inválida, permisos, separación entre empresas, reintentos simultáneos y rechazo de totales suministrados por el cliente HTTP.

La revisión independiente detectó dos problemas corregidos: una consulta tardía podía sobrescribir ediciones del receptor, y el imprimible omitía el domicilio extranjero. También se corrigieron los selectores, la preparación de un departamento y la capitalización esperada en las pruebas de navegador antes de la ejecución final satisfactoria.

## Límites y publicación pendiente

Esta entrega completa la preparación fiscal de borradores para el perfil de IVA implementado. No habilita todavía la emisión electrónica real. Otros impuestos, otros cargos y descuentos especiales por regalías o bonificaciones (códigos 01–03) no están implementados; los descuentos especiales se bloquean para evitar un cálculo incorrecto.

Falta conectar la generación del XML del comprobante con estos datos, validar ese XML contra el XSD oficial, firmar, transmitir al ambiente de pruebas y comprobar la respuesta definitiva. La herramienta existente de diagnóstico XML no sustituye ese flujo. El sistema mantiene `canEmit: false` y no presenta un comprobante como aceptado por Hacienda.

El bloqueo de GitHub 403 se resolvió. Se conservó el historial y los ZIP subidos manualmente al integrar el árbol completo verificado. La rama `fiscal-quick-sales` se publicó y la solicitud https://github.com/arroyovargass-cyber/Conta-facil/pull/1 se integró en `main`, commit `22f5bba839da2f59c78df07f20d4fdcdf1e8be3c`.

Después de las migraciones alojadas se verificaron los nuevos campos, la nulabilidad de cliente y líneas incompletas y las cuatro tablas con RLS activo y sin lectura anónima. No se crearon clientes ni comprobantes de prueba en la base alojada. El asesor de seguridad no detectó problemas nuevos de las tablas; conserva el aviso previo de protección de contraseñas filtradas desactivada (https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

El servicio Render existente `srv-dbudpelg1s2s73bi7cj0` conserva el plan gratuito, rama `main` y despliegue automático desactivado. El despliegue anterior `dep-dc24n197lnhs7393sjrg` sigue en estado `live`; no equivale a publicación de esta entrega. Falta cambiar su Build Command, que todavía extrae el ZIP antiguo, por:

```sh
npm ci --include=dev && npm run openssl:prepare && npm run build && npm prune --omit=dev
```

El conector Render disponible no ofrece actualización del Build Command y no hay credenciales API Render ni herramienta de navegador de escritorio disponibles en esta sesión. Se solicitó al usuario ese ajuste puntual en el panel del servicio. No se lanzó deliberadamente otro despliegue con el comando antiguo. Tras guardar el cambio, se debe desplegar `main`, esperar estado `live` y comprobar health, HTML y que el bundle publicado contenga el formulario nuevo. No se declara publicado antes de esa verificación.
