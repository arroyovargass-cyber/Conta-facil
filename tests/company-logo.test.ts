import { it, expect } from "vitest";
import { validCompanyLogo } from "../apps/api/src/services/company-logo";
it("accepts a complete bounded PNG and rejects truncation and corrupt chunks", () => {
  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=",
    "base64",
  );
  expect(validCompanyLogo(image, "png")).toBe(true);
  expect(validCompanyLogo(image.subarray(0, 8), "png")).toBe(false);
  const corrupted = Buffer.from(image);
  corrupted[40] ^= 1;
  expect(validCompanyLogo(corrupted, "png")).toBe(false);
  expect(validCompanyLogo(Buffer.from([255, 216, 255, 217]), "jpeg")).toBe(
    false,
  );
});
