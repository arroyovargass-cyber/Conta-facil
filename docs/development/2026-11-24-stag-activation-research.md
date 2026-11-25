# Public-source STAG activation research — 2026-11-24

Research only. No runtime allowlist, manifest, source, credentials, or dependency changes. All network requests were anonymous GETs. HTTP evidence below came from Python urllib with `User-Agent: curl/8.0`, network permission enabled, no authentication. Browser/search retrieval was used separately to inspect official documentation. Earlier 403/404 results do not establish permanent unavailability.

## Reception endpoint

The current official [Anexos y Estructuras 4.4](https://www.hacienda.go.cr/docs/ANEXOS_Y_ESTRUCTURAS_V4.4.pdf), page 97 of 99, explicitly names the test base URI:

`https://api.comprobanteselectronicos.go.cr/recepcion-sandbox/v1/`

This is a verified documentary URL, not a guess. The uploaded annex also contains it at extracted lines 4091–4092. The uploaded standalone API guide names the production base only and does not establish a different STAG base.

Current operational availability remains unresolved: anonymous GET of that base plus `recepcion` returned HTTP403. Third-party material claims `https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1/` is the newer working sandbox, but an official Hacienda source endorsing that replacement was not found, and anonymous GET of its `recepcion` resource also returned HTTP403. Do not infer migration or working authenticated reception from these responses. No credential request or invoice transmission was performed.

## Current official XML 4.4 bytes

The [ATV index](https://atv.hacienda.go.cr/ATV/ComprobanteElectronico/frmAnexosyEstructuras.aspx) lists nine v4.4 XSDs, but its FE and Hacienda-message links under `ATV/ComprobanteElectronico/docs/esquemas/2024/v4.4/` still return404. Public files on `https://www.hacienda.go.cr/docs/` succeed with the filename paths below. The OVi public page exists but returns a JavaScript loading shell in text retrieval; this research does not claim to have independently reconstructed its rendered link chain.

All following direct official-host GETs returned200 on 2026-11-24. XSD response type was application/octet-stream; the FE/MH bytes were inspected as XML. All Last-Modified dates were 2026-04-22.

| Path under `https://www.hacienda.go.cr/docs/` | Bytes | SHA-256 |
| --- | ---: | --- |
| `FacturaElectronica_V4.4.xsd` | 119689 | `926ba81325bc21102755bd8e4e570a63caaca086e680a877c3a6d15d6ee8a62f` |
| `MensajeHacienda_V4.4.xsd` | 7799 | `b2606156042b7aa7b7f7f61945f0ff1323661b43b5a1489ad5eafad1c52fd25e` |
| `MensajeReceptor_V4.4.xsd` | 6564 | `b883e3a9321eadf2ccc1a9dc853d9e3bd483918dcd6e2152d902ddf2f244365f` |
| `NotaCreditoElectronica_V4.4.xsd` | 123011 | `b7ed3347c5599e78e5683d9ae83842695ab9497e173df9cd3be8d77c0851f556` |
| `NotaDebitoElectronica_V4.4.xsd` | 123029 | `3709389ccc434fb1ef4571079b1a628654fa04f07c1f3f1044b2416ba12eb7ff` |
| `TiqueteElectronico_V4.4.xsd` | 117940 | `d7783baf818f316596d0b58b17481be689595982a248d98102d707f72967ae6e` |
| `FacturaElectronicaCompra_V4.4.xsd` | 97300 | `57e4cedb12d5045884670ff2e4795d2027e69b96d45752f60cd1a1930e2768a3` |
| `FacturaElectronicaExportacion_V4.4.xsd` | 101881 | `e571d8296bb74e86cb9ef7889601844c61ac50bedca90aa8d52badf15198242e` |
| `ReciboElectronicoPago_V4.4.xsd` | 41655 | `86e3aa5f0615b757a3b2e9c300973d573ac321f76adba7b4b05e59d854da82b7` |

FE bytes match the uploaded FE hash exactly. Both FE and MH import `http://www.w3.org/2000/09/xmldsig#` using `../../xmldsig-core-schema.xsd`. Resolving that relative import against the successful official download location yields `https://www.hacienda.go.cr/xmldsig-core-schema.xsd`, which returned404. A complete pinned offline dependency graph remains required; do not permit runtime network resolution or treat the nine successful downloads as a complete dependency package.

The current annex PDF returned200, application/pdf, 1,243,035 bytes, Last-Modified `Wed, 13 May 2026 15:26:07 GMT`, SHA-256 `6e093226b29b38c5c8de825f70c1b1cb8ed81e2f4a6eb0b3ff52708fc1eb2769`. Its page3 includes the 22/04/2026 adjustment log and the September2025 effective date. Do not substitute the older legal-register HTML annex, which still shows earlier text/placeholders.

## Signature policy: byte hash verified

The exact identifier in current official annex examples (pages88–95) is:

`https://cdn.comprobanteselectronicos.go.cr/xml-schemas/Resoluci%C3%B3n_General_sobre_disposiciones_t%C3%A9cnicas_comprobantes_electr%C3%B3nicos_para_efectos_tributarios.pdf`

Anonymous GET of this exact URL succeeded200 with application/pdf, 163,479 bytes, Last-Modified `Wed, 08 Jan 2025 21:29:12 GMT`. SHA-256 of downloaded PDF bytes:

`0d6c629f5c5639e23c3ae5905dace1e158cb5806822c003de787a6ec3321d21f`

Base64 of those same digest bytes:

`DWxin1xWOeI8OuWQXazh4VjLWAaCLAA954em7DMh0h8=`

This exactly matches the annex example `SigPolicyHash` using `http://www.w3.org/2001/04/xmlenc#sha256`. This is a byte verification, not a copied example digest. The identifier URL must stay literal; no substitute document or reconstructed PDF was used.

Temporary research copies: `/tmp/stag-research-0` annex, `-1` FE XSD, `-2` MH XSD, `-6` policy PDF. These are temporary evidence for a subsequent reviewed vendoring step; this task intentionally changed only this research note.

## Remaining activation gates

- Preserve `runtime_use_allowed: false` until a separately reviewed manifest/dependency update and local validation establish the complete pinned graph.
- Resolve the documented-vs-reported sandbox URL discrepancy from an authoritative source or authorized integration validation; HTTP403 alone cannot settle it.
- Authenticated STAG access, fiscal signature verification, emitter/key correspondence, confirmed numbering, and the actual accepted-invoice circuit were not tested by this public-source research.
