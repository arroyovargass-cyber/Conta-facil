# Issuer identity and Hacienda response trust research

Research checked 2026-11-25 using public official sources and the supplied extracted annex/IdP guide. No private certificate, credential, authenticated endpoint, invoice submission, runtime configuration, or trust store was accessed or changed.

## Issuer binding remains unresolved

The [official v4.4 annex](https://www.hacienda.go.cr/docs/ANEXOS_Y_ESTRUCTURAS_V4.4.pdf), Annex 2, distinguishes national digital-signature certificates from Hacienda cryptographic keys. The latter are generated independently for test and production. Its signature example uses a national personal certificate; an example is not a normative profile for every Hacienda-issued PKCS12 certificate.

Neither that annex nor the [official IdP guide](https://www.hacienda.go.cr/docs/Guia_IdP.pdf) specifies an authoritative Hacienda cryptographic-key subject OID, identifier grammar, normalization rule, or issuer-to-certificate comparison algorithm. Consequently this research cannot substantiate a deterministic `issuerIdentification` comparison against `CN`, `serialNumber` (OID 2.5.4.5), or any other subject attribute. Do not infer that cryptographic keys follow the national SINPE certificate subject profile. Do not infer identity from names, strip arbitrary non-digits, remove guessed prefixes, or substitute the application owner's cédula.

The IdP guide says production and sandbox credentials differ and are generated separately. Its STAG request example pairs realm `rut-stag`, client `api-stag`, and a username shaped `cpj-…@stag.comprobanteselectronicos.go.cr`. The annex names production realm `rut`. These establish documented environment configuration and an example, not a normative username grammar for physical persons, legal persons, DIMEX, NITE, or delegation. Username parsing therefore cannot prove the configured issuer identity or certificate ownership.

Required dependency: an authoritative Hacienda certificate profile identifying the exact subject OID, allowed formats per identification type and environment, normalization rules, issuer authorization/delegation semantics, and trust/revocation requirements; alternatively an authoritative identity-validation interface with documented guarantees. A matching untrusted self-signed subject alone would still not establish ownership. Public synthetic fixtures can test parsing and mismatch rejection, but cannot establish the missing fiscal identity contract. Keep this activation gate unresolved until that evidence exists.

## Response signing trust has an official hierarchy source, but no verified Hacienda signer pin

The annex, Annex 2 immediately before the cryptographic-key section, says Hacienda's acknowledgement XML is signed using the Ministry's persona jurídica certificate. This supports requiring a verified Hacienda signer, rather than accepting any certificate embedded in `ds:KeyInfo`.

Official BCCR sources provide the national hierarchy:

- [CA certificates and published thumbprints](https://www.bccr.fi.cr/cr/es/firma-digital/informacion-general/certificados-de-la-autoridad-certificadora-ca.html) links the national root and persona jurídica policy CA. The page publishes root thumbprint `68 a2 4d 2b 2c b5 c4 ce 9f e3 00 e3 b6 fc d1 df ee b9 c3 11` and persona jurídica policy thumbprint `c1 c2 ca 72 d1 30 20 0d ad 91 53 af e7 99 90 84 9c 07 b5 3b`. These are the page's 20-byte thumbprints, not freshly verified SHA-256 pins.
- [SINPE certificates and revocation lists](https://www.bccr.fi.cr/cr/es/firma-digital/informacion-general/certificados-y-listas-de-revocacion.html) links persona jurídica CA certificates for 2015–2023, 2019–2027, 2023–2031, and 2026–2034, corresponding CRLs, and separate test certificates. It also describes OCSP availability.
- [Persona jurídica certificates](https://www.bccr.fi.cr/cr/es/firma-digital/certificados-de-persona-juridica.html) identifies CA SINPE – PERSONA JURÍDICA as the registered issuing authority for that service.

These pages are a verified official distribution starting point, not a completed Hacienda trust configuration. This research did not download, hash, validate, or vendor those certificate bytes, and found no authoritative currently applicable Hacienda leaf fingerprint, Ministry subject-identifier profile, environment-specific signer roster, or rotation policy. National-root trust alone authorizes many subscribers and cannot distinguish Hacienda from another organization. A valid chain therefore still needs an independently established Ministry identity restriction or an official signer/SPKI pin, with validity/revocation and rotation handling. The STAG response signer and whether it uses a distinct test hierarchy also remain unverified.

Required dependency: obtain and independently verify the official hierarchy bytes and their SHA-256 hashes, plus authoritative Hacienda signer identity/pins and STAG-versus-production policy. Store approved trust material outside incoming XML; reject unknown signers. Never bootstrap trust from the first response, its embedded certificate, AIA URLs supplied by an untrusted certificate, or general TLS root trust. XML signature reference coverage and document-key correlation are separate checks from certificate trust.

The supplied filename `prod-ca-2021.crt` does not establish Hacienda response-signing authority. No provenance tying it to Hacienda was found. Do not use it as a fiscal trust anchor; a Supabase database TLS CA serves a different trust purpose. Its contents were not needed for this research.
