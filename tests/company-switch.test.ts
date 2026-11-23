import { it, expect } from "vitest";
import { CompanyScope } from "../apps/web/src/features/companies/scope";
it("discards responses from previous companies", async () => {
  const scope = new CompanyScope();
  scope.select("A");
  let finish!: (v: string) => void;
  const request = scope.load(
    () =>
      new Promise<string>((r) => {
        finish = r;
      }),
  );
  scope.select("B");
  finish("A data");
  expect(await request).toBeUndefined();
  expect(scope.active).toBe("B");
});
it("clears scope on logout", () => {
  const s = new CompanyScope();
  s.select("A");
  s.clear();
  expect(s.active).toBeNull();
});
it("does not start a stale reload after an action from a previous company", async () => {
  const s = new CompanyScope();
  s.select("A");
  s.select("B");
  let ran = false;
  const result = await s.load(async () => {
    ran = true;
    return "A";
  }, "A");
  expect(ran).toBe(false);
  expect(result).toBeUndefined();
});
it("invalidates captured action tokens on company change", () => {
  const s = new CompanyScope();
  s.select("A");
  const token = s.capture();
  s.select("B");
  expect(s.matches(token)).toBe(false);
});
