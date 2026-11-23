import { readFile } from "node:fs/promises";
import type {
  ReceiverInput,
  InvoiceFiscalIssue,
} from "../../../../packages/domain/src/invoice-fiscal";
let catalog: Promise<any> | undefined;
export async function receiverLocationIssues(
  receiver: ReceiverInput,
): Promise<InvoiceFiscalIssue[]> {
  if (
    receiver.domicile !== "domestic" ||
    !receiver.province ||
    !receiver.canton ||
    !receiver.district
  )
    return [];
  try {
    catalog ??= readFile(
      "docs/reference/hacienda/v4.4/locations.json",
      "utf8",
    ).then(JSON.parse);
    const data = await catalog;
    const province = data.provinces.find(
      (p: any) => p.code === receiver.province,
    );
    const canton = province?.cantons.find(
      (c: any) => c.code === receiver.canton,
    );
    if (!canton?.districts.some((d: any) => d.code === receiver.district))
      return [
        {
          code: "LOCATION_HIERARCHY_INVALID",
          path: "receiver",
          message:
            "Provincia, cantón y distrito no corresponden a una combinación del catálogo de ubicaciones aportado.",
        },
      ];
    return [];
  } catch {
    catalog = undefined;
    return [
      {
        code: "LOCATION_CATALOG_UNAVAILABLE",
        path: "receiver",
        message:
          "No se pudo verificar la ubicación. El borrador puede guardarse para revisión.",
      },
    ];
  }
}
