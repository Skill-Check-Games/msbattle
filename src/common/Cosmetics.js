// Cosmetic catalogue data — board skins and avatar options. Shared by the client
// (rendering) and the server (ShopCatalog's id/kind validation, ownership checks).
// Pure data, no logic; loaded via a plain <script> tag before core/BoardRender.js
// (which reads these off the global) and required by server modules that need to
// know what ids are valid.
(function() {
	var Cosmetics = {
		BOARD_SKINS: {
			classic: {
				label: "Classic", blurb: "The default blue tiles.",
				mine: "#fca5a5",
				numbers: { 1: "#60a5fa", 2: "#4ade80", 3: "#f87171", 4: "#c084fc", 5: "#fbbf24", 6: "#22d3ee", 7: "#f9a8d4", 8: "#e2e8f0" },
				knownBg: "#162033", knownEdge: "#0b1220",
				unknownTop: "#4f93f7", unknownBottom: "#2563eb", unknownEdge: "#1e40af",
				unknownHilite: "rgba(255,255,255,0.28)",
				flagCloth: "#ef4444", flagPole: "#e2e8f0",
				font: "Inter, system-ui, sans-serif", glow: false
			},
			tactical: {
				label: "Tactical", blurb: "Phosphor-CRT display with glowing digits.",
				mine: "#ff4d4d",
				numbers: { 1: "#00e8c8", 2: "#39ff14", 3: "#ff4d4d", 4: "#c084fc", 5: "#fb923c", 6: "#22d3ee", 7: "#80fff4", 8: "#eeeef5" },
				knownBg: "#020c0f", knownEdge: "#0a2a30",
				unknownTop: "#0a3a42", unknownBottom: "#062830", unknownEdge: "#00614f",
				unknownHilite: "rgba(0,232,200,0.20)",
				flagCloth: "#ff4d4d", flagPole: "#80fff4",
				font: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", glow: true
			},
			gold: {
				label: "Gold", blurb: "Black-and-gold prestige tiles for the elite.",
				mine: "#facc15",
				// Same number colours as Classic, deliberately — a skin should reskin the board's chrome,
				// not retrain a player's colour-to-value muscle memory (an earlier version had custom
				// warm tones here and it read as harder to play at speed).
				numbers: { 1: "#60a5fa", 2: "#4ade80", 3: "#f87171", 4: "#c084fc", 5: "#fbbf24", 6: "#22d3ee", 7: "#f9a8d4", 8: "#e2e8f0" },
				knownBg: "#1a140a", knownEdge: "#0d0904",
				unknownTop: "#d4a017", unknownBottom: "#8b6914", unknownEdge: "#5c4409",
				unknownHilite: "rgba(255,223,128,0.35)",
				flagCloth: "#facc15", flagPole: "#f5e6c8",
				// Same font as Classic too, for the same reason as the number colours above — digit
				// shapes stay consistent across skins so recognition speed doesn't drop.
				font: "Inter, system-ui, sans-serif", glow: false
			}
		},
		BOARD_SKIN_LIST: ["classic", "tactical", "gold"],
		// Avatar cloth colour — the in-game flag. Just the classic red flag now (the other colours were dropped).
		AVATAR_COLORS: ["#ef4444"],
		DEFAULT_AVATAR_COLOR: "#ef4444",
		// The default avatar shown anywhere a player hasn't chosen one — the anonymous silhouette.
		DEFAULT_AVATAR: "anon",
		// Preset image avatars — an avatar value of "img:<id>" renders the image instead of a flag pennant.
		// Kept to face/torso-only crops (they read best at in-game size); other art styles/framings are
		// culled here rather than left in as lower-quality options.
		AVATAR_IMAGES: { "scout-dog": "/avatars/scout-dog.png", "sentry-fox": "/avatars/sentry-fox.png", "sentry-owl": "/avatars/sentry-owl.png", "signal-cat": "/avatars/signal-cat.png", "guard-teddy": "/avatars/guard-teddy.png" }
	};

	if (typeof module !== "undefined" && module.exports) {
		module.exports = Cosmetics;
	} else if (typeof window !== "undefined") {
		window.Cosmetics = Cosmetics;
	}
})();
