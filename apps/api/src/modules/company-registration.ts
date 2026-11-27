import { validCompanyLogo } from "../services/company-logo";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { HttpError, type Claims } from "../db";
import type { identity } from "./identity";
import { hash } from "../security/crypto";
import {
  FiscalLookups,
  recipientIdentificationInput,
} from "../services/fiscal-lookups";
import { receiverLocationIssues } from "../services/receiver-location";
import { receiverInput } from "../../../../packages/domain/src/invoice-fiscal";
import { isEconomicActivityCode } from "../../../../packages/domain/src/economic-activity";
import {
  companyInput,
  createCompanyInput,
  updateCompanyInput,
  companyPreparation,
  type CompanyInput,
} from "../../../../packages/domain/src/company";

type Db = pg.PoolClient;
const params = z.object({ id: z.uuid() });
const columns =
  "id,legal_name,trade_name,person_type,identification_type,identification,contact_email,phone,address,active,configuration,configuration_version,created_at,updated_at,created_by,updated_by";
export function companyRegistrationRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  auth: ReturnType<typeof identity>,
) {
  const base = "/api/company-administration",
    lookup = new FiscalLookups();
  async function transaction<T>(
    claims: Claims,
    run: (db: Db) => Promise<T>,
    requireOwner = true,
  ) {
    const db = await pool.connect();
    try {
      await db.query("begin");
      await db.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify(claims),
      ]);
      const owner = (
        await db.query("select private.is_system_administrator() allowed")
      ).rows[0].allowed;
      if (requireOwner && !owner)
        throw new HttpError(
          403,
          "Solo el superadministrador del sistema puede administrar empresas y accesos.",
        );
      const value = await run(db);
      if (
        requireOwner &&
        !(await db.query("select private.is_system_administrator() allowed"))
          .rows[0].allowed
      )
        throw new HttpError(403, "Tu autorización cambió.");
      await db.query("commit");
      return value;
    } catch (e) {
      await db.query("rollback");
      throw e;
    } finally {
      db.release();
    }
  }
  async function read(db: Db, id: string) {
    const row = (
      await db.query("select " + columns + " from public.tenants where id=$1", [
        id,
      ])
    ).rows[0];
    if (!row) throw new HttpError(404, "Empresa no disponible.");
    const activities = (
      await db.query(
        "select code,name,is_primary as primary,active,source_url from public.economic_activities where tenant_id=$1 order by code",
        [id],
      )
    ).rows;
    const value = companyInput.parse({
      ...Object.fromEntries(
        [
          "legal_name",
          "trade_name",
          "person_type",
          "identification_type",
          "identification",
          "contact_email",
          "phone",
          "address",
          "active",
        ].map((k) => [k, row[k]]),
      ),
      configuration: row.configuration,
      activities,
    });
    return {
      ...row,
      configuration: value.configuration,
      activities,
      preparation: companyPreparation(value),
    };
  }
  async function validateConfiguration(value: CompanyInput) {
    const loc = value.configuration.location;
    if (Object.values(loc).some(Boolean)) {
      if (!loc.province || !loc.canton || !loc.district)
        throw new HttpError(
          400,
          "Domicilio fiscal: completa provincia, cantón y distrito, o deja el domicilio pendiente.",
        );
      const issues = await receiverLocationIssues(
        receiverInput.parse({ ...loc, domicile: "domestic" }),
      );
      if (issues.length)
        throw new HttpError(400, "Domicilio fiscal: " + issues[0].message);
    }
    const logo = value.configuration.logo;
    if (logo) {
      const match =
        /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(logo);
      if (!match) throw new HttpError(400, "El logotipo debe ser PNG o JPEG.");
      const bytes = Buffer.from(match[2], "base64");
      if (
        bytes.toString("base64") !== match[2] ||
        !validCompanyLogo(bytes, match[1])
      )
        throw new HttpError(400, "Logotipo inválido o mayor de 64 KiB.");
    }
  }
  async function duplicate(db: Db, value: CompanyInput, except?: string) {
    const aliases: Record<string, string[]> = {
      "01": ["01", "national"],
      "02": ["02", "legal"],
      "03": ["03", "dimex"],
      "04": ["04", "nite"],
    };
    const types = aliases[value.identification_type] ?? [
      value.identification_type,
    ];
    await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
      "company-id:" + types[0] + ":" + value.identification,
    ]);
    if (
      (
        await db.query(
          "select 1 from public.tenants where identification_type=any($1::text[]) and regexp_replace(identification,'[-[:space:]]','','g')=$2 and ($3::uuid is null or id<>$3)",
          [types, value.identification, except ?? null],
        )
      ).rowCount
    )
      throw new HttpError(409, "Ya existe una empresa con esa identificación.");
  }
  async function children(db: Db, id: string, value: CompanyInput) {
    // Existing records are retained, including inactive activities and sequence rows.
    await db.query(
      "update public.economic_activities set is_primary=false where tenant_id=$1 and is_primary",
      [id],
    );
    const codes = value.activities.map((a) => a.code);
    await db.query(
      "update public.economic_activities set active=false where tenant_id=$1 and not(code=any($2::text[]))",
      [id, codes],
    );
    for (const a of value.activities)
      await db.query(
        "insert into public.economic_activities(tenant_id,code,name,source_url,active,is_primary) values($1,$2,$3,$4,$5,$6) on conflict(tenant_id,code) do update set name=excluded.name,source_url=excluded.source_url,active=excluded.active,is_primary=excluded.is_primary",
        [id, a.code, a.name, a.source_url, a.active, a.primary],
      );
    const b = value.configuration.billing;
    if (b.branch_code) {
      const branch = (
        await db.query(
          "insert into public.branches(tenant_id,code,name) values($1,$2,'Sucursal '||$2) on conflict(tenant_id,code) do update set code=excluded.code returning id",
          [id, b.branch_code],
        )
      ).rows[0].id;
      if (b.terminal_code) {
        const terminal = (
          await db.query(
            "insert into public.terminals(tenant_id,branch_id,code,name) values($1,$2,$3,'Terminal '||$3) on conflict(tenant_id,branch_id,code) do update set code=excluded.code returning id",
            [id, branch, b.terminal_code],
          )
        ).rows[0].id;
        for (const type of b.documents)
          await db.query(
            "insert into public.document_sequences(tenant_id,branch_id,terminal_id,document_type) values($1,$2,$3,$4) on conflict do nothing",
            [id, branch, terminal, type],
          );
      }
    }
  }
  async function initialize(db: Db, id: string, value: CompanyInput) {
    const departments = (
      await db.query(
        "insert into public.departments(tenant_id,name) values($1,'Facturación'),($1,'Cuentas por cobrar'),($1,'Cuentas por pagar') returning id,name",
        [id],
      )
    ).rows;
    for (const environment of ["test", "production"]) {
      await db.query(
        "insert into public.tax_settings(tenant_id,environment,currency) values($1,$2,$3)",
        [id, environment, value.configuration.billing.currency],
      );
      await db.query(
        "insert into public.hacienda_configuration(tenant_id,environment) values($1,$2)",
        [id, environment],
      );
    }
    for (const [flow, name] of [
      ["collections", "Cuentas por cobrar"],
      ["payables", "Cuentas por pagar"],
    ])
      await db.query(
        "insert into public.document_routes(tenant_id,flow,target_department_id,enabled) values($1,$2,$3,false)",
        [id, flow, departments.find((d) => d.name === name)!.id],
      );
  }
  app.get(base, async (req) => {
    const p = await auth.authenticate(req);
    return transaction(
      p.claims,
      async (db) => {
        const canManage = (
          await db.query("select private.is_system_administrator() allowed")
        ).rows[0].allowed;
        if (!canManage) return { canManage: false, items: [] };
        return {
          canManage: true,
          items: (
            await db.query(
              "select " +
                columns +
                " from public.tenants order by legal_name,id",
            )
          ).rows,
        };
      },
      false,
    );
  });
  app.get(base + "/locations", async (req) => {
    const p = await auth.authenticate(req);
    return transaction(p.claims, async () =>
      JSON.parse(
        await readFile("docs/reference/hacienda/v4.4/locations.json", "utf8"),
      ),
    );
  });
  app.get(base + "/identity-lookup", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const p = await auth.authenticate(req);
    const input = z
      .object({ identification: recipientIdentificationInput })
      .strict()
      .parse(req.query);
    await transaction(p.claims, async () => {});
    await auth.limit("company-lookup:" + p.userId, 20);
    return lookup.recipient(input.identification);
  });
  app.get(base + "/:id", async (req) => {
    const p = await auth.authenticate(req),
      { id } = params.parse(req.params);
    return transaction(p.claims, async (db) => {
      return {
        item: await read(db, id),
        sequences: (
          await db.query(
            "select terminal_id,document_type,last_value::text from public.document_sequences where tenant_id=$1",
            [id],
          )
        ).rows,
      };
    });
  });
  app.post(base, { bodyLimit: 160 * 1024 }, async (req) => {
    const p = req.principal!;
    // Authorize before validation to avoid disclosing schema to unauthorized administrators.
    return transaction(p.claims, async (db) => {
      const parsed = createCompanyInput.parse(req.body);
      await validateConfiguration(parsed);
      const quota = (
        await db.query(
          "insert into private.rate_limits(key,count,reset_at) values($1,1,now()+interval '15 minutes') on conflict(key) do update set count=case when private.rate_limits.reset_at<now() then 1 else private.rate_limits.count+1 end,reset_at=case when private.rate_limits.reset_at<now() then now()+interval '15 minutes' else private.rate_limits.reset_at end returning count",
          [hash("company-create:" + p.userId)],
        )
      ).rows[0].count;
      if (quota > 20)
        throw new HttpError(
          429,
          "Demasiadas altas de empresa. Intenta nuevamente más tarde.",
        );
      const { operation_id, ...value } = parsed;
      await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
        "company-operation:" + p.userId + ":" + operation_id,
      ]);
      const fingerprint = hash(JSON.stringify(value));
      const old = (
        await db.query(
          "select tenant_id,request_hash from private.company_operations where actor_id=$1 and operation_id=$2",
          [p.userId, operation_id],
        )
      ).rows[0];
      if (old) {
        if (old.request_hash !== fingerprint)
          throw new HttpError(
            409,
            "La operación ya fue utilizada con otros datos.",
          );
        return { item: await read(db, old.tenant_id) };
      }
      await duplicate(db, value);
      const keys = [
        "legal_name",
        "trade_name",
        "person_type",
        "identification_type",
        "identification",
        "contact_email",
        "phone",
        "address",
        "active",
        "configuration",
      ];
      const id = (
        await db.query(
          "insert into public.tenants(" +
            keys.join(",") +
            ",created_by,updated_by) values(" +
            keys.map((_, i) => "$" + (i + 1)).join(",") +
            ",$11,$11) returning id",
          [...keys.map((k) => (value as any)[k]), p.userId],
        )
      ).rows[0].id;
      await db.query(
        "insert into public.memberships(tenant_id,user_id,scope) values($1,$2,'company')",
        [id, p.userId],
      );
      await db.query(
        "insert into public.membership_roles select tenant_id,$2,id from public.roles where tenant_id=$1 and code='admin'",
        [id, p.userId],
      );
      await children(db, id, value);
      await initialize(db, id, value);
      await db.query(
        "insert into private.company_operations values($1,$2,$3,$4,now())",
        [p.userId, operation_id, fingerprint, id],
      );
      await db.query(
        "insert into public.audit_events(tenant_id,actor_id,action,entity,entity_id) values($1,$2,'COMPANY_CREATED','tenants',$3)",
        [id, p.userId, id],
      );
      return {
        item: await read(db, id),
        sequences: (
          await db.query(
            "select terminal_id,document_type,last_value::text from public.document_sequences where tenant_id=$1",
            [id],
          )
        ).rows,
      };
    });
  });
  app.patch(base + "/:id", { bodyLimit: 160 * 1024 }, async (req) => {
    const p = req.principal!,
      { id } = params.parse(req.params);
    return transaction(p.claims, async (db) => {
      const old = (
        await db.query(
          "select configuration_version,identification_type,identification from public.tenants where id=$1 for update",
          [id],
        )
      ).rows[0];
      if (!old) throw new HttpError(404, "Empresa no disponible.");
      const { expected_version, ...value } = updateCompanyInput.parse(req.body);
      if (expected_version !== old.configuration_version)
        throw new HttpError(
          409,
          "La empresa cambió. Recarga antes de guardar.",
        );
      if (
        !["01", "02", "03", "04"].includes(value.identification_type) &&
        (value.identification_type !== old.identification_type ||
          value.identification !== old.identification.replace(/[-\s]/g, ""))
      )
        throw new HttpError(
          400,
          "Utiliza un tipo de identificación válido para cambiar estos datos.",
        );
      const legacyActivities = (
        await db.query(
          "select code from public.economic_activities where tenant_id=$1",
          [id],
        )
      ).rows.map((r) => r.code);
      if (
        value.activities.some(
          (a) =>
            !isEconomicActivityCode(a.code) &&
            !legacyActivities.includes(a.code),
        )
      )
        throw new HttpError(
          400,
          "Los códigos nuevos de actividad deben tener seis caracteres; conserva el punto cuando corresponda.",
        );
      await validateConfiguration(value);
      await duplicate(db, value, id);
      if (!["01", "02", "03", "04"].includes(value.identification_type))
        value.identification = old.identification;
      const keys = [
        "legal_name",
        "trade_name",
        "person_type",
        "identification_type",
        "identification",
        "contact_email",
        "phone",
        "address",
        "active",
        "configuration",
      ];
      await db.query(
        "update public.tenants set " +
          keys.map((k, i) => k + "=$" + (i + 2)).join(",") +
          " where id=$1",
        [id, ...keys.map((k) => (value as any)[k])],
      );
      await children(db, id, value);
      return {
        item: await read(db, id),
        sequences: (
          await db.query(
            "select terminal_id,document_type,last_value::text from public.document_sequences where tenant_id=$1",
            [id],
          )
        ).rows,
      };
    });
  });
}
