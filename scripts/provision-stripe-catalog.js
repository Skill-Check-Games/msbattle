// Provision real Stripe Product+Price catalog objects for every ShopCatalog item, so purchases
// reference an actual catalog entry (Dashboard -> Product catalog) instead of an inline one-off
// price created fresh on every checkout. Each Product/Price is tagged with metadata (game +
// product_type) so this account stays organized by game and by product category if it ever
// hosts more than msbattle, or more than msbattle's three categories (avatar/flag/board_skin).
//
// Idempotent: writes id -> {productId, priceId} into stripe-shop-catalog.json (repo root,
// committed — just object ids, not secrets) and skips any item already recorded there, so
// re-running after adding a new shop item only provisions the new one.
//
// Run against LIVE mode (this is what real purchases will reference):
//   STRIPE_SECRET_KEY=sk_live_... node scripts/provision-stripe-catalog.js
//
// ShopCatalog.js picks these ids up automatically on next server start/deploy (server-side only
// — it require()s this JSON file directly, guarded so a missing file just means no items have
// stripePriceId yet and shopApi.js falls back to inline pricing).

var fs = require("fs");
var path = require("path");
var Stripe = require("stripe");
var ShopCatalog = require("../src/common/ShopCatalog");

var STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || process.env.stripe_secret_key;
if (!STRIPE_SECRET_KEY) {
	console.error("Set STRIPE_SECRET_KEY (the live secret key) in the environment first.");
	process.exit(1);
}
var stripe = new Stripe(STRIPE_SECRET_KEY);
// This script only ever makes sense run against the live production catalog (the resulting price
// ids are what real checkouts reference), so the image host is fixed to prod rather than derived
// from whatever OAUTH_REDIRECT_BASE the invoking shell happens to have — override with SITE_BASE
// only for something like a staging dry run against a different domain.
var SITE_BASE = process.env.SITE_BASE || "https://msbattle.net";

function imageUrlFor(item) { return item.imagePath ? SITE_BASE + item.imagePath : null; }

var OUT_PATH = path.join(__dirname, "..", "stripe-shop-catalog.json");
var existing = {};
try { existing = JSON.parse(fs.readFileSync(OUT_PATH, "utf8")); } catch (e) { /* first run */ }

function save() {
	fs.writeFileSync(OUT_PATH, JSON.stringify(existing, null, "\t") + "\n");
}

(async function main() {
	var created = 0, imaged = 0;
	for (var i = 0; i < ShopCatalog.ITEMS.length; i++) {
		var item = ShopCatalog.ITEMS[i];
		var imageUrl = imageUrlFor(item);
		var meta = { game: ShopCatalog.GAME, product_type: item.productType, item_id: item.id };

		if (existing[item.id]) {
			// Already provisioned in an earlier run — still backfill the image if this item has one
			// and the recorded entry doesn't say it's set yet (e.g. items created before image support
			// was added here). products.update is cheap and idempotent, safe to call every run.
			if (imageUrl && !existing[item.id].imaged) {
				await stripe.products.update(existing[item.id].productId, { images: [imageUrl] });
				existing[item.id].imaged = true;
				save();
				imaged++;
				console.log("backfilled image: " + item.id + " -> " + imageUrl);
			} else {
				console.log("skip (already provisioned): " + item.id);
			}
			continue;
		}

		var product = await stripe.products.create({
			name: ShopCatalog.GAME + ": " + item.label,
			metadata: meta,
			images: imageUrl ? [imageUrl] : undefined
		});
		var price = await stripe.prices.create({
			product: product.id,
			currency: item.currency,
			unit_amount: item.priceCents,
			metadata: meta
		});
		existing[item.id] = { productId: product.id, priceId: price.id, imaged: !!imageUrl };
		save();
		created++;
		console.log("created: " + item.id + " (" + item.productType + ") -> " + price.id + (imageUrl ? " [image]" : ""));
	}
	console.log(created + " item(s) created, " + imaged + " image(s) backfilled. Wrote " + OUT_PATH);
})().catch(function(e) {
	console.error(e);
	process.exit(1);
});
