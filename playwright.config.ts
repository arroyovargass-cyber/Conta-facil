import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
if (existsSync(".env")) process.loadEnvFile(".env");
export default defineConfig({
  testDir: "./tests/browser",
  globalSetup: "./tests/browser/setup.ts",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45000,
  expect: { timeout: 7000 },
  outputDir: ".local/browser-results",
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    headless: true,
    actionTimeout: 10000,
    trace: "off",
    screenshot: "off",
    video: "off",
    launchOptions: {
      executablePath:
        process.env.CHROMIUM_PATH ??
        (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    },
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: {
    command: "npm start",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      ...process.env,
      NODE_ENV: "test",
      HACIENDA_KEYRING: JSON.stringify({
        "browser-test": randomBytes(32).toString("hex"),
      }),
      HACIENDA_ACTIVE_KEY_ID: "browser-test",
      HACIENDA_STAG_PROBE_ENABLED: "false",
      PORT: "3100",
      APP_ORIGIN: "http://127.0.0.1:3100",
      STATIC_DIRECTORY: "dist",
    },
  },
});
