import { test, expect } from "@playwright/test";
import { BASE_URL } from "./helpers";

test.describe("Marketing pages", () => {
  test("landing page is scrollable", async ({ page }) => {
    await page.goto(BASE_URL);
    // Footer exists below the fold
    const footer = page.locator("footer");
    await expect(footer).toBeVisible({ timeout: 10000 });
    // No overflow:hidden blocking scroll on body
    const bodyOverflow = await page.evaluate(
      () => getComputedStyle(document.body).overflow,
    );
    expect(bodyOverflow).not.toBe("hidden");
  });

  test("landing page has no em dashes in visible text", async ({ page }) => {
    await page.goto(BASE_URL);
    // Extract only visible text nodes — skip script/style content which may
    // contain — in minified JS or CSS.
    const visibleText = await page.evaluate(() => {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode(node) {
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            const tag = parent.tagName.toLowerCase();
            if (tag === "script" || tag === "style" || tag === "noscript") {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
          },
        },
      );
      const parts: string[] = [];
      let node: Node | null;
      while ((node = walker.nextNode())) {
        parts.push(node.textContent ?? "");
      }
      return parts.join("");
    });
    // Em dash character: —
    expect(visibleText).not.toMatch(/—/);
  });

  test("Get started links to /signup", async ({ page }) => {
    await page.goto(BASE_URL);
    const getStartedLink = page
      .locator("a", { hasText: /get started/i })
      .first();
    const href = await getStartedLink.getAttribute("href");
    expect(href).toContain("/signup");
  });

  test("Sign in links to /login", async ({ page }) => {
    await page.goto(BASE_URL);
    const signInLink = page.locator("a", { hasText: /sign in/i }).first();
    const href = await signInLink.getAttribute("href");
    expect(href).toContain("/login");
  });

  test("page title contains ChampHarbinger", async ({ page }) => {
    await page.goto(BASE_URL);
    await expect(page).toHaveTitle(/ChampHarbinger/);
  });

  test("h1 headline mentions buying signals", async ({ page }) => {
    await page.goto(BASE_URL);
    await expect(page.locator("h1")).toContainText("buying signals");
  });
});
