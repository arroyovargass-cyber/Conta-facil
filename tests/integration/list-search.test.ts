import { beforeAll, afterAll, it, expect } from "vitest";
import { createApp } from "../../apps/api/src/app";
import { workspace } from "../support/workspace";
import { runtimeConfig } from "../support/runtime-config";
let fixture: Awaited<ReturnType<typeof workspace>>,
  app: Awaited<ReturnType<typeof createApp>>,
  cookie = "",
  foreign = "";
beforeAll(async () => {
  fixture = await workspace({ role: "accountant" });
  app = await createApp(await runtimeConfig(fixture.config));
  cookie = (await fixture.login(app)).cookie;
  for (let i = 0; i < 60; i++)
    await fixture.pool.query(
      "insert into public.departments(tenant_id,name) values($1,$2)",
      [fixture.tenants[0], "Departamento " + String(i).padStart(2, "0")],
    );
  for (const name of ["100% Real", "1000 Real", "Equipo_A", "EquipoBA"])
    await fixture.pool.query(
      "insert into public.departments(tenant_id,name) values($1,$2)",
      [fixture.tenants[0], name],
    );
  await fixture.pool.query(
    "insert into public.departments(tenant_id,name,active) values($1,'Zeta Mantenimiento',false)",
    [fixture.tenants[0]],
  );
  foreign = (
    await fixture.pool.query(
      "insert into public.tenants(legal_name,identification_type,identification) values('Ajena','other',$1) returning id",
      [fixture.tag + "foreign"],
    )
  ).rows[0].id;
  await fixture.pool.query(
    "insert into public.departments(tenant_id,name) values($1,'Zeta No autorizado')",
    [foreign],
  );
});
afterAll(async () => {
  await app?.close();
  await fixture?.pool.end();
});
const list = (query: string, tenant?: string) =>
  app.inject({
    url:
      "/api/companies/" +
      (tenant ?? fixture.tenants[0]) +
      "/departments?" +
      query,
    headers: { cookie },
  });
it("finds matching records beyond the first loaded page", async () => {
  const r = await list("search=" + encodeURIComponent("zeta mantenimiento"));
  expect(r.statusCode, r.body).toBe(200);
  expect(r.json().items.map((d: any) => d.name)).toEqual([
    "Zeta Mantenimiento",
  ]);
  expect(r.json().nextCursor).toBeNull();
});
it("applies active and inactive filters in the database", async () => {
  expect((await list("search=Zeta&active=true")).json().items).toEqual([]);
  expect((await list("search=Zeta&active=false")).json().items).toHaveLength(1);
  expect((await list("active=invalid")).statusCode).toBe(400);
});
it("searches literal percent and underscore instead of expanding SQL wildcards", async () => {
  expect(
    (await list("search=" + encodeURIComponent("100%")))
      .json()
      .items.map((d: any) => d.name),
  ).toEqual(["100% Real"]);
  expect(
    (await list("search=" + encodeURIComponent("Equipo_A")))
      .json()
      .items.map((d: any) => d.name),
  ).toEqual(["Equipo_A"]);
});
it("paginates the filtered result consistently", async () => {
  const first = (await list("search=Departamento")).json(),
    second = (
      await list("search=Departamento&cursor=" + first.nextCursor)
    ).json();
  expect(first.items).toHaveLength(50);
  expect(second.items).toHaveLength(10);
  expect(second.nextCursor).toBeNull();
  expect(new Set([...first.items, ...second.items].map((d) => d.id)).size).toBe(
    60,
  );
});
it("preserves tenant isolation and rejects oversized searches", async () => {
  expect((await list("search=Zeta", foreign)).json().items).toEqual([]);
  expect(
    (await list("search=" + encodeURIComponent("' OR 1=1--"))).json().items,
  ).toEqual([]);
  expect((await list("search=" + "x".repeat(101))).statusCode).toBe(400);
});
