import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: Vite serves the React app on :5173 and proxies everything the Node server owns (socket.io,
// /api, /auth) to :1337; static assets come from public/. Prod: `vite build` writes
// dist/, which apps/server's staticServer serves.
const SERVER = "http://localhost:1337";
const proxied = ["/socket.io", "/api", "/auth", "/internal"];

export default defineConfig({
	plugins: [react()],
	css: { modules: { localsConvention: "camelCaseOnly" } },
	// packages/core is CommonJS (the legacy client still loads its shared modules as classic scripts).
	// It is a linked workspace package, so Vite must be told to prebundle it (dev) and to run rollup's
	// commonjs transform over it (build); both convert module.exports to ESM for the browser.
	optimizeDeps: { include: ["core/src/common/BoardLogic.js", "core/src/common/Cosmetics.js", "core/src/common/ShopCatalog.js", "core/src/common/MoveHash.js"] },
	build: { commonjsOptions: { include: [/packages\/core\//, /node_modules/] } },
	server: {
		port: 5173,
		// autoRewrite: the OAuth callback answers with a redirect to OAUTH_REDIRECT_BASE (:1337); rewriting the
		// Location host keeps a dev sign-in on this origin instead of dropping into the legacy client.
		proxy: Object.fromEntries(proxied.map(p => [p, { target: SERVER, changeOrigin: false, ws: p === "/socket.io", autoRewrite: p === "/auth" }]))
	}
});
