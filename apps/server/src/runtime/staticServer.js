// Static host for the React client: apps/client/dist (written by `vite build`). Page routes
// (anything extensionless) serve dist/index.html so the client router can take over; /assets/*
// carries Vite's content hashes and is cached forever; everything else in dist (flags, avatars,
// skins, the logo) gets a short lifetime. Only text is compressed (brotli, then gzip).
var fs = require("fs");
var path = require("path");
var zlib = require("zlib");

// In dev (npm run dev / DEV_AUTH=1) nothing should stick in a cache; production keeps real max-ages.
var DEV = process.env.DEV_AUTH === "1";
var DIST_DIR = path.join(require("../paths").REPO_ROOT, "apps", "client", "dist");

var CONTENT_TYPES = {
	".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png",
	".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".json": "application/json",
	".webmanifest": "application/manifest+json", ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain", ".mp3": "audio/mpeg"
};
var COMPRESSIBLE = { "text/javascript": true, "text/css": true, "image/svg+xml": true, "text/html": true, "application/json": true, "application/manifest+json": true, "text/plain": true };

// The old client registered a cache-first service worker. The React client registers none, so /sw.js
// permanently serves a kill switch: any worker still installed in a returning browser unregisters
// itself, wipes its caches and reloads its pages.
var SW_KILL_SWITCH = [
	'self.addEventListener("install", function() { self.skipWaiting(); });',
	'self.addEventListener("activate", function(event) {',
	'\tevent.waitUntil(',
	'\t\tcaches.keys()',
	'\t\t\t.then(function(names) { return Promise.all(names.map(function(n) { return caches.delete(n); })); })',
	'\t\t\t.then(function() { return self.registration.unregister(); })',
	'\t\t\t.then(function() { return self.clients.matchAll(); })',
	'\t\t\t.then(function(clients) { clients.forEach(function(c) { c.navigate(c.url); }); })',
	'\t);',
	'});'
].join("\n");

// Shown when dist/ is missing (a checkout that has not run `npm run build` yet).
var NOT_BUILT = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>MSBattle</title></head>" +
	"<body style=\"font-family:system-ui;padding:2rem\"><h1>Client not built</h1><p>Run <code>npm run build</code>, then reload.</p></body></html>";

function isFile(full) { try { return fs.statSync(full).isFile(); } catch (e) { return false; } }

// A dist file for this path, or null. Extensionless paths are page routes and never match a file.
function resolveDist(pathname) {
	var last = pathname.split("/").pop();
	if (last.indexOf(".") === -1) return null;
	var full = path.join(DIST_DIR, pathname);
	if (full.indexOf(DIST_DIR) !== 0) return null; // path traversal guard
	return isFile(full) ? full : null;
}

function pickEncoding(req) {
	var accept = (req && req.headers && req.headers["accept-encoding"]) || "";
	if (accept.indexOf("br") !== -1) return "br";
	if (accept.indexOf("gzip") !== -1) return "gzip";
	return null;
}

function serveBuffer(res, body, headers, encoding) {
	if (!encoding) { res.writeHead(200, headers); res.end(body); return; }
	headers = Object.assign({}, headers, { "Content-Encoding": encoding, "Vary": "Accept-Encoding" });
	var compress = (encoding === "br") ? zlib.brotliCompress : zlib.gzip;
	compress(body, function(err, compressed) {
		if (err) { res.destroy(); return; }
		res.writeHead(200, headers);
		res.end(compressed);
	});
}

function serve(res, pathname, req) {
	if (pathname === "/sw.js") {
		serveBuffer(res, Buffer.from(SW_KILL_SWITCH), { "Content-Type": "text/javascript", "Cache-Control": "no-cache" }, pickEncoding(req));
		return;
	}
	var filePath = resolveDist(pathname);
	var isPage = false;
	if (!filePath) {
		var last = pathname.split("/").pop();
		if (last.indexOf(".") !== -1) { res.writeHead(404); res.end(); return; } // a missing asset is a 404, not the app shell
		isPage = true;
		filePath = path.join(DIST_DIR, "index.html");
		if (!isFile(filePath)) {
			serveBuffer(res, Buffer.from(NOT_BUILT), { "Content-Type": "text/html", "Cache-Control": "no-cache" }, pickEncoding(req));
			return;
		}
	}
	var contentType = CONTENT_TYPES[path.extname(filePath)] || "application/octet-stream";
	var headers = { "Content-Type": contentType };
	if (isPage || DEV) headers["Cache-Control"] = "no-cache";
	else if (pathname.indexOf("/assets/") === 0) headers["Cache-Control"] = "public, max-age=31536000, immutable";
	else headers["Cache-Control"] = "public, max-age=3600";
	var encoding = COMPRESSIBLE[contentType] ? pickEncoding(req) : null;

	if (!encoding) {
		fs.readFile(filePath, function(err, data) {
			if (err) { res.writeHead(500); res.end("Error while loading " + filePath); return; }
			res.writeHead(200, headers);
			res.end(data);
		});
		return;
	}
	headers["Content-Encoding"] = encoding;
	headers["Vary"] = "Accept-Encoding";
	var stream = fs.createReadStream(filePath);
	var compressor = (encoding === "br") ? zlib.createBrotliCompress() : zlib.createGzip();
	// A mid-stream read error after headers are flushed cannot send a fresh 500; drop the connection.
	stream.on("error", function() { res.destroy(); });
	compressor.on("error", function() { res.destroy(); });
	res.writeHead(200, headers);
	stream.pipe(compressor).pipe(res);
}

module.exports = { serve: serve };
