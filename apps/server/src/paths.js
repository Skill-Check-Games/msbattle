// Where the server finds things outside its own package. Data files (bots-pool.json, the pattern
// catalogues, the dev ranked.db, .env) live at the repo root; the built client is apps/client/dist.
var path = require("path");
var SERVER_ROOT = path.join(__dirname, "..");
var REPO_ROOT = path.join(SERVER_ROOT, "..", "..");
module.exports = {
	SERVER_ROOT: SERVER_ROOT,
	REPO_ROOT: REPO_ROOT,
	SCRIPTS_DIR: path.join(SERVER_ROOT, "scripts"),
	CLIENT_PUBLIC_DIR: path.join(REPO_ROOT, "apps", "client", "public")
};
