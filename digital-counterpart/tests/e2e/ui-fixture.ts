import { test as base, expect } from "@playwright/test";
import { isLoopback, uiRequestAllowed } from "../../scripts/verification/ui-policy.mjs";

/** Page-level response fixtures override this context-level deny rule. */
export const test = base.extend<{ localUiGuard: void }>({
  localUiGuard: [async ({ context, baseURL }, use) => {
    if (!baseURL || !isLoopback(baseURL)) throw new Error("UI verification requires a local development URL.");
    const blocked: string[] = [];
    const browserErrors: string[] = [];
    context.on("page", page => {
      page.on("pageerror", error => browserErrors.push(error.message));
      page.on("console", message => {
        if (message.type() === "error") browserErrors.push(message.text());
      });
    });
    await context.route("**/*", async route => {
      if (uiRequestAllowed(route.request().url(), baseURL)) return route.continue();
      const url = new URL(route.request().url());
      // Record only host/path, never query strings or request bodies.
      blocked.push(`${route.request().method()} ${url.origin}${url.pathname}`);
      await route.abort("blockedbyclient");
    });
    await use();
    expect(blocked, "UI tests must mock API responses; these requests were blocked before reaching the server.").toEqual([]);
    expect(browserErrors, "Browser errors during UI verification.").toEqual([]);
  }, { auto: true }],
});
export { expect };
