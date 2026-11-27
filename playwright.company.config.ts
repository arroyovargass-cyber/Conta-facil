import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

const runtime = process.env.COMPANY_BROWSER_DATABASE_URL;
if (!runtime)
  throw new Error(
    "Usa infra/test-company-browser.ts para las pruebas con el rol restringido.",
  );

export default defineConfig({
  ...base,
  webServer: {
    ...(base.webServer as object),
    env: {
      ...(base.webServer as { env: Record<string, string> }).env,
      DATABASE_URL: runtime,
    },
  },
});
