import { test, expect } from "@playwright/test";

// Every route loads without a page error, at desktop and at a narrow phone width, with a screenshot
// per route for eyeballing. Add a route here when it lands.
const ROUTES = ["/", "/solo", "/learn", "/leaderboard", "/profile", "/shop", "/settings", "/privacy", "/terms"];

for (const route of ROUTES) {
	test(`loads ${route}`, async ({ page }) => {
		const errors: string[] = [];
		page.on("pageerror", (e) => errors.push(String(e)));
		await page.goto(route);
		await expect(page.locator("#root")).not.toBeEmpty();
		await page.screenshot({ path: `e2e/screenshots${route === "/" ? "/home" : route.replace(/\//g, "_")}.png`, fullPage: true });
		expect(errors).toEqual([]);
	});
}

test("narrow phone width has no horizontal overflow on home", async ({ page }) => {
	await page.setViewportSize({ width: 330, height: 700 });
	await page.goto("/");
	const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
	expect(overflow).toBeLessThanOrEqual(0);
});
