import { defineConfig } from "@playwright/test";

// Smoke test against the Vite dev server (which proxies to the Node server on :1337, so that has to
// be running: `npm run dev` at the repo root). E2E_PORT lets parallel checkouts pick their own port.
const port = Number(process.env.E2E_PORT || 5173);

export default defineConfig({
	testDir: "./e2e",
	timeout: 30_000,
	use: { baseURL: `http://localhost:${port}`, viewport: { width: 1280, height: 800 } },
	webServer: { command: `npx vite --port ${port} --strictPort`, port, reuseExistingServer: true, timeout: 30_000 }
});
