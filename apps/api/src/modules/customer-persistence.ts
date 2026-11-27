import type pg from "pg";
import {
  customerInput,
  type CustomerInput,
} from "../../../../packages/domain/src/billing";
import { receiverInput } from "../../../../packages/domain/src/invoice-fiscal";
import { HttpError } from "../db";
export const CUSTOMER_COLUMNS = [
  "name",
  "identification_type",
  "identification",
  "email",
  "phone",
  "phone_country_code",
  "address",
  "active",
  "trade_name",
  "economic_activity",
  "province",
  "canton",
  "district",
  "neighborhood",
  "exoneration",
  "domicile",
  "foreign_address",
  "requires_activity",
  "requires_email",
] as const;
export const customerValues = (v: CustomerInput) =>
  CUSTOMER_COLUMNS.map((k) => v[k]);
export function receiverSnapshot(customer: any) {
  return receiverInput.parse(
    Object.fromEntries(
      Object.keys(receiverInput.shape).map((k) => [
        k,
        customer[k] ?? (k === "exoneration" ? null : ""),
      ]),
    ),
  );
}
function identityType(value: string) {
  const aliases: Record<string, string> = {
    national: "01",
    legal: "02",
    juridica: "02",
    dimex: "03",
    nite: "04",
    foreign: "05",
  };
  return aliases[value.toLowerCase()] ?? value.toUpperCase();
}
export async function ensureCustomerNotDuplicate(
  db: pg.PoolClient,
  tenant: string,
  v: CustomerInput,
  exclude: string | null = null,
) {
  if (!v.identification || !v.identification_type) return;
  const value = v.identification.replace(/[-\s]/g, "").toUpperCase(),
    type = identityType(v.identification_type);
  await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
    tenant + ":customer:" + type + ":" + value,
  ]);
  const found = await db.query(
    `select id from public.customers where tenant_id=$1 and ($4::uuid is null or id<>$4) and upper(regexp_replace(identification,'[-[:space:]]','','g'))=$2 and case lower(identification_type) when 'national' then '01' when 'legal' then '02' when 'juridica' then '02' when 'dimex' then '03' when 'nite' then '04' when 'foreign' then '05' else upper(identification_type) end=$3 limit 1`,
    [tenant, value, type, exclude],
  );
  if (found.rowCount)
    throw new HttpError(
      409,
      "Ya existe un cliente con esa identificación en esta empresa. Selecciónalo como cliente registrado o desmarca guardar cliente.",
    );
}
export async function insertCustomer(
  db: pg.PoolClient,
  tenant: string,
  input: unknown,
) {
  const v = customerInput.parse(input);
  await ensureCustomerNotDuplicate(db, tenant, v);
  return (
    await db.query(
      `insert into public.customers(tenant_id,${CUSTOMER_COLUMNS.join(",")}) values(${Array.from({ length: CUSTOMER_COLUMNS.length + 1 }, (_, i) => "$" + (i + 1)).join(",")}) returning *`,
      [tenant, ...customerValues(v)],
    )
  ).rows[0];
}
