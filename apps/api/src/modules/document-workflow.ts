import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  workflowFlow,
  workflowState,
  routeInput,
  workInput,
} from "../../../../packages/domain/src/document-workflow";
import { HttpError, requirePermission, type Claims } from "../db";
import type { identity } from "./identity";
import { found, pattern, page } from "./billing-common";
const params = z
  .object({ tenantId: z.uuid(), id: z.uuid().optional() })
  .strict();
const list = z
  .object({
    flow: workflowFlow,
    state: workflowState.optional(),
    search: z.string().max(100).default(""),
    cursor: z.coerce.number().int().min(0).max(1000000).default(0),
  })
  .strict();
const summary = `w.id,w.source_kind,w.source_id,w.source_department_id,w.source_version,w.current_version,w.flow,w.target_department_id,w.assignee_id,w.customer_name,w.state,w.version,w.created_at,w.updated_at,(select p.name from public.profiles p where p.id=w.assignee_id) assignee_name,private.has_access(w.tenant_id,'collections.manage',w.target_department_id) can_manage,(w.source_version<>w.current_version) needs_review,(w.assignee_id is not null and not private.workflow_assignee_eligible(w.tenant_id,w.assignee_id,w.target_department_id,w.flow)) requires_reassignment`;
export function documentWorkflowRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  auth: ReturnType<typeof identity>,
) {
  const base = "/api/companies/:tenantId";
  type Check = (db: pg.PoolClient) => Promise<void>;
  async function transaction<T>(
    claims: Claims,
    tenant: string,
    check: Check,
    run: (db: pg.PoolClient) => Promise<T>,
  ) {
    const db = await pool.connect();
    try {
      await db.query("begin");
      await db.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify(claims),
      ]);
      await db.query("select id from public.tenants where id=$1 for update", [
        tenant,
      ]);
      await check(db);
      const value = await run(db);
      await check(db);
      await db.query("commit");
      return value;
    } catch (e) {
      await db.query("rollback");
      throw e;
    } finally {
      db.release();
    }
  }
  const configuration =
    (t: string): Check =>
    async (db) => {
      await requirePermission(db, t, "company.manage");
      await requirePermission(db, t, "organization.manage");
    };
  const flowRead =
    (t: string, flow: string): Check =>
    async (db) => {
      if (
        !(
          await db.query(
            "select private.has_access($1,$2,null) or exists(select 1 from public.departments where tenant_id=$1 and private.has_access($1,$2,id)) allowed",
            [t, flow + ".read"],
          )
        ).rows[0]?.allowed
      )
        throw new HttpError(
          403,
          "No tienes permiso para consultar esta bandeja.",
        );
    };
  async function audit(
    db: pg.PoolClient,
    claims: Claims,
    t: string,
    action: string,
    id: string,
    details: Record<string, unknown> = {},
  ) {
    await db.query(
      "insert into public.audit_events(tenant_id,actor_id,action,entity,entity_id,details) values($1,$2,$3,'document_workflow',$4,$5)",
      [t, claims.sub, action, id, JSON.stringify(details)],
    );
  }
  async function routes(db: pg.PoolClient, t: string) {
    return {
      items: (
        await db.query(
          `select r.*,d.name department_name,p.name assignee_name,(r.assignee_id is not null and not private.workflow_assignee_eligible(r.tenant_id,r.assignee_id,r.target_department_id,r.flow)) requires_reassignment from public.document_routes r left join public.departments d on d.tenant_id=r.tenant_id and d.id=r.target_department_id left join public.profiles p on p.id=r.assignee_id where r.tenant_id=$1 order by r.flow`,
          [t],
        )
      ).rows,
    };
  }
  app.get(base + "/document-routes", async (req) => {
    const p = await auth.authenticate(req),
      { tenantId } = params.parse(req.params);
    return transaction(p.claims, tenantId, configuration(tenantId), (db) =>
      routes(db, tenantId),
    );
  });
  app.post(base + "/document-routes/setup", async (req) => {
    const p = req.principal!,
      { tenantId } = params.parse(req.params);
    z.object({})
      .strict()
      .parse(req.body ?? {});
    return transaction(
      p.claims,
      tenantId,
      configuration(tenantId),
      async (db) => {
        for (const [flow, name] of [
          ["collections", "Cuentas por cobrar"],
          ["payables", "Cuentas por pagar"],
        ]) {
          await db.query(
            "insert into public.departments(tenant_id,name) values($1,$2) on conflict(tenant_id,name) do nothing",
            [tenantId, name],
          );
          const dep = (
            await db.query(
              "select id,active from public.departments where tenant_id=$1 and name=$2",
              [tenantId, name],
            )
          ).rows[0];
          if (!dep?.active)
            throw new HttpError(
              409,
              "Un departamento predeterminado está inactivo. Configura un destino activo.",
            );
          await db.query(
            "insert into public.document_routes(tenant_id,flow,target_department_id,enabled) values($1,$2,$3,true) on conflict do nothing",
            [tenantId, flow, dep.id],
          );
        }
        await audit(db, p.claims, tenantId, "routes_setup", tenantId);
        return routes(db, tenantId);
      },
    );
  });
  app.get(base + "/document-routes/eligible-assignees", async (req) => {
    const p = await auth.authenticate(req),
      { tenantId } = params.parse(req.params),
      q = z
        .object({
          flow: workflowFlow,
          department_id: z.uuid(),
          search: z.string().max(100).default(""),
          cursor: z.coerce.number().int().min(0).max(1000000).default(0),
        })
        .strict()
        .parse(req.query);
    return transaction(
      p.claims,
      tenantId,
      async (db) => {
        if (
          !(
            await db.query(
              "select private.workflow_configuration_access($1) allowed",
              [tenantId],
            )
          ).rows[0]?.allowed
        )
          await requirePermission(
            db,
            tenantId,
            q.flow + ".manage",
            q.department_id,
          );
      },
      async (db) =>
        page(
          (
            await db.query(
              `select p.id,p.name from public.memberships m join public.profiles p on p.id=m.user_id where m.tenant_id=$1 and private.workflow_assignee_eligible($1,m.user_id,$2,$3) and p.name ilike $4 order by p.name,p.id limit 51 offset $5`,
              [tenantId, q.department_id, q.flow, pattern(q.search), q.cursor],
            )
          ).rows,
          q.cursor,
        ),
    );
  });
  app.patch(base + "/document-routes", async (req) => {
    const p = req.principal!,
      { tenantId } = params.parse(req.params),
      input = routeInput.parse(req.body);
    return transaction(
      p.claims,
      tenantId,
      configuration(tenantId),
      async (db) => {
        const old = (
          await db.query(
            "select version from public.document_routes where tenant_id=$1 and flow=$2 for update",
            [tenantId, input.flow],
          )
        ).rows[0];
        if ((old?.version ?? 0) !== input.expected_version)
          throw new HttpError(409, "La ruta cambió. Recarga su configuración.");
        if (input.enabled) {
          if (
            !(
              await db.query(
                "select id from public.departments where tenant_id=$1 and id=$2 and active",
                [tenantId, input.target_department_id],
              )
            ).rows[0] ||
            !(
              await db.query(
                "select private.workflow_assignee_eligible($1,$2,$3,$4) allowed",
                [
                  tenantId,
                  input.assignee_id,
                  input.target_department_id,
                  input.flow,
                ],
              )
            ).rows[0].allowed
          )
            throw new HttpError(400, "Destino o responsable no autorizado.");
        }
        await db.query(
          `insert into public.document_routes(tenant_id,flow,target_department_id,assignee_id,enabled) values($1,$2,$3,$4,$5) on conflict(tenant_id,flow) do update set target_department_id=excluded.target_department_id,assignee_id=excluded.assignee_id,enabled=excluded.enabled,version=public.document_routes.version+1,updated_at=now()`,
          [
            tenantId,
            input.flow,
            input.target_department_id,
            input.assignee_id,
            input.enabled,
          ],
        );
        await audit(db, p.claims, tenantId, "route_updated", input.flow);
        return routes(db, tenantId);
      },
    );
  });
  app.post(base + "/invoice-drafts/:id/collection-review", async (req) => {
    const p = req.principal!,
      { tenantId, id } = params.parse(req.params),
      input = z
        .object({ expected_version: z.number().int().min(1) })
        .strict()
        .parse(req.body);
    let origin: string | undefined;
    const permission: Check = async (db) => {
      if (origin) {
        await requirePermission(db, tenantId, "invoices.manage", origin);
        await requirePermission(
          db,
          tenantId,
          "document_workflow.assign",
          origin,
        );
      } else if (
        !(
          await db.query("select private.member_access($1) allowed", [tenantId])
        ).rows[0]?.allowed
      )
        throw new HttpError(403, "Sesión no autorizada.");
    };
    return transaction(p.claims, tenantId, permission, async (db) => {
      const route = (
        await db.query("select * from private.collection_route($1,$2)", [
          tenantId,
          id,
        ])
      ).rows[0];
      const source = found(
        (
          await db.query("select * from private.assignment_source($1,$2)", [
            tenantId,
            id,
          ])
        ).rows[0],
      );
      origin = source.department_id;
      await permission(db);
      if (source.archived_at || source.version !== input.expected_version)
        throw new HttpError(
          409,
          "El borrador cambió o está archivado. Recarga antes de asignarlo.",
        );
      const existing = (
        await db.query("select private.work_assignment_id($1,$2) id", [
          tenantId,
          id,
        ])
      ).rows[0].id;
      if (existing) return { assigned: true, id: existing };
      if (!route?.enabled)
        throw new HttpError(
          409,
          "Configura y habilita el destino de Cuentas por cobrar.",
        );
      const candidate = randomUUID();
      await db.query(
        "insert into public.document_work_items(id,tenant_id,source_id,source_department_id,source_version,current_version,target_department_id,assignee_id,customer_name,created_by) values($1,$2,$3,$4,$5,$5,$6,$7,$8,$9)",
        [
          candidate,
          tenantId,
          id,
          origin,
          source.version,
          route.target_department_id,
          route.assignee_id,
          source.customer_name,
          p.claims.sub,
        ],
      );
      const assigned = (
        await db.query("select private.work_assignment_id($1,$2) id", [
          tenantId,
          id,
        ])
      ).rows[0].id;
      await audit(db, p.claims, tenantId, "review_assigned", assigned, {
        source_version: source.version,
      });
      return { assigned: true, id: assigned };
    });
  });
  app.get(base + "/document-work-items", async (req) => {
    const p = await auth.authenticate(req),
      { tenantId } = params.parse(req.params),
      q = list.parse(req.query);
    return transaction(
      p.claims,
      tenantId,
      flowRead(tenantId, q.flow),
      async (db) => {
        if (q.flow === "payables")
          return {
            items: [],
            nextCursor: null,
            receipt_status: "not_implemented",
          };
        return page(
          (
            await db.query(
              `select ${summary} from public.document_work_items w where w.tenant_id=$1 and w.flow=$2 and ($3::text is null or w.state=$3) and (w.customer_name ilike $4 or w.id::text ilike $4) order by w.created_at desc,w.id limit 51 offset $5`,
              [tenantId, q.flow, q.state ?? null, pattern(q.search), q.cursor],
            )
          ).rows,
          q.cursor,
        );
      },
    );
  });
  app.patch(base + "/document-work-items/:id", async (req) => {
    const p = req.principal!,
      { tenantId, id } = params.parse(req.params),
      input = workInput.parse(req.body);
    let target: string | undefined;
    const permission: Check = async (db) => {
      if (target)
        await requirePermission(db, tenantId, "collections.manage", target);
      else await flowRead(tenantId, "collections")(db);
    };
    return transaction(p.claims, tenantId, permission, async (db) => {
      const lookup = found(
        (
          await db.query(
            "select source_id,target_department_id from public.document_work_items where tenant_id=$1 and id=$2",
            [tenantId, id],
          )
        ).rows[0],
      );
      target = lookup.target_department_id;
      await permission(db);
      await db.query(
        "select flow from public.document_routes where tenant_id=$1 and flow='collections' for share",
        [tenantId],
      );
      const source = found(
        (
          await db.query("select private.work_source_version($1,$2) version", [
            tenantId,
            id,
          ])
        ).rows[0],
      );
      const old = found(
        (
          await db.query(
            "select * from public.document_work_items where tenant_id=$1 and id=$2 for update",
            [tenantId, id],
          )
        ).rows[0],
      );
      if (
        old.version !== input.expected_version ||
        old.current_version !== input.expected_source_version ||
        source.version !== input.expected_source_version
      )
        throw new HttpError(
          409,
          "La tarea o el documento de origen cambiaron. Recarga antes de continuar.",
        );
      if (
        !(
          await db.query(
            "select private.workflow_assignee_eligible($1,$2,$3,'collections') allowed",
            [tenantId, input.assignee_id, target],
          )
        ).rows[0].allowed
      )
        throw new HttpError(400, "Selecciona un responsable autorizado.");
      await db.query(
        "update public.document_work_items set state=$3,assignee_id=$4,source_version=case when $3='resolved' then current_version else source_version end,version=version+1,updated_at=now() where tenant_id=$1 and id=$2",
        [tenantId, id, input.state, input.assignee_id],
      );
      await audit(db, p.claims, tenantId, "review_updated", id!, {
        state: input.state,
        source_version: input.expected_source_version,
      });
      return {
        item: (
          await db.query(
            `select ${summary} from public.document_work_items w where w.tenant_id=$1 and w.id=$2`,
            [tenantId, id],
          )
        ).rows[0],
      };
    });
  });
}
