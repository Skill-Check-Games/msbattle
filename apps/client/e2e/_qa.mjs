import { chromium } from "@playwright/test";
const OUT = process.env.OUT;
const ROUTES = ["/", "/learn", "/leaderboard", "/profile", "/shop", "/settings", "/custom", "/solo", "/puzzles/play"];
const SITES = { prod: "https://msbattle.net", local: "http://localhost:5173" };
const SIZES = { desk: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } };
const b = await chromium.launch();
for (const [site, base] of Object.entries(SITES)) for (const [sz, vp] of Object.entries(SIZES)) {
	const ctx = await b.newContext({ viewport: vp, isMobile: sz === "phone", hasTouch: sz === "phone" });
	const p = await ctx.newPage();
	for (const r of ROUTES) {
		try { await p.goto(base + r, { waitUntil: "networkidle", timeout: 20000 }); } catch (e) { console.log("timeout", site, r); }
		await p.waitForTimeout(r === "/" ? 2500 : 1500);
		const name = (r === "/" ? "home" : r.slice(1).replace(/\//g, "_"));
		await p.screenshot({ path: `${OUT}/${name}-${sz}-${site}.png`, fullPage: true });
	}
	await ctx.close();
}
await b.close(); console.log("done");
