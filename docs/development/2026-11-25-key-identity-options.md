# Hacienda cryptographic-key identity: evidence and implementation choices

Checked 2026-11-25. This is public-source research and a proposed application policy. No private certificate, PIN, API credential, authenticated endpoint, invoice submission, runtime configuration, dependency, or trust store was accessed or changed.

## Finding

The reviewed official publications do not establish a Hacienda-issued `.p12` subject OID, identifier grammar, normalization algorithm, or public certificate-to-taxpayer validation service. They do not prescribe a local `CN` or `serialNumber` comparison before a sandbox submission. This is a bounded finding about the sources below, not proof that no other requirement or internal Hacienda check exists.

The application currently imposes a stronger prerequisite: `pkcs12-worker.ts` always returns `identity_status: "pending"`, while `emission-control.ts` permits only `"verified"`. The comment explicitly disallows manual enrollment. That is an application security decision, rather than a demonstrated obligation to implement a particular certificate-subject parser. A documented enrollment policy can replace this dead end without claiming to have discovered an official certificate profile. The general duty to protect integrity, authenticity, and authorship still applies.

This qualifies the earlier [identity/trust research](2026-11-24-emission-identity-trust.md): an official profile is required **to claim automatic authoritative certificate-subject identity verification**. It has not been established as the only defensible way to authorize an initial integration submission. Changing this policy requires an explicit implementation/design change; this research does not silently bypass the existing controls.

## Official evidence inspected

All linked sources were retrieved publicly on 2026-11-25. Quotes are intentionally short; the surrounding findings are paraphrases.

| Official source | Relevant evidence and limit |
| --- | --- |
| [Hacienda v4.4 annex, Annex 2, printed pp.84–88](https://www.hacienda.go.cr/docs/ANEXOS_Y_ESTRUCTURAS_V4.4.pdf) | “Se le permite al contribuyente escoger entre dos modelos independientes para la autenticación e integridad de los Comprobantes Electrónicos.” It distinguishes national digital-signature certificates from Hacienda cryptographic keys, provides separate test/production key generation, and specifies signature/algorithm requirements. Its SINPE personal-certificate example does not define a Hacienda-key subject profile. Annex 3 describes submission/status services and a sandbox whose data can be cleared. |
| [Decree 44739-H, arts.2(16–18), 14(9), 21, official Hacienda copy](https://www.hacienda.go.cr/docs/REGLAMENTO_DE_COMPROBANTES_ELECTRONICOS.pdf) | Requires an appropriate security scheme for integrity, authenticity, authorship, and transaction/information control. It requires submission to Hacienda and a final acceptance message as evidence of validation. It does not specify a subject-OID comparison algorithm. The [PGR publication](https://www.pgrweb.go.cr/DOCS/NORMAS/1/VIGENTE/D/2020-2029/2020-2024/2024/19326/16FAC2.HTML) was also checked; its retrieved page contains the decree's preamble, so the article findings use the full Hacienda PDF. |
| [MH-DGT-RES-0027-2024, arts.1, 6, 8, 11, official signature-policy PDF](https://cdn.comprobanteselectronicos.go.cr/xml-schemas/Resoluci%C3%B3n_General_sobre_disposiciones_t%C3%A9cnicas_comprobantes_electr%C3%B3nicos_para_efectos_tributarios.pdf) | Article 6 requires systems to “disponer de controles, registros y bitácoras de cada transacción registrada”. Article 8 concerns public consultation of authorized taxpayers/providers, which is distinct from proving ownership of a particular certificate. Article 11 distinguishes final XML acceptance from mere receipt. No certificate-subject binding profile appears in this document. |
| [Hacienda API documentation, POST `/recepcion` and GET `/recepcion/{clave}`](https://www.hacienda.go.cr/docs/ComprobantesElectronicosAPI.html) | HTTP 201 means “queda pendiente la validación del mismo”. GET exposes processing states and the response XML. The published resource list does not document a separate key-ownership/preflight endpoint or guarantee that acceptance is a general certificate-ownership assertion. This API page includes old examples; use current v4.4 schemas for document details. |
| [Hacienda IdP guide, pp.3–6](https://www.hacienda.go.cr/docs/Guia_IdP.pdf) | Documents distinct production/sandbox credentials and a STAG token example. Login success authenticates API access; the guide does not specify how a token or username establishes the identity/authorization of an imported signing certificate. It identifies v4.2 as current at the time it was written. |
| [Hacienda test-credentials guide, dated 02/05/2025, pp.2–7](https://www.hacienda.go.cr/docs/GuiaparaCredencialesEntornodepruebas.pdf) | Describes obtaining test credentials and a test cryptographic key from the taxpayer's authenticated virtual-office/Tico Factura profile. This supplies an operator-verifiable provenance workflow, not a machine-readable certificate identity contract. Its four-digit PIN instructions must be read alongside the newer policy below. |
| [Hacienda new cryptographic-key PIN policy, one page](https://www.hacienda.go.cr/docs/NuevasPoliticasDeSeguridadPinLlavesCriptograficasComprobantesElectronicos.pdf) | New-key PINs have length 14 and include uppercase, lowercase, a number, and a special character. “Las llaves criptográficas vigentes emitidas con un pin de 4 dígitos podrán seguir utilizándose hasta su fecha de vencimiento o revocación.” The notice allows a six-month generation transition measured from its communication. No explicit issue date is printed; search-engine publication age cannot establish an absolute transition deadline. |

No BCCR/SINPE profile is being imported into the Hacienda-key path. No open-source implementation is being treated as a normative source. No undocumented validation URL was guessed or exercised.

## What each check can establish

Opening the PKCS12 with its PIN, checking dates/algorithm, matching its private/public key, and successfully signing a local challenge establish technical usability and possession of that key. They do not establish fiscal identity or delegation. The existing inspector correctly keeps these claims separate.

A subject match would remain insufficient without trustworthy issuance/provenance and authorization semantics. The X.509 subject attribute `serialNumber` (OID 2.5.4.5) and the certificate's own serial number are different fields; neither can be converted into a taxpayer ID using a guessed grammar. The annex's `X509IssuerName` describes the certificate issuer, not an authoritative Hacienda-key holder mapping. Do not derive identity from names, remove arbitrary non-digits, or assume a username prefix establishes ownership.

An authenticated token, a successful HTTP request, HTTP 201, `recibido`, or `procesando` does not establish final acceptance. A final, correlated positive Hacienda result demonstrates that the service accepted **that submitted document**. The published contract does not establish that such a result independently certifies legal ownership of the key, proves delegation, or guarantees the service performs a particular key/issuer comparison. Keep that distinction in status names and audit evidence.

## Implementable choices

| Choice | What it permits | Remaining limit |
| --- | --- | --- |
| Authoritative automated binding | Implement exact OIDs, allowed identification formats, trust/revocation, environment, and delegation rules once Hacienda supplies a suitable official contract or an interface with documented guarantees. | No such contract/interface was located in this bounded review. Keeping this as the only enrollment route indefinitely prevents all actual integration submissions. |
| Operator-verified enrollment plus observed Hacienda acceptance | An authorized company operator verifies the official account/company and source of each environment's key; the server records the enrollment and permits a controlled initial submission. A final positive result provides actual end-to-end validation evidence for the submitted document. | This is an application risk/control policy. It does not manufacture a missing OID profile, convert an operator assertion into cryptographic ownership proof, or replace the other fiscal/security requirements. |

The second choice is a practical recommendation for a usable test and production flow, provided the implementation represents its claims accurately.

## Proposed operator-verified enrollment policy

These are product controls, not assertions that Hacienda mandates this exact workflow.

1. **Scope enrollment precisely.** Bind it server-side to tenant/company, issuer identification type and canonical number, selected environment, credential version, certificate SHA-256 fingerprint, technical-validity interval, approving actor, timestamp, and policy version. Read company identity from the authorized company record. Keep imported private material inside the existing protected form/vault.
2. **Verify source and authority.** Require a company-authorized operator to confirm that the key and API credentials were generated/downloaded for that taxpayer and selected environment from its official account, and that the operator may enroll them. Present the company identity, environment, fingerprint, and validity dates for review. Record the declaration and safe provenance metadata. A typed ID alone is insufficient. External account review is an operator step; this research supplies no automatic portal-verification claim.
3. **Preserve independent checks.** Keep PKCS12 integrity/private-key matching, supported cryptography, expiry checks, tenant authorization, secret custody, exact environment endpoints, API credential checks, numbering, document validation, and response handling. Avoid changing inspector metadata from `pending` to `verified` merely because the local parser succeeded. Store operator enrollment evidence separately.
4. **Allow an initial validation submission.** Once the other required controls pass, operator enrollment may authorize the selected STAG document for actual integration validation. Requiring an accepted response before permitting any first submission is circular. Limit this bootstrap permission to its enrolled company/key/environment and retain normal idempotency and numbering controls; it is not a global override or a database flag that an administrator can apply to all keys.
5. **Promote only on a final positive result.** Require the final accepted state and matching document key, issuer, and other expected response values. Retain the exact submitted signed XML hash, its verified signing-certificate fingerprint, credential/enrollment version, official environment, response hash, and validation time. Authenticating Hacienda's response is a separate dependency: use the reviewed response-trust policy; an uploaded response or its embedded certificate cannot approve its own trust. Failed, missing, pending, mismatched, or untrusted results never establish acceptance.
6. **Name the evidence honestly.** Distinguish `operator_verified` enrollment from `accepted_transaction` evidence, and distinguish both from any future `authoritative_profile_verified` result. An accepted transaction connects the recorded signed document and locally verified signing key to the observed Hacienda result. It remains transaction-scoped evidence, not an official general-purpose certificate registry assertion.
7. **Invalidate scope changes.** Re-enroll on company identity, environment, credential version, or certificate-fingerprint changes. Expiry, local deactivation, known revocation, authorization withdrawal, or an applicable authoritative refusal must prevent subsequent use. A stale success cannot make a revoked or different key valid. Keep rejected transaction detail separate: a rejection for an unrelated invoice field does not by itself prove a key/issuer mismatch.

## Production is a separate enrollment

The user has separate test and production keys. Never copy STAG enrollment or acceptance evidence to the production key, even if the taxpayer ID matches. Production needs its own vault context, credential version, operator provenance/authorization, certificate fingerprint, endpoint configuration, numbering confirmation, and initial-submission path.

A STAG result tests the STAG combination. It cannot establish that production credentials, production signing material, or production issuance will succeed. Production's first final acceptance must come from an authorized, real business transaction using its production enrollment; do not create a fictitious production invoice solely to obtain a health-check response. Until that result, show production as enrolled/ready for its first authorized submission, not as already validated by Hacienda. The request to make production functional does not mean an unperformed live submission has succeeded.

The acceptance-evidence state may be a useful product readiness control, but its bootstrap must permit the first authorized production submission when all applicable controls pass. Treating prior acceptance as a precondition for **every** production send would reproduce the same deadlock.

## PIN implementation implications

Accept the PIN as a secret string with its exact value. Do not coerce to a number, trim it, or restrict imported keys to four digits. Validate an imported key by opening/authenticating the actual PKCS12; do not reject a still-valid legacy key merely because its PIN does not satisfy the new-key generation policy. Apply the published 14-character composition when presenting guidance for generation of a new key, without inventing an absolute transition date or undocumented normalization/Unicode rules.

## Reviewable implementation checks

An implementation of the proposed policy should demonstrate that another company, environment, key fingerprint, or credential version cannot reuse enrollment/acceptance; that opening a synthetic P12 or obtaining a token never upgrades fiscal identity; and that HTTP 201/pending, rejection, a forged response, or mismatched document correlation cannot promote acceptance. Verify that a controlled first submission is reachable without prior acceptance, including an independently enrolled production key. Use synthetic public fixtures for these checks; private keys, PINs, and passwords do not belong in tests, logs, chat, or repository evidence.

This research changed only this document. It did not perform an enrollment, prove a private key's taxpayer association, or submit anything to Hacienda.
