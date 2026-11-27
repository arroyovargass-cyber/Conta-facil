import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { scoped, requirePermission, HttpError } from "../db";
import type { identity } from "./identity";
import { hash, randomToken } from "../security/crypto";
import { normalizeIdentification } from "../../../../packages/domain/src/identity";
import { economicActivityCode } from "../../../../packages/domain/src/economic-activity";
const text = z.string().trim().min(1).max(160);
export function companyRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  auth: ReturnType<typeof identity>,
) {
  const base = "/api/companies/:tenantId";
  const params = (v: unknown) => z.object({ tenantId: z.uuid() }).parse(v);
  app.get("/api/companies", async (req) => {
    const p = await auth.authenticate(req);
    return scoped(pool, p.claims, async (db) => ({
      items: (
        await db.query(
          "select t.*,m.scope from public.tenants t join public.memberships m on m.tenant_id=t.id where m.user_id=$1 and m.active and t.active order by t.legal_name",
          [p.userId],
        )
      ).rows,
      nextCursor: null,
    }));
  });
  app.get(base + "/overview", async (req) => {
    const p = await auth.authenticate(req),
      { tenantId } = params(req.params);
    return scoped(pool, p.claims, async (db) => {
      const company = await db.query(
        "select * from public.tenants where id=$1",
        [tenantId],
      );
      if (!company.rows[0]) throw new HttpError(404, "Empresa no disponible.");
      const permissions = (
        await db.query(
          "select code,private.has_access($1,code) as allowed from public.permission_catalog",
          [tenantId],
        )
      ).rows
        .filter((r) => r.allowed)
        .map((r) => r.code);
      const counts = await db.query(
        `select (select count(*)::int from public.memberships where tenant_id=$1 and active) users,(select count(*)::int from public.departments where tenant_id=$1 and active) departments,(select count(*)::int from public.branches where tenant_id=$1 and active) branches,(select count(*)::int from public.economic_activities where tenant_id=$1 and active) activities`,
        [tenantId],
      );
      return { company: company.rows[0], permissions, counts: counts.rows[0] };
    });
  });
  app.patch(base, async (req) => {
    const p = req.principal!,
      { tenantId } = params(req.params),
      input = z
        .object({
          legal_name: text,
          trade_name: z.string().max(160),
          identification_type: text,
          identification: text,
          contact_email: z.union([z.email(), z.literal("")]),
          phone: z.string().max(40),
          address: z.string().max(1000),
        })
        .strict()
        .parse(req.body);
    return scoped(pool, p.claims, async (db) => {
      await requirePermission(db, tenantId, "company.manage");
      throw new HttpError(
        409,
        "Utiliza el formulario de configuración de empresa con control de versión.",
      );
    });
  });
  const entities = {
    departments: {
      table: "departments",
      module: "organization",
      schema: z
        .object({ name: text, active: z.boolean().default(true) })
        .strict(),
    },
    "cost-centers": {
      table: "cost_centers",
      module: "organization",
      schema: z
        .object({
          name: text,
          department_id: z.uuid(),
          active: z.boolean().default(true),
        })
        .strict(),
    },
    branches: {
      table: "branches",
      module: "organization",
      schema: z
        .object({
          name: text,
          code: z.string().regex(/^\d{3}$/),
          active: z.boolean().default(true),
        })
        .strict(),
    },
    terminals: {
      table: "terminals",
      module: "organization",
      schema: z
        .object({
          name: text,
          code: z.string().regex(/^\d{5}$/),
          branch_id: z.uuid(),
          active: z.boolean().default(true),
        })
        .strict(),
    },
    "economic-activities": {
      table: "economic_activities",
      module: "tax",
      schema: z
        .object({
          name: text,
          code: economicActivityCode,
          source_url: z.url().refine((v) => new URL(v).protocol === "https:"),
          active: z.boolean().default(true),
        })
        .strict(),
    },
  };
  for (const [route, entity] of Object.entries(entities)) {
    app.get(base + "/" + route, async (req) => {
      const p = await auth.authenticate(req),
        { tenantId } = params(req.params),
        query = z
          .object({
            cursor: z.coerce.number().int().min(0).default(0),
            search: z.string().trim().max(100).default(""),
            active: z.enum(["true", "false"]).optional(),
          })
          .parse(req.query);
      return scoped(pool, p.claims, async (db) => {
        const result = await db.query(
          `select * from public.${entity.table} where tenant_id=$1 and name ilike $3 and ($4::boolean is null or active=$4) order by name,id limit 51 offset $2`,
          [
            tenantId,
            query.cursor,
            "%" + query.search.replace(/[\\%_]/g, "\\$&") + "%",
            query.active === undefined ? null : query.active === "true",
          ],
        );
        return {
          items: result.rows.slice(0, 50),
          nextCursor: result.rows.length > 50 ? query.cursor + 50 : null,
        };
      });
    });
    app.post(base + "/" + route, async (req) => {
      const p = req.principal!,
        { tenantId } = params(req.params),
        input = entity.schema.parse(req.body);
      return scoped(pool, p.claims, async (db) => {
        await requirePermission(db, tenantId, entity.module + ".manage");
        const fields = Object.keys(input);
        const result = await db.query(
          `insert into public.${entity.table}(tenant_id,${fields.join(",")}) values($1,${fields.map((_, i) => "$" + (i + 2)).join(",")}) returning *`,
          [tenantId, ...Object.values(input)],
        );
        return { item: result.rows[0] };
      });
    });
    app.patch(base + "/" + route + "/:id", async (req) => {
      const p = req.principal!,
        { tenantId } = params(req.params),
        { id } = z.object({ id: z.uuid() }).parse(req.params),
        input = entity.schema.parse(req.body);
      return scoped(pool, p.claims, async (db) => {
        await requirePermission(db, tenantId, entity.module + ".manage");
        const fields = Object.keys(input);
        const result = await db.query(
          `update public.${entity.table} set ${fields.map((f, i) => f + "=$" + (i + 3)).join(",")} where tenant_id=$1 and id=$2 returning *`,
          [tenantId, id, ...Object.values(input)],
        );
        if (!result.rowCount)
          throw new HttpError(404, "Registro no disponible.");
        return { item: result.rows[0] };
      });
    });
  }
  app.get(base + "/tax-settings", async (req) => {
    const p = await auth.authenticate(req),
      { tenantId } = params(req.params);
    return scoped(pool, p.claims, async (db) => {
      await requirePermission(db, tenantId, "tax.read");
      return {
        items: (
          await db.query(
            "select * from public.tax_settings where tenant_id=$1 order by environment",
            [tenantId],
          )
        ).rows,
      };
    });
  });
  app.post(base + "/tax-settings", async (req) => {
    const p = req.principal!,
      { tenantId } = params(req.params),
      input = z
        .object({
          environment: z.enum(["test", "production"]),
          currency: z.enum(["CRC", "USD"]),
          source_url: z.union([z.url(), z.literal("")]),
          notes: z.string().max(2000),
        })
        .strict()
        .parse(req.body);
    return scoped(pool, p.claims, async (db) => {
      await requirePermission(db, tenantId, "tax.manage");
      return {
        item: (
          await db.query(
            `insert into public.tax_settings(tenant_id,environment,currency,source_url,notes) values($1,$2,$3,$4,$5) on conflict(tenant_id,environment) do update set currency=excluded.currency,source_url=excluded.source_url,notes=excluded.notes,updated_at=now() returning *`,
            [
              tenantId,
              input.environment,
              input.currency,
              input.source_url,
              input.notes,
            ],
          )
        ).rows[0],
      };
    });
  });
  app.get(base + "/audit", async (req) => {
    const p = await auth.authenticate(req),
      { tenantId } = params(req.params),
      query = z
        .object({ cursor: z.coerce.number().int().positive().optional() })
        .parse(req.query);
    return scoped(pool, p.claims, async (db) => {
      await requirePermission(db, tenantId, "audit.read");
      const rows = (
        await db.query(
          "select * from public.audit_events where tenant_id=$1 and ($2::bigint is null or id<$2) order by id desc limit 51",
          [tenantId, query.cursor ?? null],
        )
      ).rows;
      return {
        items: rows.slice(0, 50),
        nextCursor: rows.length > 50 ? rows[49].id : null,
      };
    });
  });
  app.get(base + "/roles", async (req) => {
    const p = await auth.authenticate(req),
      { tenantId } = params(req.params);
    return scoped(pool, p.claims, async (db) => {
      await requirePermission(db, tenantId, "users.read");
      return {
        items: (
          await db.query(
            `select r.*,coalesce(array_agg(rp.permission) filter(where rp.permission is not null),'{}') permissions from public.roles r left join public.role_permissions rp on rp.role_id=r.id where r.tenant_id=$1 group by r.id order by r.name`,
            [tenantId],
          )
        ).rows,
      };
    });
  });
  app.get(base + "/memberships", async (req) => {
    const p = await auth.authenticate(req),
      { tenantId } = params(req.params);
    return scoped(pool, p.claims, async (db) => {
      await requirePermission(db, tenantId, "users.read");
      return {
        items: (
          await db.query(
            `select m.*,coalesce((select array_agg(mr.role_id) from public.membership_roles mr where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id),'{}') role_ids,coalesce((select array_agg(md.department_id) from public.membership_departments md where md.tenant_id=m.tenant_id and md.user_id=m.user_id),'{}') department_ids,(select array_agg(r.name) from public.membership_roles mr join public.roles r on r.id=mr.role_id where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id) roles from public.memberships m where m.tenant_id=$1 order by m.user_id`,
            [tenantId],
          )
        ).rows,
      };
    });
  });
  // Privileged mutations: authorization is rechecked inside the same locked transaction.
  async function administration<T>(
    p: NonNullable<import("fastify").FastifyRequest["principal"]>,
    tenantId: string,
    run: (db: pg.PoolClient) => Promise<T>,
  ) {
    const db = await pool.connect();
    try {
      await db.query("begin");
      await db.query("select id from public.tenants where id=$1 for update", [
        tenantId,
      ]);
      await db.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify(p.claims),
      ]);
      await requirePermission(db, tenantId, "users.manage");
      const result = await run(db);
      await db.query("commit");
      return result;
    } catch (e) {
      await db.query("rollback");
      throw e;
    } finally {
      db.release();
    }
  }
  app.patch(base + "/memberships/:userId", async (req) => {
    const p = req.principal!,
      { tenantId } = params(req.params),
      { userId } = z.object({ userId: z.uuid() }).parse(req.params),
      input = z
        .object({
          active: z.boolean(),
          scope: z.enum(["company", "departments"]),
          role_id: z.uuid(),
          department_ids: z.array(z.uuid()).max(100),
        })
        .strict()
        .parse(req.body);
    return administration(p, tenantId, async (db) => {
      const role = await db.query(
        "select code from public.roles where tenant_id=$1 and id=$2",
        [tenantId, input.role_id],
      );
      if (!role.rows[0]) throw new HttpError(400, "Rol inválido.");
      if (role.rows[0].code === "admin" && input.scope !== "company")
        throw new HttpError(
          400,
          "El administrador requiere alcance empresarial.",
        );
      const deps = await db.query(
        "select id from public.departments where tenant_id=$1 and id=any($2::uuid[]) and active",
        [tenantId, input.department_ids],
      );
      if (deps.rowCount !== new Set(input.department_ids).size)
        throw new HttpError(400, "Departamento inválido.");
      const result = await db.query(
        "update public.memberships set active=$3,scope=$4 where tenant_id=$1 and user_id=$2 returning *",
        [tenantId, userId, input.active, input.scope],
      );
      if (!result.rowCount)
        throw new HttpError(404, "Membresía no disponible.");
      const oldRoles = await db.query(
        "select role_id from public.membership_roles where tenant_id=$1 and user_id=$2",
        [tenantId, userId],
      );
      await db.query(
        "insert into public.membership_roles(tenant_id,user_id,role_id) values($1,$2,$3) on conflict do nothing",
        [tenantId, userId, input.role_id],
      );
      if (oldRoles.rows.some((r) => r.role_id !== input.role_id)) {
        const admins = await db.query(
          `select count(*)::int n from public.memberships m join public.membership_roles mr using(tenant_id,user_id) join public.roles r on r.id=mr.role_id where m.tenant_id=$1 and m.active and r.code='admin' and (m.user_id<>$2 or mr.role_id=$3)`,
          [tenantId, userId, input.role_id],
        );
        if (admins.rows[0].n === 0)
          throw new HttpError(409, "Debe permanecer un administrador activo.");
        // Remove old bindings with trigger protection; last-admin role is never removed without another admin.
        await db.query(
          "delete from public.membership_roles where tenant_id=$1 and user_id=$2 and role_id<>$3",
          [tenantId, userId, input.role_id],
        );
      }
      await db.query(
        "delete from public.membership_departments where tenant_id=$1 and user_id=$2",
        [tenantId, userId],
      );
      for (const d of input.department_ids)
        await db.query(
          "insert into public.membership_departments values($1,$2,$3)",
          [tenantId, userId, d],
        );
      return { item: result.rows[0] };
    });
  });
  app.post(base + "/roles", async (req) => {
    const p = req.principal!,
      { tenantId } = params(req.params),
      input = z
        .object({
          name: text,
          permissions: z
            .array(
              z.enum([
                "company.read",
                "organization.read",
                "users.read",
                "tax.read",
                "audit.read",
                "customers.read",
                "customers.manage",
                "catalog.read",
                "catalog.manage",
                "invoices.read",
                "invoices.manage",
                "invoices.create",
                "invoices.prepare",
                "invoices.email",
                "invoices.numbering",
                "reports.read",
                "invoices.edit",
                "invoices.delete",
                "invoices.emit",
                "invoices.query",
                "invoices.download",
                "invoices.credit_note",
                "invoices.debit_note",
                "hacienda.read",
                "hacienda.credentials.manage",
                "hacienda.connection.test",
                "collections.read",
                "collections.manage",
                "payables.read",
                "payables.manage",
                "document_workflow.assign",
              ]),
            )
            .min(1),
        })
        .strict()
        .parse(req.body);
    return administration(p, tenantId, async (db) => {
      const r = await db.query(
        "insert into public.roles(tenant_id,code,name) values($1,$2,$3) returning *",
        [tenantId, "custom_" + randomToken().slice(0, 12), input.name],
      );
      const permissions = new Set<string>(input.permissions);
      for (const permission of input.permissions)
        if (permission.endsWith(".manage"))
          permissions.add(
            permission === "hacienda.credentials.manage"
              ? "hacienda.read"
              : permission.replace(".manage", ".read"),
          );
      for (const perm of permissions)
        await db.query("insert into public.role_permissions values($1,$2,$3)", [
          tenantId,
          r.rows[0].id,
          perm,
        ]);
      return { item: r.rows[0] };
    });
  });
  app.post(base + "/invitations", async (req) => {
    const p = req.principal!,
      { tenantId } = params(req.params),
      input = z
        .object({
          email: z.email(),
          role_id: z.uuid(),
          scope: z.enum(["company", "departments"]),
          department_ids: z.array(z.uuid()).default([]),
        })
        .strict()
        .parse(req.body);
    const token = randomToken();
    const invite = await administration(p, tenantId, async (db) => {
      const r = await db.query(
        "select code from public.roles where tenant_id=$1 and id=$2",
        [tenantId, input.role_id],
      );
      if (!r.rowCount) throw new HttpError(400, "Rol inválido.");
      if (r.rows[0].code === "admin" && input.scope !== "company")
        throw new HttpError(
          400,
          "El administrador requiere alcance empresarial.",
        );
      for (const d of input.department_ids) {
        if (
          !(
            await db.query(
              "select id from public.departments where tenant_id=$1 and id=$2",
              [tenantId, d],
            )
          ).rowCount
        )
          throw new HttpError(400, "Departamento inválido.");
      }
      const member = await db.query(
        "select 1 from public.memberships m join private.login_directory d on d.user_id=m.user_id where m.tenant_id=$1 and d.email=$2",
        [tenantId, input.email.toLowerCase()],
      );
      if (member.rowCount)
        throw new HttpError(
          409,
          "Este usuario ya pertenece a la empresa. Administra su membresía existente.",
        );
      const row = await db.query(
        `insert into private.invitations(tenant_id,email,role_id,scope,department_ids,token_hash,expires_at) values($1,$2,$3,$4,$5,$6,now()+interval '48 hours') returning id`,
        [
          tenantId,
          input.email.toLowerCase(),
          input.role_id,
          input.scope,
          input.department_ids,
          hash(token),
        ],
      );
      await db.query(
        `insert into public.audit_events(tenant_id,actor_id,action,entity,entity_id) values($1,$2,'INVITE','memberships',$3)`,
        [tenantId, p.userId, row.rows[0].id],
      );
      return row.rows[0];
    });
    const redirectTo = app.configOrigin + "/invite?invitation=" + token;
    const result = await auth.admin.auth.admin.inviteUserByEmail(input.email, {
      redirectTo,
    });
    if (result.error) {
      const existing = await pool.query(
        "select user_id from private.login_directory where email=$1",
        [input.email.toLowerCase()],
      );
      if (!existing.rowCount) {
        await pool.query("delete from private.invitations where id=$1", [
          invite.id,
        ]);
        throw new HttpError(400, "No se pudo enviar la invitación.");
      }
      const sent = await auth.client().auth.signInWithOtp({
        email: input.email,
        options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
      });
      if (sent.error) {
        await pool.query("delete from private.invitations where id=$1", [
          invite.id,
        ]);
        throw new HttpError(400, "No se pudo enviar la invitación.");
      }
    }
    return { ok: true };
  });
  app.post("/api/auth/invitations/accept", async (req) => {
    await auth.limit("invite:" + req.ip, 12);
    const input = z
      .object({
        token: z.string().min(32),
        access_token: z.string().min(20),
        country: z.string().default("CR"),
        type: z.enum(["national", "dimex", "other"]),
        identification: text,
        name: text,
        password: z.string().min(12).max(256),
      })
      .strict()
      .parse(req.body);
    const { data, error } = await auth
      .client()
      .auth.getUser(input.access_token);
    if (error || !data.user?.email_confirmed_at)
      throw new HttpError(401, "Verifica el correo de la invitación.");
    const value = normalizeIdentification({
      country: input.country,
      type: input.type,
      value: input.identification,
    });
    const db = await pool.connect();
    try {
      await db.query("begin");
      const pending = await db.query(
        "select tenant_id from private.invitations where token_hash=$1",
        [hash(input.token)],
      );
      if (!pending.rowCount)
        throw new HttpError(400, "Invitación vencida o inválida.");
      await db.query("select id from public.tenants where id=$1 for update", [
        pending.rows[0].tenant_id,
      ]);
      const r = await db.query(
        "select * from private.invitations where token_hash=$1 and accepted_at is null and expires_at>now() for update",
        [hash(input.token)],
      );
      const inv = r.rows[0];
      if (!inv || inv.email !== data.user.email?.toLowerCase())
        throw new HttpError(400, "Invitación vencida o inválida.");
      const member = await db.query(
        "select 1 from public.memberships where tenant_id=$1 and user_id=$2",
        [inv.tenant_id, data.user.id],
      );
      if (member.rowCount)
        throw new HttpError(
          409,
          "Este usuario ya pertenece a la empresa. Administra su membresía existente.",
        );
      await db.query(
        "insert into public.profiles(id,name) values($1,$2) on conflict(id) do nothing",
        [data.user.id, input.name],
      );
      const old = await db.query(
        "select user_id from private.login_directory where user_id=$1",
        [data.user.id],
      );
      if (!old.rowCount) {
        await db.query(
          "insert into private.login_directory values($1,$2,$3,$4,$5)",
          [data.user.id, input.country, input.type, value, inv.email],
        );
        const updated = await auth.admin.auth.admin.updateUserById(
          data.user.id,
          { password: input.password },
        );
        if (updated.error) throw new HttpError(400, "Contraseña no válida.");
      }
      await db.query(
        `insert into public.memberships(tenant_id,user_id,scope) values($1,$2,$3) on conflict(tenant_id,user_id) do nothing`,
        [inv.tenant_id, data.user.id, inv.scope],
      );
      await db.query(
        "insert into public.membership_roles values($1,$2,$3) on conflict do nothing",
        [inv.tenant_id, data.user.id, inv.role_id],
      );
      for (const d of inv.department_ids)
        await db.query(
          "insert into public.membership_departments values($1,$2,$3) on conflict do nothing",
          [inv.tenant_id, data.user.id, d],
        );
      await db.query(
        "update private.invitations set accepted_at=now() where id=$1",
        [inv.id],
      );
      await db.query(
        `insert into public.audit_events(tenant_id,actor_id,action,entity) values($1,$2,'ACCEPT_INVITATION','memberships')`,
        [inv.tenant_id, data.user.id],
      );
      await db.query("commit");
      return { ok: true };
    } catch (e) {
      await db.query("rollback");
      throw e;
    } finally {
      db.release();
    }
  });
}
declare module "fastify" {
  interface FastifyInstance {
    configOrigin: string;
  }
}
