import type { IdpClient } from "./hacienda-idp";
import type pg from "pg";
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
  environment: "test";
  expected_revision: number;
  username: string;
  password: string;
  pin: string;
  pkcs12_base64: string;
};
const empty = () => ({
  environment: "test",
  revision: 0,
  active_version: null,
  certificate_metadata: null,
  api_status: "not_tested",
  api_checked_at: null,
  session_closed: null,
});
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
  async capability() {
    const inspector = await (this.inspectorCheck ??= inspectorCapability());
    // The current development security snapshot is permitted only in automated tests.
    const supported =
      inspector.available &&
      (!inspector.version.includes("-dev") || this.config.NODE_ENV === "test");
    return {
      can_store_credentials:
        !!this.keyring &&
        supported &&
        (this.config.NODE_ENV === "test" ||
          new URL(this.config.APP_ORIGIN).protocol === "https:"),
      synthetic_only: inspector.version.includes("-dev"),
      can_test_connection:
        !!this.keyring && this.config.HACIENDA_STAG_PROBE_ENABLED === "true",
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
  async metadata(claims: Claims, tenant: string) {
    const configuration = await this.transaction(
      claims,
      tenant,
      "hacienda.read",
      async (db) =>
        (
          await db.query(
            "select environment,revision,active_version,certificate_metadata,api_status,api_checked_at,session_closed,updated_at from public.hacienda_configuration where tenant_id=$1 and environment='test'",
            [tenant],
          )
        ).rows[0] ?? empty(),
    );
    const capabilities = await this.capability();
    capabilities.can_test_connection &&= configuration.active_version !== null;
    return { configuration, capabilities };
  }
  private async current(db: pg.PoolClient, tenant: string, revision: number) {
    const row = (
      await db.query(
        "select revision,active_version from public.hacienda_configuration where tenant_id=$1 and environment='test'",
        [tenant],
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
  ) {
    await db.query(
      "insert into public.audit_events(tenant_id,actor_id,action,entity,entity_id,details) values($1::uuid,$2::uuid,$3,'hacienda_credentials',$1::uuid::text,$4::jsonb)",
      [
        tenant,
        claims.sub,
        action,
        JSON.stringify({ environment: "test", version }),
      ],
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
      (db) => this.current(db, tenant, input.expected_revision),
    );
    if (!(await this.capability()).can_store_credentials)
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
          await this.current(db, tenant, input.expected_revision);
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
              environment: "test" as const,
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
              "insert into public.hacienda_configuration(tenant_id) values($1) on conflict do nothing",
              [tenant],
            );
            await db.query(
              "update private.hacienda_credential_versions set active=false where tenant_id=$1 and environment='test' and active",
              [tenant],
            );
            await db.query(
              "insert into private.hacienda_credential_versions(tenant_id,environment,version,api_key_id,api_ciphertext,pkcs12_key_id,pkcs12_ciphertext,created_by) values($1,'test',$2,$3,$4,$5,$6,$7)",
              [
                tenant,
                version,
                api.keyId,
                api.blob,
                p12.keyId,
                p12.blob,
                claims.sub,
              ],
            );
            await db.query(
              "update public.hacienda_configuration set revision=$2,active_version=$2,certificate_metadata=$3,api_status='not_tested',api_checked_at=null,session_closed=null,updated_at=now() where tenant_id=$1 and environment='test'",
              [tenant, version, JSON.stringify(certificate)],
            );
            await this.audit(
              db,
              claims,
              tenant,
              "credentials_registered",
              version,
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
    return this.metadata(claims, tenant);
  }
  async deactivate(claims: Claims, tenant: string, revision: number) {
    await this.transaction(
      claims,
      tenant,
      "hacienda.credentials.manage",
      async (db) => {
        await this.current(db, tenant, revision);
        await db.query(
          "insert into public.hacienda_configuration(tenant_id) values($1) on conflict do nothing",
          [tenant],
        );
        await db.query(
          "update private.hacienda_credential_versions set active=false where tenant_id=$1 and environment='test' and active",
          [tenant],
        );
        await db.query(
          "update public.hacienda_configuration set revision=$2,active_version=null,certificate_metadata=null,api_status='not_tested',api_checked_at=null,session_closed=null,updated_at=now() where tenant_id=$1 and environment='test'",
          [tenant, revision + 1],
        );
        await this.audit(
          db,
          claims,
          tenant,
          "credentials_deactivated",
          revision + 1,
        );
      },
    );
    return {
      ...(await this.metadata(claims, tenant)),
      official_revocation: false,
    };
  }
  async withApiAccess<T>(
    claims: Claims,
    tenant: string,
    revision: number,
    run: (access: { username: string; password: string }) => Promise<T>,
  ): Promise<T> {
    const access = await this.transaction(
      claims,
      tenant,
      "hacienda.connection.test",
      async (db) => {
        const current = await this.current(db, tenant, revision);
        if (current.active_version === null)
          throw new HttpError(409, "No hay credenciales activas.");
        if (!this.keyring) throw new HttpError(503, "Bóveda no disponible.");
        const row = (
          await db.query(
            "select api_key_id,api_ciphertext from private.hacienda_credential_versions where tenant_id=$1 and environment='test' and version=$2 and active",
            [tenant, current.active_version],
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
              environment: "test",
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
  ) {
    const result = await this.withApiAccess(
      claims,
      tenant,
      revision,
      (access) => idp.probe(access),
    );
    await this.transaction(
      claims,
      tenant,
      "hacienda.connection.test",
      async (db) => {
        const row = await this.current(db, tenant, revision);
        if (row.active_version === null)
          throw new HttpError(409, "Las credenciales ya no están activas.");
        await db.query(
          "update public.hacienda_configuration set api_status=$2,api_checked_at=now(),session_closed=$3,updated_at=now() where tenant_id=$1 and environment='test'",
          [tenant, result.status, result.sessionClosed],
        );
        await this.audit(
          db,
          claims,
          tenant,
          "connection_tested",
          row.active_version,
        );
      },
    );
    return this.metadata(claims, tenant);
  }
}
