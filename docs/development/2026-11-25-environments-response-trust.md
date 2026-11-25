# Official environments and Hacienda response trust

Public-source research checked **2026-11-25 UTC**. This document records published contracts, byte provenance, and a proposed trust design. It does not establish live connectivity or fiscal acceptance. No credentials, private certificates, authenticated Hacienda request, submission, production configuration, or trust store were accessed or changed. Public downloads and inspection files remained in `/tmp/hacienda-env-trust-research`; only this research document was added to the repository.

## Confirmed environment configuration

The [official 4.4 annex](https://www.hacienda.go.cr/docs/ANEXOS_Y_ESTRUCTURAS_V4.4.pdf), Annex 3, printed pages 97–98, publishes the reception bases and production OAuth configuration. The [official IdP guide](https://www.hacienda.go.cr/docs/Guia_IdP.pdf), **page 4's rendered table**, explicitly supplies both realms and both client IDs. That table was inspected visually because PDF text extraction omits its contents.

| Setting | Test / sandbox / STAG | Production |
| --- | --- | --- |
| Reception base | `https://api.comprobanteselectronicos.go.cr/recepcion-sandbox/v1/` | `https://api.comprobanteselectronicos.go.cr/recepcion/v1/` |
| Submit | `POST https://api.comprobanteselectronicos.go.cr/recepcion-sandbox/v1/recepcion` | `POST https://api.comprobanteselectronicos.go.cr/recepcion/v1/recepcion` |
| Query status | `GET https://api.comprobanteselectronicos.go.cr/recepcion-sandbox/v1/recepcion/{clave}` | `GET https://api.comprobanteselectronicos.go.cr/recepcion/v1/recepcion/{clave}` |
| IdP realm | `rut-stag` | `rut` |
| OAuth `client_id` | `api-stag` | **`api-prod`** |
| Token / refresh URL | `https://idp.comprobanteselectronicos.go.cr/auth/realms/rut-stag/protocol/openid-connect/token` | `https://idp.comprobanteselectronicos.go.cr/auth/realms/rut/protocol/openid-connect/token` |
| Logout URL | `https://idp.comprobanteselectronicos.go.cr/auth/realms/rut-stag/protocol/openid-connect/logout` | `https://idp.comprobanteselectronicos.go.cr/auth/realms/rut/protocol/openid-connect/logout` |

The guide documents form-encoded `password` and `refresh_token` grants and logout using the refresh token. `client_secret` and `scope` are unnecessary/blank. Credentials are generated separately for each environment. Its introduction still identifies version 4.2 as current when authored; current hosting alone does not make every example a new 4.4 specification. Production values are independently corroborated by the fetched 4.4 annex. [IdP guide](https://www.hacienda.go.cr/docs/Guia_IdP.pdf), pages 1, 3–9.

The [official API page](https://www.hacienda.go.cr/docs/ComprobantesElectronicosAPI.html) corroborates the production reception base and resource routes. HTTP 201 records technical receipt pending validation. GET returns `ind-estado` and, when available, Base64 UTF-8 `respuesta-xml`; JSON state alone is insufficient evidence of a verified signed response.

No Hacienda source checked here corroborates `api-sandbox.comprobanteselectronicos.go.cr`. Do not substitute that host, declare the published sandbox obsolete, or implement a fallback to a different origin based on third-party integrations. These are **officially published endpoints**, not endpoints tested with credentials during this research.

## Shared 4.4 package and policy

Fresh anonymous downloads match the repository's pinned invoice XSD, response XSD, annex, and signature-policy hashes exactly; see the fetch ledger below. The package uses versioned namespaces, with no environment component. The annex describes separate environment credentials/keys under one format and signature policy. No distinct sandbox XSD or signature-policy artifact was found.

**Implementation inference:** use the same verified 4.4 schema/policy package for both environment profiles. This is supported by the single published package; it does not prove both deployments have identical operational behavior, validation rollout timing, or response signer certificates. Do not duplicate a production schema package by renaming an unverified file. [Official invoice XSD](https://www.hacienda.go.cr/docs/FacturaElectronica_V4.4.xsd), [official response XSD](https://www.hacienda.go.cr/docs/MensajeHacienda_V4.4.xsd), [signature policy](https://cdn.comprobanteselectronicos.go.cr/xml-schemas/Resoluci%C3%B3n_General_sobre_disposiciones_t%C3%A9cnicas_comprobantes_electr%C3%B3nicos_para_efectos_tributarios.pdf).

## What official sources establish about response trust

The annex's Annex 2, printed page 86, says the acknowledgement is signed with the Ministry's persona jurídica certificate. [PGR's published Annex 2](https://www.pgrweb.go.cr/DOCS/NORMAS/1/VIGENTE/S/2020-2029/2020-2024/2024/1936C/1701B8.HTML) corroborates that obligation, although that older text is not used here to override current annex dates or policy URLs.

The API's GET schema describes the response signature as **XAdES-XL**, while outgoing `comprobanteXml` is described as XAdES-EPES. Do not silently apply every outgoing-signature profile restriction to incoming responses. The current response XSD requires exactly one `ds:Signature`. [API GET contract](https://www.hacienda.go.cr/docs/ComprobantesElectronicosAPI.html), [response XSD](https://www.hacienda.go.cr/docs/MensajeHacienda_V4.4.xsd).

The inspected official sources require a signed response and HTTPS/API authentication; **no leaf SHA-256/SPKI pinning requirement was found**. They also do not provide a verified current Hacienda leaf certificate, environment-specific signer roster, exact Ministry subject identifier comparison contract, or rotation overlap schedule. Absence from these sources is a research limitation, not proof that no other authoritative material exists. The annex's personal-certificate signature example is not Hacienda's response signer.

`HACIENDA_RESPONSE_CERTIFICATE_PINS` is consequently an application security policy, not a demonstrated Hacienda protocol field. In the inspected implementation, `emission-control.ts` rejects readiness without pins, `EmissionPipeline.enabled()` blocks work without pins, and `verifyHaciendaResponse()` accepts only exact embedded-leaf DER SHA-256 matches. That creates a bootstrap dependency before the first submission. It must not be resolved by placing a CA fingerprint in a leaf-pin list, trusting the first embedded certificate, or inventing a pin. No such code or configuration change was made here.

## National hierarchy: public bytes and limits

[BCCR's CA page](https://www.bccr.fi.cr/cr/es/firma-digital/informacion-general/certificados-de-la-autoridad-certificadora-ca.html) publishes root and persona jurídica policy serial numbers and 20-byte thumbprints. Downloaded DER SHA-1 values match those published thumbprints exactly:

- Root: `68a24d2b2cb5c4ce9fe300e3b6fcd1dfeeb9c311`, serial `74B8CF638FAB72BC46C1D2BACD00050C`.
- Original persona jurídica policy: `c1c2ca72d130200dad9153afe79990849c07b53b`, serial `4E00000003DEF1A16E0FC7EF05000000000003`.

Those legacy published thumbprints are **SHA-1, not SHA-256**. New SHA-256 values below are locally computed observations. [BCCR's revocation/certificate page](https://www.bccr.fi.cr/cr/es/firma-digital/informacion-general/certificados-y-listas-de-revocacion.html) links issuing certificates and CRLs and describes OCSP. [BCCR's service description](https://www.bccr.fi.cr/cr/es/firma-digital/certificados-de-persona-juridica.html) identifies CA SINPE – PERSONA JURÍDICA as the issuing authority.

The SINPE links in the actual BCCR HTML use HTTP. They returned 200; HTTPS variants returned 503 during the shell fetches and errors/timeouts through the web reader. The BCCR-linked root/policy HTTPS downloads returned 503 too; fetching the same official host/path through HTTP succeeded. Their serial/thumbprint comparisons above used the independently fetched **HTTPS BCCR page**. HTTP download provenance alone was not treated as authenticity.

| Public certificate source | Validity dates observed | SHA-256 of certificate DER |
| --- | --- | --- |
| [National root v2](http://www.firmadigital.go.cr/repositorio/CA%20RAIZ%20NACIONAL%20-%20COSTA%20RICA%20v2.crt) | 2015-02-24–2039-02-24 | `fd9ea730948ec25875fd3c4a778815f57f2261f739be898dd720fa2e07ef7c42` |
| [PJ policy v2, original](http://www.firmadigital.go.cr/repositorio/CA%20POLITICA%20PERSONA%20JURIDICA%20-%20COSTA%20RICA%20v2.crt) | 2015-02-25–2031-02-25 | `8d4b697ae29912bcfc570374695f040096f1a8499fe5a4e0b65ee32567aec15b` |
| [PJ policy v2, renewed](http://www.firmadigital.go.cr/repositorio/CA%20POLITICA%20PERSONA%20JURIDICA%20-%20COSTA%20RICA%20v2%281%29.crt) | 2026-02-08–2038-02-08 | `fb55fa176bdc1a60d700b4940e46549dd72663f943c0eff334ced6c8779c834b` |
| [SINPE PJ v2, 2019](http://fdi.sinpe.fi.cr/repositorio/CA%20SINPE%20-%20PERSONA%20JURIDICA%20v2%281%29.crt) | 2019-06-21–2027-06-21 | `f2503e93d69a1ae57861102042cc0ab05b272401b9a48c79d88d171f88eb3093` |
| [SINPE PJ v2, 2023](http://fdi.sinpe.fi.cr/repositorio/CA%20SINPE%20-%20PERSONA%20JURIDICA%20v2%282%29.crt) | 2023-01-14–2031-01-14 | `0cd35122da671b8e896bb14653256fd88452812b56c6b4077a3c2b77c1601879` |
| [SINPE PJ v2, 2026](http://fdi.sinpe.fi.cr/repositorio/CA%20SINPE%20-%20PERSONA%20JURIDICA%20v2%283%29.crt) | 2026-02-09–2034-02-09 | `1aec7902d762ae6ed0cf7a1e3d3dbcbe60e0321980b733202f83cba7d9bfcc49` |

The renewed policy URL was discovered from the public 2026 issuing CA's AIA as a candidate intermediate, then verified under the independently matched national root. Its name is unchanged but its key differs. The original policy's SKI is `57b786ff6827061963ebcefc521195a7227814ed`; the renewed policy's SKI is `6b824e4845e364c087593367a672fea2158e5cb7`.

Offline `openssl verify -x509_strict` with only that root and explicit policy intermediates returned `OK` for both policies and the 2019/2023/2026 issuing CAs. The 2026 issuing CA fails under the original policy alone (`unable to get local issuer certificate`), and succeeds with the renewed policy. This is chain/signature/current-time verification, **without CRL/OCSP or a Hacienda leaf**. No AIA retrieval was enabled in application code and no downloaded certificate became a runtime trust anchor.

All three issuing certificates have subject `CN=CA SINPE - PERSONA JURIDICA v2,OU=DIVISION SISTEMAS DE PAGO,O=BANCO CENTRAL DE COSTA RICA,C=CR,serialNumber=CPJ-4-000-004017`, `CA:TRUE`, `pathlen:0`. These identify BCCR issuing CAs, not the Ministry. A national-root-valid subscriber may be another organization. A complete PKI policy still requires independently established Hacienda subscriber identity/authorization and revocation handling.

BCCR separately links test hierarchies; its PJ test ZIP returned 503. Their existence does not establish that Hacienda STAG uses them. **Production Hacienda leaf/SPKI: unknown. STAG Hacienda leaf/SPKI and hierarchy mapping: unknown.** No CA hash in this document is eligible as a Hacienda leaf pin.

The user-supplied `prod-ca-2021.crt` was not inspected or reused. Its Supabase database TLS purpose does not authorize Hacienda XML signing. API server TLS certificates, national signing CAs, issuer PKCS12 material, and Hacienda response signing leaves serve separate purposes.

## Explicit design proposal: authenticated direct-API observations

This proposal is an application architecture choice requiring a documented policy decision; it is **not a discovered Hacienda rule or an implemented exception**. The existing [identity/trust note](2026-11-24-emission-identity-trust.md) correctly blocks trusting an embedded leaf by itself. This proposal keeps that restriction and introduces a separately named provenance basis for an official API observation.

There are two distinct claims:

| Evidence basis | Claim it can support | Outstanding dependency |
| --- | --- | --- |
| Verified Ministry signing identity | This signed XML was signed by an authorized Hacienda signer, independently of delivery channel. | Approved leaf/SPKI roster or national-chain validation plus authoritative Ministry identity/authorization, validity, revocation, rotation and environment policy. |
| Authenticated official API observation | Our backend obtained these exact response bytes for this tenant/environment/document from the fixed official HTTPS API using its authorized session, and the XML passed structural, correlation and mathematical-signature checks. | An explicit product policy accepting transport provenance for operational status; implementation and adversarial verification of the evidence boundary. It does not independently certify the embedded leaf as Hacienda. |

For the second design, a backend-only provenance record would bind tenant, environment, credential version, fixed request origin/path, queried clave, observation time, HTTP result, raw JSON hash, decoded XML hash, schema version/hash, verification results, and policy version. Create it only inside the real successful fetch path. Preserve immutable response bytes; never store bearer tokens/passwords in this evidence. A server-generated audit attestation can protect the binding in storage; it is not a portable TLS transcript or independently verified fiscal signature identity.

Required controls for such a policy:

1. Select endpoints from a closed environment profile. Require normal HTTPS chain/hostname verification, no redirects, no configurable fiscal origin, no disabled TLS verification, and the corresponding environment's authenticated session. Keep tenant/environment/job/credential bindings through retries. Do not infer environment from usernames or certificate names.
2. Obtain the canonical response through backend GET for the expected clave. Validate bounded JSON, strict Base64/UTF-8/XML and the pinned offline XSD. Require the response root and authoritative fields to be covered by the verified signature; reject wrapping, duplicate IDs, unsupported transforms, external references and unsigned authoritative fields. Validate applicable signed properties and signing-certificate binding without assuming incoming XAdES-XL equals outgoing EPES.
3. Correlate key, issuer/receiver identification **types and numbers**, totals, tax, and final XML outcome to the immutable submitted document and JSON outcome. Missing XML, an inconsistent result, a signature failure, or an uncertain fetch remains pending/blocked. Cryptographic verification with an embedded public key proves mathematical integrity; channel provenance supplies the separate API-origin claim.
4. Distinguish `official_api_observation` from `ministry_signer_identity_verified` in stored evidence and behavior. Never auto-enroll the observed leaf as a trusted signer for later XML. Unknown signer rotation is an observation, not a new global trust grant.
5. Uploaded XML, email attachments, copied JSON, and unsolicited callbacks cannot mint this evidence. For an imported reply, independently re-query the official API and use that canonical observation; otherwise require the independent signer-trust path. Callback transport needs its own authentication contract and cannot inherit outbound GET provenance.
6. Verify negative cases before enabling the alternative: self-signed user uploads, valid signatures from unrelated national subscribers, forged provenance, wrong tenant/environment/key/identity/totals, terminal JSON with absent/mismatched XML, redirects/TLS errors, and replay across tenants or environments. Production results must never derive from STAG evidence.

The mechanism would address the **pin bootstrap dependency** by changing the explicitly declared evidence policy. It would not solve issuer-certificate ownership, arbitrary imported-XML trust, revocation, independent Ministry signer validation, or live acceptance testing. If independent signer identity is a product requirement for every final status, the prerequisite remains official signer material and the current gate should stay closed.

## Actionable next steps

1. Implement/review closed test and production transport profiles using the confirmed values above, sharing the pinned 4.4 package. Isolate secrets, counters, document identity, jobs, status evidence and artifacts by tenant **and** fiscal environment. Never auto-switch environments after an error.
2. Resolve response evidence policy explicitly: retain independent PKI/leaf trust as required, or specify the separate authenticated-API observation design before changing its readiness gates. Do not label provenance-only evidence as verified Ministry signing identity.
3. For independent PKI, obtain authoritative Hacienda production/STAG subscriber identity or leaf/SPKI rosters and rotation policy; use the national hierarchy as a starting point, with controlled trust distribution and revocation handling. Test-chain availability is not proof of STAG applicability.
4. Exercise any authorized STAG integration only after the selected policy and remaining issuer/signing requirements are satisfied. This research performs no authentication or submission and does not authorize a production test invoice.

## Fetch ledger

All successful downloads below returned HTTP 200 on 2026-11-25. Hashes describe the exact downloaded bytes, without newline normalization. PDF/XSD/policy hashes match the relevant repository provenance records. HTML bodies can include changing page/edge metadata; their hashes record this research observation, not stable runtime trust pins.

| Source | Bytes | SHA-256 of download |
| --- | ---: | --- |
| [API HTML](https://www.hacienda.go.cr/docs/ComprobantesElectronicosAPI.html) | 52,467 | `1c26578abb7e2bd898ca71688b68435c7ab55577b6969a1fdab051764320bcd3` |
| [IdP guide PDF](https://www.hacienda.go.cr/docs/Guia_IdP.pdf) | 2,405,918 | `e7a2db0f8c3f0255f74541f0c63dc8e1b199fecb2fa0325e18b0e11f55e1bedc` |
| [4.4 annex PDF](https://www.hacienda.go.cr/docs/ANEXOS_Y_ESTRUCTURAS_V4.4.pdf) | 1,243,035 | `6e093226b29b38c5c8de825f70c1b1cb8ed81e2f4a6eb0b3ff52708fc1eb2769` |
| [Invoice XSD](https://www.hacienda.go.cr/docs/FacturaElectronica_V4.4.xsd) | 119,689 | `926ba81325bc21102755bd8e4e570a63caaca086e680a877c3a6d15d6ee8a62f` |
| [Response XSD](https://www.hacienda.go.cr/docs/MensajeHacienda_V4.4.xsd) | 7,799 | `b2606156042b7aa7b7f7f61945f0ff1323661b43b5a1489ad5eafad1c52fd25e` |
| [Signature-policy PDF](https://cdn.comprobanteselectronicos.go.cr/xml-schemas/Resoluci%C3%B3n_General_sobre_disposiciones_t%C3%A9cnicas_comprobantes_electr%C3%B3nicos_para_efectos_tributarios.pdf) | 163,479 | `0d6c629f5c5639e23c3ae5905dace1e158cb5806822c003de787a6ec3321d21f` |
| [BCCR CA page](https://www.bccr.fi.cr/cr/es/firma-digital/informacion-general/certificados-de-la-autoridad-certificadora-ca.html) | 99,454 | `b595847456fe8145065a461ef415db2a8be230ff4e8d347bfe7c9760334b11f5` |
| [BCCR issuing-CA/revocation page](https://www.bccr.fi.cr/cr/es/firma-digital/informacion-general/certificados-y-listas-de-revocacion.html) | 109,670 | `c61949d8d5f2814830cf079af9208c45c4a522e39c19690d1ab22796c6bce63f` |
| [BCCR PJ service page](https://www.bccr.fi.cr/cr/es/firma-digital/certificados-de-persona-juridica.html) | 101,163 | `6171223a963ec323db1b655c7f3abaae7b9c4d342db65e4341d0a260c65deda6` |
| [PGR Annex 2](https://www.pgrweb.go.cr/DOCS/NORMAS/1/VIGENTE/S/2020-2029/2020-2024/2024/1936C/1701B8.HTML) | 120,655 | `60f62053d2296fabfa87c03b07d37a55fb3fc60249acf13e694d07fc599780cb` |

The CA source URLs are in the hierarchy table. Download hashes for PEM files differ from certificate DER fingerprints:

| CA download | Download bytes | Download SHA-256 |
| --- | ---: | --- |
| National root v2 (DER) | 1,477 | Same as its DER fingerprint above. |
| Original PJ policy (DER) | 3,438 | Same as its DER fingerprint above. |
| Renewed PJ policy (PEM) | 4,830 | `79e2be969f0015abeb1b91553515cba48a17d284a0a940b3151ed4f700f610ff` |
| SINPE PJ 2019 (PEM) | 4,342 | `be044580ef5c946c4f3b4a3f8941697ba367271a1f112a1b9568338f46fdc191` |
| SINPE PJ 2023 (PEM) | 4,338 | `c4cd81d8a164340e7005ab187d2ddeda0a045d9f55846d5db67592b90d9b9de7` |
| SINPE PJ 2026 (PEM) | 4,528 | `2441d3c1dfcd8449d1e6752450b63c2ade649450f0295807a9eb0255a000b0b0` |

Reproduction: download only public files from the recorded URLs; compute raw hashes with `sha256sum`; convert certificates with `openssl x509 -inform DER|PEM -outform DER`; hash the DER for certificate fingerprints. Check the root/original policy SHA-1 and serial against BCCR's HTTPS publication before evaluating explicit chains. Verification used system OpenSSL 3.5.7 and `openssl verify -x509_strict -CAfile ROOT.pem -untrusted POLICY.pem ISSUING_CA.pem`; no network revocation or Hacienda signer verification is implied by `OK`.
