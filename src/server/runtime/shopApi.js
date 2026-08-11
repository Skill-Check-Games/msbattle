// The shop's HTTP surface: create a Stripe Checkout session for a cosmetic item, let the
// client poll a session's paid status on return, and receive Stripe's webhook (the
// authoritative grant path). Follows puzzleApi.js's handleXRoute(req,res,url)->bool shape,
// mounted in minesweeperServer.js's handler chain. Self-contained on db + ShopCatalog +
// oauth.OAUTH_BASE (for the Checkout redirect URLs) — no room/game/socket state.
//
// Price authority stays server-side: every Checkout Session is built from ShopCatalog.byId(itemId)
// looked up here, never from a client-submitted price.

var Stripe = require("stripe");
var db = require("../db");
var oauth = require("./oauth");
var ShopCatalog = require("../../common/ShopCatalog");

function envAny() {
	for (var i = 0; i < arguments.length; i++) {
		if (process.env[arguments[i]]) return process.env[arguments[i]];
	}
	return "";
}

var STRIPE_SECRET_KEY = envAny("STRIPE_SECRET_KEY", "stripe_secret_key");
var STRIPE_WEBHOOK_SECRET = envAny("STRIPE_WEBHOOK_SECRET", "stripe_webhook_secret");
// Absent in a dev environment with no Stripe keys configured — every route below degrades to a
// clear 503 instead of throwing, so the rest of the server (and its tests) run fine without Stripe.
var stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

function send(res, code, obj) {
	res.writeHead(code, { "Content-Type": "application/json" });
	res.end(JSON.stringify(obj));
}

// String-based JSON body reader (fine for our own checkout request — unlike the webhook, nothing
// here needs the raw bytes). Mirrors internalApi.js's readJson.
function readJsonBody(req, cb) {
	var body = "";
	req.on("data", function(c) { body += c; if (body.length > 1e6) req.destroy(); });
	req.on("end", function() { try { cb(null, body ? JSON.parse(body) : {}); } catch (e) { cb(e); } });
	req.on("error", function(e) { cb(e); });
}

// Buffer-based raw body reader — REQUIRED for the webhook: stripe.webhooks.constructEvent verifies
// the signature over the exact, unmodified bytes Stripe sent, so this can't share readJsonBody's
// string concatenation (which would already have re-encoded the body).
function readRawBody(req, cb) {
	var chunks = [];
	var size = 0;
	req.on("data", function(c) { size += c.length; if (size > 1e6) { req.destroy(); return; } chunks.push(c); });
	req.on("end", function() { cb(null, Buffer.concat(chunks)); });
	req.on("error", function(e) { cb(e); });
}

function resolveUser(req) {
	var token = req.headers["x-session-token"];
	if (!token) return null;
	return db.getUserByToken(token);
}

function serveCheckout(req, res) {
	if (!stripe) { send(res, 503, { error: "shop_unconfigured" }); return; }
	var user = resolveUser(req);
	if (!user) { send(res, 401, { error: "unauthenticated" }); return; }
	if (user.is_guest) { send(res, 403, { error: "guest_not_allowed" }); return; }

	readJsonBody(req, function(err, body) {
		if (err) { send(res, 400, { error: "bad_json" }); return; }
		var itemId = body && typeof body.itemId === "string" ? body.itemId : "";
		var item = ShopCatalog.byId(itemId);
		if (!item) { send(res, 404, { error: "unknown_item" }); return; }
		if (db.ownsItem(user.id, item.kind, item.id)) { send(res, 200, { alreadyOwned: true }); return; }

		stripe.checkout.sessions.create({
			mode: "payment",
			line_items: [{
				price_data: {
					currency: item.currency,
					unit_amount: item.priceCents,
					product_data: { name: item.label }
				},
				quantity: 1
			}],
			client_reference_id: String(user.id),
			metadata: { userId: String(user.id), kind: item.kind, itemId: item.id },
			success_url: oauth.OAUTH_BASE + "/shop?purchase=success&session_id={CHECKOUT_SESSION_ID}",
			cancel_url: oauth.OAUTH_BASE + "/shop?purchase=cancel"
		}).then(function(session) {
			send(res, 200, { url: session.url });
		}).catch(function(e) {
			console.error("shopApi: checkout session create failed", e);
			send(res, 500, { error: "checkout_failed" });
		});
	});
}

// UX fast-path for the redirect back from Stripe's hosted page: grants immediately if the session
// is already paid, rather than making the player wait on webhook delivery latency. Not the
// authoritative grant path — the webhook (below) is what covers a closed tab, a blocked redirect,
// etc. — this is a self-healing convenience layered on top of it, safe to call repeatedly (grantItem
// is idempotent).
function serveSessionStatus(req, res, url) {
	if (!stripe) { send(res, 503, { error: "shop_unconfigured" }); return; }
	var user = resolveUser(req);
	if (!user) { send(res, 401, { error: "unauthenticated" }); return; }
	var sessionId = url.searchParams.get("session_id");
	if (!sessionId) { send(res, 400, { error: "missing_session_id" }); return; }

	stripe.checkout.sessions.retrieve(sessionId).then(function(session) {
		if (!session.metadata || session.metadata.userId !== String(user.id)) {
			send(res, 403, { error: "forbidden" });
			return;
		}
		var paid = session.payment_status === "paid";
		if (paid) {
			db.grantItem(user.id, session.metadata.kind, session.metadata.itemId, {
				priceCents: session.amount_total,
				currency: session.currency,
				stripeSessionId: session.id,
				stripePaymentIntent: session.payment_intent || null
			});
		}
		send(res, 200, {
			paid: paid,
			itemId: session.metadata.itemId,
			owned: db.ownsItem(user.id, session.metadata.kind, session.metadata.itemId)
		});
	}).catch(function(e) {
		console.error("shopApi: session status lookup failed", e);
		send(res, 500, { error: "lookup_failed" });
	});
}

// The authoritative grant path — Stripe calling us, not the other way around. Always acks 200
// quickly once the signature is verified (Stripe requires a fast 2xx or it'll keep retrying).
function serveWebhook(req, res) {
	if (!stripe || !STRIPE_WEBHOOK_SECRET) { send(res, 503, { error: "shop_unconfigured" }); return; }
	readRawBody(req, function(err, rawBody) {
		if (err) { send(res, 400, { error: "bad_body" }); return; }
		var event;
		try {
			event = stripe.webhooks.constructEvent(rawBody, req.headers["stripe-signature"], STRIPE_WEBHOOK_SECRET);
		} catch (e) {
			send(res, 400, { error: "bad_signature" });
			return;
		}

		if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
			if (db.markStripeEventProcessed(event.id)) {
				var session = event.data.object;
				var meta = session.metadata || {};
				if (meta.userId && meta.kind && meta.itemId) {
					db.grantItem(parseInt(meta.userId, 10), meta.kind, meta.itemId, {
						priceCents: session.amount_total,
						currency: session.currency,
						stripeSessionId: session.id,
						stripePaymentIntent: session.payment_intent || null
					});
				}
			}
			// else: already processed this event id (Stripe redelivery) — no-op, still ack 200 below.
		}
		send(res, 200, { received: true });
	});
}

function handleShopRoute(req, res, url) {
	if (url.pathname === "/api/shop/checkout" && req.method === "POST") { serveCheckout(req, res); return true; }
	if (url.pathname === "/api/shop/session-status" && req.method === "GET") { serveSessionStatus(req, res, url); return true; }
	if (url.pathname === "/api/shop/webhook" && req.method === "POST") { serveWebhook(req, res); return true; }
	return false;
}

module.exports = { handleShopRoute: handleShopRoute };
