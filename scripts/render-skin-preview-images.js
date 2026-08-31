// Render a static preview PNG for each purchasable board skin, for use as a Stripe Product image
// (scripts/provision-stripe-catalog.js) — skins are palette-only (BoardRender.js paints them live
// on canvas from Cosmetics.BOARD_SKINS), so unlike avatars there's no existing static asset to
// point Stripe at.
//
// Rather than reimplementing the renderer, this drives a REAL running server with Playwright and
// calls the app's own buildSkinPreview(id, cellPx) (Profile.js) — the exact same function that
// paints the Shop tile / skin picker swatch in-app — just at a much larger cellPx for a crisp
// standalone image. One rendering, no drift between what players see in-app and what Stripe shows.
// The board is a fixed layout (SKIN_PREVIEW_MINES in Profile.js): three mines top-left —
//   X X 1
//   X 3 1
//   1 1 0
//
// Run against a live server (defaults to local dev — start it first with `npm run dev`):
//   node scripts/render-skin-preview-images.js [skinId ...]
// Point at a different server (e.g. to regenerate against prod's own rendering) with BASE=...
// Defaults to every non-free skin in Cosmetics.BOARD_SKIN_LIST (i.e. all but "classic").
// Writes src/client/skins/<id>-preview.png (served at /skins/<id>-preview.png once deployed).

var fs = require("fs");
var path = require("path");
var chromium = require("playwright").chromium;
var Cosmetics = require("../src/common/Cosmetics");

var BASE = process.env.BASE || "http://localhost:1337";
var OUT_DIR = path.join(__dirname, "..", "src", "client", "skins");
var CELL_PX = 240; // logical px/cell for the exported image (3 cells -> 720 CSS px square)
var DEVICE_SCALE = 2; // -> ~1440x1440 actual pixels, crisp at Stripe's product-image size

var ids = process.argv.slice(2);
if (!ids.length) ids = Cosmetics.BOARD_SKIN_LIST.filter(function(id) { return id !== "classic"; });

(async function main() {
	if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
	var browser = await chromium.launch();
	var page = await browser.newPage({ deviceScaleFactor: DEVICE_SCALE });
	// Any page that's loaded the full client bundle has buildSkinPreview/BoardView available as
	// globals — the Shop page is the natural one since it's the real place this render is used.
	await page.goto(BASE + "/shop", { waitUntil: "networkidle" });
	await page.waitForFunction("typeof buildSkinPreview === 'function'");

	for (var i = 0; i < ids.length; i++) {
		var id = ids[i];
		if (!Cosmetics.BOARD_SKINS[id]) { console.error("unknown skin id: " + id); continue; }
		await page.evaluate(function(args) {
			var wrap = buildSkinPreview(args.id, args.cellPx);
			wrap.id = "__preview_export__";
			wrap.style.position = "fixed";
			wrap.style.top = "0";
			wrap.style.left = "0";
			wrap.style.zIndex = "99999";
			document.body.appendChild(wrap);
		}, { id: id, cellPx: CELL_PX });
		// Screenshot just the canvas, not .skin-preview's own dark padding/frame — a plain square
		// board image, matching what was asked for.
		var canvasHandle = await page.$("#__preview_export__ canvas");
		var outPath = path.join(OUT_DIR, id + "-preview.png");
		await canvasHandle.screenshot({ path: outPath });
		await page.evaluate(function() {
			var e = document.getElementById("__preview_export__");
			if (e) e.remove();
		});
		console.log("wrote " + outPath);
	}
	await browser.close();
})().catch(function(e) {
	console.error(e);
	process.exit(1);
});
