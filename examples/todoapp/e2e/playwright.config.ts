import { fileURLToPath } from "node:url";
import path from "node:path";
import type { PlaywrightTestConfig } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const config: PlaywrightTestConfig = {
  testDir: path.join(__dirname, "dist", "tests"),
  testMatch: /spec\.js/,
  outputDir: path.join(__dirname, "test-results"),
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:8787",
    headless: true,
    viewport: { width: 1100, height: 800 }
  }
};

export default config;
