# Actualización incremental de facturación

Prioridad reparada en PR #6: esquema Auth administrado no accesible al rol
NOINHERIT. Las comprobaciones de factura leen los claims verificados de la
transacción y conservan RLS, sesión, empresa, departamento, creador y MFA.
430 pruebas, build de producción y revisión independiente aprobados.

## Bloques y contratos compartidos

1. Reutilizar los cálculos decimales y el editor existente; ampliar descuentos,
   cargos, datos de línea y resumen. Mantener half-up a cinco decimales por línea.
2. Persistir opciones comerciales y cargos en el borrador, y congelarlos en la
   preparación. Migraciones aditivas: sin reclasificar documentos históricos.
3. Agregar perfil TE explícito, numeración independiente por tipo y XSD oficial.
4. Organizar las secciones del editor actual; completar emisor y receptor desde
   datos autorizados. Actividades de seis caracteres, conservando el punto.
5. Separar permisos de creación, edición, archivo, emisión, consulta y descarga.
   Validar integración, aislamiento, XSD y UI antes de publicar.

Contrato para evitar implementaciones duplicadas:

- `draft.commercial`: `emissionOptionsInput`, con valores incompletos admitidos;
  `draft.other_charges`: `OtherChargeInput[]`. Los datos pertenecen al borrador y
  luego a `snapshot`; las opciones de numeración/pago se conservan en `options`.
- Modalidades: `registered`, `occasional`, `consumer_final`. La última requiere
  una elección explícita de TE. No inventar identificación ni convertir FE
  silenciosamente. Receptor vacío TE se omite del XML.
- `otherChargeInput`: `code`, `other_description`, `description`,
  `third_party_type`, `third_party_identification`, `third_party_name`,
  `mode` (`amount`/`percentage`), `amount`, `percentage`, `percentage_base`.
  La base porcentual es comercial y explícita; no se inventa una base tributaria.
- Nuevos campos fiscales de línea: `internal_code`, `commercial_codes`
  (`{type,code}[]`), `transaction_type`, `vin_numbers`, `medicine_registration`,
  `pharmaceutical_form`, `discount_mode`, `discount_percentage`, `other_taxes`.
  Campos anteriores y valores de documentos existentes se conservan.
- `calculateInvoice(lines, otherCharges = [])` mantiene los importes existentes
  y añade cargos calculados, `otherCharges`, `ivaReturned` y resumen por clase.
  La base comercial de línea sigue siendo `base`; la base de IVA es `tax_base`.
  Cada línea expone sus impuestos calculados para evitar cálculos paralelos XML/UI.
- `prepareEmission` acepta FE/TE y cargos; el XML usa `snapshot.document_type`
  (FE por compatibilidad si falta), `snapshot.other_charges` y cálculo congelado.
- `invoice-options` incorpora `issuer`, `activities`, `terminals`, y capacidades
  por departamento (`can_create`, `can_edit`, `can_delete`, `can_query`). No secretos.
- Numeración: agregar `document_type` FE/TE al identificador de secuencia privada;
  FE conserva todos sus valores. API de numeración admite tipo con FE por defecto.
- Permisos: `invoices.create`, `invoices.edit`, `invoices.delete`, `invoices.query`,
  `invoices.credit_note`, `invoices.debit_note`; conservar read/emit/download.
  Conservar autoridad de roles existentes mediante migración explícita, sin
  autorizar empresas nuevas ni ampliar membresías o departamentos.

La revisión de cierre separó además `invoices.prepare`, `invoices.email`,
`invoices.numbering` y `reports.read`. Preparar no concede creación/edición;
reenviar no concede emisión; la numeración conserva superadministrador y MFA.
Los estados y resultados definitivos están en [la matriz](billing44-closeout.md).

## Verificación y límites

Pruebas de dinero, FE/TE, cargos, descuentos, receptor ocasional, persistencia,
permisos por acción, doble clic, aislamiento, impresión/XML y firma/XSD.
Ejemplo obligatorio: 2 × 1000, IVA 13% → 2000 + 260 = 2260.
No se envían comprobantes de prueba a producción. La aceptación exige respuesta
auténtica. Regímenes o catálogos no verificados se señalan y bloquean al emitir;
los borradores incompletos se conservan. No se implementa contabilidad general.

## Cierre solicitado el 26 de noviembre

1. Integrar la corrección empresarial local `4feac58`: contexto verificado del
   trigger, filas nuevas vacías, mensajes y pestañas; conservar permisos y auditoría.
2. Verificar configuración fiscal y separar requisitos pendientes de datos de
   defectos del código. No inventar actividades, revisar llaves ni confirmar
   consecutivos por cuenta del propietario.
3. Completar el centro «Requisitos para emitir» desde `emissionReadiness`, las
   acciones existentes y el historial. Los tipos sin circuito normativo completo
   permanecen deshabilitados con explicación.
4. Corregir el consentimiento de correo: dirección de envío y activación son
   datos distintos. Verificar XML, firma, respuestas, PDF y entrega en pruebas
   sintéticas; estas no demuestran una aceptación real de Hacienda.
5. Ejecutar regresiones de servidor y navegador con rol restringido, revisar el
   conjunto y entregar matriz con evidencia y dependencias pendientes.

No aplicar migraciones alojadas, publicar ni habilitar producción sin la
aprobación correspondiente. La aceptación auténtica en pruebas y la entrega
externa requieren el entorno configurado y se documentan por separado.
