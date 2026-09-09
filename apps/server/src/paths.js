// Where the server finds things outside its own package. Data files (bots-pool.json, the pattern
// catalogues, the dev ranked.db, .env) live at the repo root; the old client is apps/legacy-client;
// the shared modules the old client loads as plain <script>s are packages/core/src/common.
var path = require("path");
var SERVER_ROOT = path.join(__dirname, "..");
var REPO_ROOT = path.join(SERVER_ROOT, "..", "..");
module.exports = {
	SERVER_ROOT: SERVER_ROOT,
	REPO_ROOT: REPO_ROOT,
	SCRIPTS_DIR: path.join(SERVER_ROOT, "scripts"),
	LEGACY_CLIENT_DIR: path.join(REPO_ROOT, "apps", "legacy-client"),
	CORE_COMMON_DIR: path.join(REPO_ROOT, "packages", "core", "src", "common")
};
