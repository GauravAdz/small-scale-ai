import { defineConfig } from "@playwright/test";
import uiConfig from "./playwright.config";

if (process.env.COUNTERPART_PAID_CHECKS !== "1") {
  throw new Error("Live browser checks require npm run test:live -- --allow-paid after an explicit request.");
}
export default defineConfig({
  ...uiConfig,
  testMatch: "**/reliability.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
});
