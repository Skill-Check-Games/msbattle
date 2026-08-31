// Render a static preview PNG for each purchasable board skin, for use as a Stripe Product image
// (scripts/provision-stripe-catalog.js) — skins are palette-only (BoardRender.js paints them live
// on canvas from Cosmetics.BOARD_SKINS), so unlike avatars there's no existing static asset to
// point Stripe at. Reproduces the exact same small preview strip the Shop tile/avatar-editor
// modal already show in-app (buildSkinPreview, src/client/views/Profile.js) — same markup, same
// CSS rules (copied from style.css's .skin-preview/.skin-cell, not the whole stylesheet, since this
// is a one-off asset generator rather than something that needs to track prod styling forever) —
// just captured at a high device scale factor so it's crisp at Stripe's product-image size instead
// of the ~90x30px it renders at in-app.
//
// Run:  node scripts/render-skin-preview-images.js [skinId ...]
// Defaults to every non-free skin in Cosmetics.BOARD_SKIN_LIST (i.e. all but "classic"). Writes
// src/client/skins/<id>-preview.png (served at /skins/<id>-preview.png once deployed).

var fs = require("fs");
var path = require("path");
var chromium = require("playwright").chromium;
var Cosmetics = require("../src/common/Cosmetics");

var OUT_DIR = path.join(__dirname, "..", "src", "client", "skins");
var SCALE = 8; // device pixel ratio for the screenshot — the CSS layout stays tiny, this just sharpens it

var ids = process.argv.slice(2);
if (!ids.length) ids = Cosmetics.BOARD_SKIN_LIST.filter(function(id) { return id !== "classic"; });

var CSS = "\
	body { margin: 0; background: transparent; }\
	.skin-preview { display: inline-flex; gap: 3px; padding: 5px; border-radius: 6px; background: #030e12; }\
	.skin-cell { width: 20px; height: 20px; border-radius: 3px; border: 1px solid transparent; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; line-height: 1; }\
";

function previewHtml(skinId) {
	var s = Cosmetics.BOARD_SKINS[skinId];
	var unknownStyle = "background: linear-gradient(180deg," + s.unknownTop + "," + s.unknownBottom + "); border-color: " + s.unknownEdge + ";";
	var numCells = [1, 2, 3].map(function(n) {
		var glow = s.glow ? ("text-shadow: 0 0 5px " + s.numbers[n] + ";") : "";
		return "<span class=\"skin-cell\" style=\"background:" + s.knownBg + ";border-color:" + s.knownEdge + ";color:" + s.numbers[n] + ";font-family:" + s.font + ";" + glow + "\">" + n + "</span>";
	}).join("");
	return "<!doctype html><html><head><style>" + CSS + "</style></head><body>" +
		"<span class=\"skin-preview\" id=\"preview\"><span class=\"skin-cell\" style=\"" + unknownStyle + "\"></span>" + numCells + "</span>" +
		"</body></html>";
}

(async function main() {
	if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
	var browser = await chromium.launch();
	var page = await browser.newPage({ deviceScaleFactor: SCALE, viewport: { width: 200, height: 100 } });
	for (var i = 0; i < ids.length; i++) {
		var id = ids[i];
		var skin = Cosmetics.BOARD_SKINS[id];
		if (!skin) { console.error("unknown skin id: " + id); continue; }
		await page.setContent(previewHtml(id));
		var el = await page.$("#preview");
		var outPath = path.join(OUT_DIR, id + "-preview.png");
		await el.screenshot({ path: outPath, omitBackground: false });
		console.log("wrote " + outPath);
	}
	await browser.close();
})().catch(function(e) {
	console.error(e);
	process.exit(1);
});
