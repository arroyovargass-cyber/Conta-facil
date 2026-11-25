import type { IdpClient } from "./hacienda-idp";
import type pg from "pg";
import type { HaciendaEnvironment } from "../../../../packages/domain/src/hacienda-environment";
import type { AppConfig } from "../config";
import { HttpError, type Claims } from "../db";
import {
  parseKeyring,
  encryptCredential,
  decryptCredential,
  type Keyring,
} from "../security/credential-vault";
import {
  inspectPkcs12,
  inspectorCapability,
} from "../security/pkcs12-inspector";
export type CredentialInput = {
  environment: HaciendaEnvironment;
  expected_revision: number;
  username: string;
  password: string;
  pin: string;
  pkcs12_base64: string;
};
export type CredentialEnrollmentInput = {
  environment: HaciendaEnvironment;
  expected_revision: number;
  confirmed: true;
  evidence_reference: string;
};
const empty = (environment: HaciendaEnvironment) => ({
  environment,
  revision: 0,
  active_version: null,
  certificate_metadata: null,
  api_status: "not_tested",
  api_checked_at: null,
  session_closed: null,
  enrollment: null,
});
function validCertificate(certificate: any) {
  const now = Date.now();
  return (
    certificate?.technical_status === "valid_local" &&
    Date.parse(certificate.valid_from) <= now &&
    Date.parse(certificate.valid_until) > now &&
    /^[a-f0-9]{64}$/i.test(
      String(certificate.fingerprint ?? "").replace(/:/g, ""),
    )
  );
}
function validIssuer(type: string, identification: string) {
  const patterns: Record<string, RegExp> = {
    "01": /^\d{9}$/,
    "02": /^\d{10}$/,
    "03": /^\d{11,12}$/,
    "04": /^\d{10}$/,
  };
  return patterns[type]?.test(identification) === true;
}
export class CredentialStore {
  private readonly keyring: Keyring | undefined;
  private inspectorCheck?: ReturnType<typeof inspectorCapability>;
  constructor(
    private pool: pg.Pool,
    private config: AppConfig,
  ) {
    this.keyring = parseKeyring(
      config.HACIENDA_KEYRING,
      config.HACIENDA_ACTIVE_KEY_ID,
      config.SESSION_KEY,
    );
  }
  async transaction<T>(
    claims: Claims,
    tenant: string,
    permission: string,
    run: (db: pg.PoolClient) => Promise<T>,
  ) {
    const db = await this.pool.connect();
    try {
      await db.query("begin");
      await db.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify(claims),
      ]);
      await db.query("select id from public.tenants where id=$1 for update", [
        tenant,
      ]);
      if (
        !(
          await db.query(
            "select (private.hacienda_access($1,$2) and private.hacienda_access($1,'hacienda.read')) allowed",
            [tenant, permission],
          )
        ).rows[0]?.allowed
      )
        throw new HttpError(
          403,
          "No tienes permiso para gestionar esta configuración de Hacienda.",
        );
      const value = await run(db);
      if (
        !(
          await db.query(
            "select (private.hacienda_access($1,$2) and private.hacienda_access($1,'hacienda.read')) allowed",
            [tenant, permission],
          )
        ).rows[0]?.allowed
      )
        throw new HttpError(
          403,
          "Tu autorización cambió durante la operación.",
        );
      await db.query("commit");
      return value;
    } catch (e) {
      await db.query("rollback");
      throw e;
    } finally {
      db.release();
    }
  }
  async authorize(claims: Claims, tenant: string, permission: string) {
    await this.transaction(claims, tenant, permission, async () => {});
  }
  async capability(environment: HaciendaEnvironment = "test") {
    const inspector = await (this.inspectorCheck ??= inspectorCapability());
    // Published services admit only the pinned, integrity-verified PKCS12 profile.
    const supported =
      inspector.available &&
      (inspector.validated_profile || this.config.NODE_ENV === "test");
    return {
      can_store_credentials:
        !!this.keyring &&
        supported &&
        (this.config.NODE_ENV === "test" ||
          new URL(this.config.APP_ORIGIN).protocol === "https:"),
      synthetic_only: !inspector.validated_profile,
      inspector_profile_verified: inspector.validated_profile,
      can_test_connection:
        !!this.keyring &&
        (environment === "test"
          ? this.config.HACIENDA_STAG_PROBE_ENABLED
          : this.config.HACIENDA_PRODUCTION_PROBE_ENABLED) === "true",
      can_emit: false,
      reason: !this.keyring
        ? "vault_not_configured"
        : !supported
          ? "inspector_validation_pending"
          : this.config.NODE_ENV !== "test" &&
              new URL(this.config.APP_ORIGIN).protocol !== "https:"
            ? "https_required"
            : null,
    };
  }
  async metadata(
    claims: Claims,
    tenant: string,
    environment: HaciendaEnvironment = "test",
  ) {
    const result = await this.transaction(
      claims,
      tenant,
      "hacienda.read",
      async (db) => {
        const configuration =
          (
            await db.query(
              "select environment,revision,active_version,certificate_metadata,api_status,api_checked_at,session_closed,updated_at,private.hacienda_enrollment(tenant_id,environment,active_version) enrollment from public.hacienda_configuration where tenant_id=$1 and environment=$2",
              [tenant, environment],
            )
          ).rows[0] ?? empty(environment);
        const issuer = (
          await db.query(
            "select identification,identification_type,private.hacienda_access(id,'hacienda.credentials.manage') can_manage from public.tenants where id=$1",
            [tenant],
          )
        ).rows[0];
        const reviewed =
          configuration.active_version !== null &&
          (
            await db.query(
              "select 1 from private.hacienda_credential_enrollments where tenant_id=$1 and environment=$2 and version=$3",
              [tenant, environment, configuration.active_version],
            )
          ).rows.length > 0;
        return {
          configuration,
          canEnroll:
            !!issuer?.can_manage &&
            configuration.active_version !== null &&
            !reviewed &&
            configuration.api_status === "success" &&
            validCertificate(configuration.certificate_metadata) &&
            validIssuer(issuer.identification_type, issuer.identification),
        };
      },
    );
    const { configuration } = result;
    const capabilities = {
      ...(await this.capability(environment)),
      can_enroll: result.canEnroll,
    };
    capabilities.can_test_connection &&= configuration.active_version !== null;
    return { configuration, capabilities };
  }
  private async current(
    db: pg.PoolClient,
    tenant: string,
    revision: number,
    environment: HaciendaEnvironment = "test",
  ) {
    const row = (
      await db.query(
        "select revision,active_version,certificate_metadata,api_status from public.hacienda_configuration where tenant_id=$1 and environment=$2 for update",
        [tenant, environment],
      )
    ).rows[0] ?? { revision: 0, active_version: null };
    if (row.revision !== revision)
      throw new HttpError(
        409,
        "La configuración cambió. Recarga antes de continuar.",
      );
    return row;
  }
  private async audit(
    db: pg.PoolClient,
    claims: Claims,
    tenant: string,
    action: string,
    version: number,
    environment: HaciendaEnvironment = "test",
  ) {
    await db.query(
      "insert into public.audit_events(tenant_id,actor_id,action,entity,entity_id,details) values($1::uuid,$2::uuid,$3,'hacienda_credentials',$1::uuid::text,$4::jsonb)",
      [tenant, claims.sub, action, JSON.stringify({ environment, version })],
    );
  }
  async replace(
    claims: Claims,
    tenant: string,
    input: CredentialInput,
    file: Buffer,
  ) {
    await this.transaction(
      claims,
      tenant,
      "hacienda.credentials.manage",
      (db) =>
        this.current(db, tenant, input.expected_revision, input.environment),
    );
    if (!(await this.capability(input.environment)).can_store_credentials)
      throw new HttpError(
        503,
        "El registro seguro de credenciales no está habilitado en este entorno.",
      );
    let certificate;
    try {
      certificate = await inspectPkcs12(file, input.pin);
    } catch (e) {
      if ((e as { statusCode?: number }).statusCode === 429)
        throw new HttpError(
          429,
          "Inspector ocupado. Intenta nuevamente más tarde.",
        );
      throw new HttpError(
        400,
        "No se pudo validar el archivo criptográfico o su PIN.",
      );
    }
    try {
      await this.transaction(
        claims,
        tenant,
        "hacienda.credentials.manage",
        async (db) => {
          await this.current(
            db,
            tenant,
            input.expected_revision,
            input.environment,
          );
          const version = input.expected_revision + 1;
          const apiPlain = Buffer.from(
            JSON.stringify({
              username: input.username,
              password: input.password,
            }),
          );
          const p12Plain = Buffer.from(
            JSON.stringify({
              pkcs12_base64: input.pkcs12_base64,
              pin: input.pin,
            }),
          );
          try {
            const base = {
              tenantId: tenant,
              environment: input.environment,
              version,
            };
            const api = encryptCredential(
                apiPlain,
                { ...base, kind: "api_access" },
                this.keyring!,
              ),
              p12 = encryptCredential(
                p12Plain,
                { ...base, kind: "pkcs12" },
                this.keyring!,
              );
            await db.query(
              "insert into public.hacienda_configuration(tenant_id,environment) values($1,$2) on conflict do nothing",
              [tenant, input.environment],
            );
            await db.query(
              "update private.hacienda_credential_versions set active=false where tenant_id=$1 and environment=$2 and active",
              [tenant, input.environment],
            );
            await db.query(
              "insert into private.hacienda_credential_versions(tenant_id,environment,version,api_key_id,api_ciphertext,pkcs12_key_id,pkcs12_ciphertext,created_by) values($1,$2,$3,$4,$5,$6,$7,$8)",
              [
                tenant,
                input.environment,
                version,
                api.keyId,
                api.blob,
                p12.keyId,
                p12.blob,
                claims.sub,
              ],
            );
            await db.query(
              "update public.hacienda_configuration set revision=$3,active_version=$3,certificate_metadata=$4,api_status='not_tested',api_checked_at=null,session_closed=null,updated_at=now() where tenant_id=$1 and environment=$2",
              [tenant, input.environment, version, JSON.stringify(certificate)],
            );
            await this.audit(
              db,
              claims,
              tenant,
              "credentials_registered",
              version,
              input.environment,
            );
          } finally {
            apiPlain.fill(0);
            p12Plain.fill(0);
          }
        },
      );
    } finally {
      file.fill(0);
    }
    return this.metadata(claims, tenant, input.environment);
  }
  async deactivate(
    claims: Claims,
    tenant: string,
    revision: number,
    environment: HaciendaEnvironment = "test",
  ) {
    await this.transaction(
      claims,
      tenant,
      "hacienda.credentials.manage",
      async (db) => {
        await this.current(db, tenant, revision, environment);
        await db.query(
          "insert into public.hacienda_configuration(tenant_id,environment) values($1,$2) on conflict do nothing",
          [tenant, environment],
        );
        await db.query(
          "update private.hacienda_credential_versions set active=false where tenant_id=$1 and environment=$2 and active",
          [tenant, environment],
        );
        await db.query(
          "update public.hacienda_configuration set revision=$3,active_version=null,certificate_metadata=null,api_status='not_tested',api_checked_at=null,session_closed=null,updated_at=now() where tenant_id=$1 and environment=$2",
          [tenant, environment, revision + 1],
        );
        await this.audit(
          db,
          claims,
          tenant,
          "credentials_deactivated",
          revision + 1,
          environment,
        );
      },
    );
    return {
      ...(await this.metadata(claims, tenant, environment)),
      official_revocation: false,
    };
  }
  async withApiAccess<T>(
    claims: Claims,
    tenant: string,
    revision: number,
    run: (access: { username: string; password: string }) => Promise<T>,
    environment: HaciendaEnvironment = "test",
  ): Promise<T> {
    const access = await this.transaction(
      claims,
      tenant,
      "hacienda.connection.test",
      async (db) => {
        const current = await this.current(db, tenant, revision, environment);
        if (current.active_version === null)
          throw new HttpError(409, "No hay credenciales activas.");
        if (!this.keyring) throw new HttpError(503, "Bóveda no disponible.");
        const row = (
          await db.query(
            "select api_key_id,api_ciphertext from private.hacienda_credential_versions where tenant_id=$1 and environment=$2 and version=$3 and active",
            [tenant, environment, current.active_version],
          )
        ).rows[0];
        if (!row)
          throw new HttpError(409, "Las credenciales ya no están activas.");
        let plain: Buffer | undefined;
        try {
          plain = decryptCredential(
            { keyId: row.api_key_id, blob: row.api_ciphertext },
            {
              tenantId: tenant,
              environment,
              version: current.active_version,
              kind: "api_access",
            },
            this.keyring,
          );
          const data = JSON.parse(plain.toString());
          if (
            typeof data.username !== "string" ||
            typeof data.password !== "string"
          )
            throw Error();
          return {
            username: data.username as string,
            password: data.password as string,
          };
        } catch {
          throw new HttpError(503, "No se pudo abrir la versión protegida.");
        } finally {
          plain?.fill(0);
        }
      },
    );
    try {
      return await run(access);
    } finally {
      access.username = "";
      access.password = "";
    }
  }
  async testConnection(
    claims: Claims,
    tenant: string,
    revision: number,
    idp: IdpClient,
    environment: HaciendaEnvironment = "test",
  ) {
    if (
      (environment === "test"
        ? this.config.HACIENDA_STAG_PROBE_ENABLED
        : this.config.HACIENDA_PRODUCTION_PROBE_ENABLED) !== "true"
    )
      throw new HttpError(
        503,
        "La prueba externa de Hacienda está pendiente de habilitación.",
      );
    const result = await this.withApiAccess(
      claims,
      tenant,
      revision,
      (access) => idp.probe(access, environment),
      environment,
    );
    await this.transaction(
      claims,
      tenant,
      "hacienda.connection.test",
      async (db) => {
        const row = await this.current(db, tenant, revision, environment);
        if (row.active_version === null)
          throw new HttpError(409, "Las credenciales ya no están activas.");
        await db.query(
          "update public.hacienda_configuration set api_status=$3,api_checked_at=now(),session_closed=$4,updated_at=now() where tenant_id=$1 and environment=$2",
          [tenant, environment, result.status, result.sessionClosed],
        );
        await this.audit(
          db,
          claims,
          tenant,
          "connection_tested",
          row.active_version,
          environment,
        );
      },
    );
    return this.metadata(claims, tenant, environment);
  }

  async enroll(
    claims: Claims,
    tenant: string,
    input: CredentialEnrollmentInput,
  ) {
    await this.transaction(
      claims,
      tenant,
      "hacienda.credentials.manage",
      async (db) => {
        const current = await this.current(
          db,
          tenant,
          input.expected_revision,
          input.environment,
        );
        if (
          input.confirmed !== true ||
          typeof input.evidence_reference !== "string" ||
          !input.evidence_reference.trim() ||
          input.evidence_reference.trim().length > 500 ||
          /[\x00-\x1f\x7f]/.test(input.evidence_reference)
        )
          throw new HttpError(
            400,
            "Confirma la revisión e indica una referencia válida de hasta 500 caracteres.",
          );
        if (
          current.active_version === null ||
          !validCertificate(current.certificate_metadata)
        )
          throw new HttpError(
            409,
            "Se requieren credenciales activas con un certificado técnicamente válido y vigente.",
          );
        if (current.api_status !== "success")
          throw new HttpError(
            409,
            "Prueba satisfactoriamente la conexión de este ambiente antes de registrar la revisión.",
          );
        const issuer = (
          await db.query(
            "select identification,identification_type from public.tenants where id=$1",
            [tenant],
          )
        ).rows[0];
        if (
          !issuer ||
          !validIssuer(issuer.identification_type, issuer.identification)
        )
          throw new HttpError(
            409,
            "Completa la identificación tributaria de la empresa antes de revisar la llave.",
          );
        const inserted = await db.query(
          "insert into private.hacienda_credential_enrollments(tenant_id,environment,version,issuer_identification,issuer_identification_type,certificate_fingerprint,confirmed_by,evidence_reference) values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(tenant_id,environment,version) do nothing returning version",
          [
            tenant,
            input.environment,
            current.active_version,
            issuer.identification,
            issuer.identification_type,
            current.certificate_metadata.fingerprint
              .replace(/:/g, "")
              .toLowerCase(),
            claims.sub,
            input.evidence_reference.trim(),
          ],
        );
        const enrollment = (
          await db.query(
            "select private.hacienda_enrollment($1,$2,$3) enrollment",
            [tenant, input.environment, current.active_version],
          )
        ).rows[0]?.enrollment;
        if (!enrollment)
          throw new HttpError(
            409,
            "La revisión anterior ya no corresponde a esta identificación o llave. Registra una nueva versión de credenciales.",
          );
        if (inserted.rows.length)
          await this.audit(
            db,
            claims,
            tenant,
            "credentials_enrolled",
            current.active_version,
            input.environment,
          );
      },
    );
    return this.metadata(claims, tenant, input.environment);
  }
}
