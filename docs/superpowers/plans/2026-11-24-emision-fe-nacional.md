# Emisión FE nacional — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrar preparación, emisión nacional 4.4, conservación fiscal y entrega al cliente desde los borradores existentes.

**Architecture:** Copia fiscal inmutable por empresa y departamento; artefactos privados y cola PostgreSQL duradera. Separar preparación, firma, transmisión, resolución y correo. Reutilizar cálculos y editor existentes.

**Tech Stack:** React, TypeScript, Fastify, PostgreSQL/Supabase; XMLDSig/XAdES, XSD1.1 offline, PDF y SMTP de servidor.

**Spec:** docs/superpowers/specs/2026-11-24-emision-fe-nacional-design.md (aprobado por el usuario el 24/11/2026).

## Global Constraints

- Factura electrónica nacional primero; producción no se activa por superar STAG.
- Mitad hacia arriba en las líneas, cinco decimales fiscales y suma de líneas para totales.
- Ningún secreto en navegador, registros o repositorio; ninguna respuesta simulada se presenta como aceptación real.
- No enviar por guardar un borrador; correo automático después de aceptación comprobada.
- Mantener tenant_id, autorización departamental y la administración exclusiva del propietario con MFA.

## Review Focus

- Doble clic y reintentos deben devolver el mismo documento y conservar numeración.
- Cambios posteriores en catálogos no alteran copias fiscales ni artefactos.
- Revocar permisos detiene nuevas emisiones; recuperación de respuestas conserva documentos ya enviados.
- Fallos o timeout de red no generan nuevas claves ni duplican correo automáticamente.
- Respuesta con otra clave, firma alterada o recursos XML externos nunca establece aceptación.

---

### Task 1: Preparación fiscal y opciones de venta
**Files:** packages/domain/src/emission.ts; tests/emission.test.ts.
**Interfaces:** `emissionOptionsInput`, `EmissionOptions`, `prepareEmission({document_type,currency,receiver,lines,options})` devuelve opciones, totales e incidencias.
- [x] Escribir y ejecutar pruebas RED: CRC2260, USD sin tipo, pagos incorrectos, crédito y datos incompletos.
- [x] Implementar con motor decimal existente y códigos contrastados; ejecutar pruebas GREEN.

### Task 2: Documentos preparados privados e interfaz
**Files:** nueva migración national_invoice_preparation; apps/api/src/modules/emission.ts; tests/integration/emission.test.ts; apps/web/src/features/billing/Invoices.tsx; BillingWorkspace.tsx; app.tsx.
**Interfaces:** GET/POST `/companies/:tenantId/invoices`, GET `/:id`, POST `/:id/issue`. Preparación recibe operation_id, draft_id, expected_version y options. Devuelve item con snapshot, estados separados y readiness. Emisión exige versión y operación idempotente.
- [x] RED: persistencia/snapshot, versión obsoleta, idempotencia y aislamiento por empresa/departamento.
- [x] Crear tablas con referencias compuestas y RLS; reconstruir totales exclusivamente en servidor.
- [x] Añadir Facturación y continuar desde editor existente; mostrar incidencias y confirmación STAG.
- [x] GREEN integración y navegador; impedir emisión mientras falten dependencias reales.

### Task 3: XML y firma verificables
**Files:** services/invoice-xml.ts; security/invoice-signature.ts; tests/invoice-xml.test.ts; tests/invoice-signature.test.ts; docs/reference/hacienda/v4.4.
**Interfaces:** generador desde copia fiscal; `signInvoiceXml(xml,material)` y `verifyInvoiceSignature(xml,certificate)`.
- [x] RED: XML2260, caracteres especiales, tipos tributarios y modificación de datos firmados.
- [x] Contrastar paquete oficial, fijar dependencias/política y generar XML ordenado; firma real enveloped EPES.
- [x] GREEN: validación XSD1.1 sin red y verificación criptográfica independiente.

### Task 4: Numeración y procesamiento recuperable
**Files:** migración de secuencias/cola; services/emission-jobs.ts; services/hacienda-reception.ts; pruebas de concurrencia y transporte.
**Interfaces:** reserva atómica por ambiente/empresa/terminal; trabajos con lease y token; transporte oficial STAG con resultados tipados.
- [x] RED: dos reservas concurrentes, expiración/reclamación, timeout/reconciliación, revocación.
- [x] Implementar autorización interna de trabajos sin falsificar sesión, artefactos privados inmutables y hashes.
- [x] GREEN: mismo consecutivo/clave/bytes ante reintento y estados definitivos solo con respuesta verificada.

### Task 5: Representación y correo
**Files:** services/invoice-pdf.ts; services/invoice-mail.ts; descargas y acciones de Facturación; pruebas PDF/SMTP.
**Interfaces:** PDF desde snapshot; correo con XML firmado, PDF y respuesta real, remitente configurado por servidor.
- [x] RED: coincidencia2260, adjuntos, autorización de descarga, estado SMTP incierto sin duplicado automático.
- [x] Implementar artefactos y entrega mediante cola; enlazar bandeja departamental CxC sin generar deuda al contado.
- [x] GREEN: captura local SMTP, navegador y pruebas integradas.

### Task 6: Revisión y activación de pruebas
**Files:** docs/development/emission-evidence.md y runbook.
- [ ] Revisar código y seguridad; ejecutar typecheck/build y pruebas correspondientes, registrar fallos materiales.
- [ ] Publicar cambios verificados; completar identificación del proveedor, emisor/llave, secuencias, SMTP y autenticación STAG mediante canal seguro.
- [ ] Demostrar aceptación real STAG y correo al destinatario de pruebas antes de declarar terminado el circuito.


Avance: programación y pruebas locales del circuito integradas. La activación real permanece bloqueada por identidad del certificado y confianza del firmante de respuesta. Consultar `docs/runbooks/national-invoice-stag.md`; no se declara completado el cierre STAG. Reintentos técnicos seguros y reenvío manual explícito incluidos con confirmación, idempotencia y límites; la bandeja existente conserva vínculo por el borrador de origen.
