import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { DOMParser } from "@xmldom/xmldom";
import { expect, it } from "vitest";
import {
  PHARMACEUTICAL_FORMS,
  isPharmaceuticalFormCode,
} from "../packages/domain/src/pharmaceutical-forms";

const sourceFile =
  "docs/reference/hacienda/v4.4/Nota_9_Codigo_Forma_Farmaceutica.downloaded-20261126.xlsx";
function workbookXml() {
  const raw = readFileSync(sourceFile),
    files = new Map<string, string>();
  let cursor = 0;
  while (raw.readUInt32LE(cursor) === 0x04034b50) {
    const length = raw.readUInt32LE(cursor + 18);
    const nameLength = raw.readUInt16LE(cursor + 26);
    const extraLength = raw.readUInt16LE(cursor + 28);
    const start = cursor + 30 + nameLength + extraLength;
    expect(raw.readUInt16LE(cursor + 6) & 8).toBe(0);
    expect(raw.readUInt16LE(cursor + 8)).toBe(8);
    files.set(
      raw.subarray(cursor + 30, cursor + 30 + nameLength).toString(),
      inflateRawSync(raw.subarray(start, start + length)).toString(),
    );
    cursor = start + length;
  }
  return (name: string) =>
    new DOMParser().parseFromString(files.get(name)!, "application/xml");
}

it("pins the verified official pharmaceutical workbook bytes", () => {
  const raw = readFileSync(sourceFile);
  expect(raw.byteLength).toBe(24090);
  expect(createHash("sha256").update(raw).digest("hex")).toBe(
    "2823dbff2041a8ae0efbd5abb75ae9dd067e6b6973f8b88acbcb1425b8a1a022",
  );
});

it("matches every catalog entry to the workbook's exact Text/shared-string codes", () => {
  const xml = workbookXml();
  const strings = Array.from(
    xml("xl/sharedStrings.xml").getElementsByTagName("si"),
    (v) => v.textContent,
  );
  const styles = xml("xl/styles.xml")
    .getElementsByTagName("cellXfs")[0]
    .getElementsByTagName("xf");
  const rows = Array.from(
    xml("xl/worksheets/sheet1.xml").getElementsByTagName("row"),
  ).slice(1);
  const extracted = rows.map((row) => {
    const [code, label] = Array.from(row.getElementsByTagName("c"));
    expect(code.getAttribute("r")?.startsWith("A")).toBe(true);
    expect(label.getAttribute("r")?.startsWith("B")).toBe(true);
    expect(code.getAttribute("t")).toBe("s");
    expect(
      styles[Number(code.getAttribute("s"))].getAttribute("numFmtId"),
    ).toBe("49");
    return {
      code: strings[Number(code.getElementsByTagName("v")[0].textContent)],
      label:
        strings[Number(label.getElementsByTagName("v")[0].textContent)]!.trim(),
    };
  });
  expect(PHARMACEUTICAL_FORMS).toEqual(extracted);
  expect(PHARMACEUTICAL_FORMS).toHaveLength(229);
  expect(new Set(PHARMACEUTICAL_FORMS.map((form) => form.code)).size).toBe(229);
});

it.each([
  ["01", "Anillo vaginal"],
  ["99", "Jabon solido"],
  ["100", "Jalea"],
  ["199", "Tableta"],
  ["229", "Unguento"],
])("keeps the official code %s as text", (code, label) => {
  expect(isPharmaceuticalFormCode(code)).toBe(true);
  expect(PHARMACEUTICAL_FORMS.find((form) => form.code === code)?.label).toBe(
    label,
  );
});

it.each(["", "1", "001", "000", "230", "Tableta", "01 "])(
  "rejects absent or reformatted form codes: %j",
  (code) => expect(isPharmaceuticalFormCode(code)).toBe(false),
);
