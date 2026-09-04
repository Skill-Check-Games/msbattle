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
				// A vivid red cloth on a near-black pole (reusing knownEdge's dark tone) — the previous
				// gold-on-gold flag sat almost the same hue/lightness as the unrevealed cell gradient
				// right behind it and nearly disappeared; red is the highest-contrast option against a
				// warm gold field, and it's the same colour language Classic/Tactical already use for "flag".
				flagCloth: "#dc2626", flagPole: "#0d0904",
				// Same font as Classic too, for the same reason as the number colours above — digit
				// shapes stay consistent across skins so recognition speed doesn't drop.
				font: "Inter, system-ui, sans-serif", glow: false
			},
			monochrome: {
				label: "Monochrome", blurb: "Black, white, and the numbers you already know by heart.",
				// Numbers/mine deliberately reuse Classic's exact colours (not greyscale) — same
				// "don't retrain a player's colour-to-value muscle memory" reasoning Gold's own comment
				// gives, just leaned into harder here: EVERYTHING else goes pure black/white/grey, so
				// the coloured numbers are the only colour on the board at all and pop that much more.
				mine: "#fca5a5",
				numbers: { 1: "#60a5fa", 2: "#4ade80", 3: "#f87171", 4: "#c084fc", 5: "#fbbf24", 6: "#22d3ee", 7: "#f9a8d4", 8: "#e2e8f0" },
				knownBg: "#111114", knownEdge: "#000000",
				unknownTop: "#e5e7eb", unknownBottom: "#6b7280", unknownEdge: "#1f2937",
				unknownHilite: "rgba(255,255,255,0.3)",
				// Flag stays red rather than going greyscale too — it's the one place on the board
				// where "obviously not part of the neutral chrome" matters functionally, not just
				// aesthetically (a mid-grey flag would read as just another tile at a glance).
				flagCloth: "#ef4444", flagPole: "#e5e7eb",
				font: "Inter, system-ui, sans-serif", glow: false
			},
			frost: {
				label: "Frost", blurb: "Ice-blue tiles, cold as a 50/50 guess.",
				mine: "#f87171",
				numbers: { 1: "#38bdf8", 2: "#34d399", 3: "#fb7185", 4: "#a78bfa", 5: "#facc15", 6: "#22d3ee", 7: "#f0abfc", 8: "#f8fafc" },
				knownBg: "#0b1626", knownEdge: "#050b14",
				unknownTop: "#dbeafe", unknownBottom: "#7dd3fc", unknownEdge: "#0284c7",
				// Was a translucent white (rgba(255,255,255,0.45)) — reported as hard to see: unlike
				// every other skin, Frost's own unknownTop is ALREADY nearly white, so a white highlight
				// stroke on top of it had almost no contrast to begin with. A first pass switched to
				// sky-600 (the same shade as unknownEdge); this deepens it one step further to sky-700
				// (#0369a1) — still squarely a BLUE, on request, just rich/dark enough to read clearly
				// as a highlight against the pale ice background instead of blending toward it. Blended
				// contrast against unknownTop: ~161 RGB units of separation vs. the original white's
				// ~18 (and sky-600's own ~147) — the deepest, clearest of the three so far.
				unknownHilite: "rgba(3,105,161,0.6)",
				flagCloth: "#f87171", flagPole: "#e2e8f0",
				font: "Inter, system-ui, sans-serif", glow: false
			},
			neon: {
				label: "Neon", blurb: "Cyberpunk violet tiles with glowing digits.",
				mine: "#ff2e6c",
				numbers: { 1: "#00e5ff", 2: "#39ff14", 3: "#ff2e6c", 4: "#d946ef", 5: "#fbbf24", 6: "#818cf8", 7: "#f472b6", 8: "#e2e8f0" },
				knownBg: "#0a0518", knownEdge: "#050210",
				unknownTop: "#7c3aed", unknownBottom: "#4c1d95", unknownEdge: "#2e1065",
				unknownHilite: "rgba(217,70,239,0.28)",
				flagCloth: "#00e5ff", flagPole: "#e2e8f0",
				font: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", glow: true
			}
		},
		// Deliberately NOT alphabetical — a rough ascending "value ladder" (free, then cheapest paid
		// through priciest/flashiest), since this order also drives the skin picker's display order
		// (ShopCatalog.js's own item order is separate, hand-authored to match).
		BOARD_SKIN_LIST: ["classic", "monochrome", "tactical", "frost", "gold", "neon"],

		// Cascade reveal effects — how a covered cell looks as YOUR OWN board's cascade uncovers it
		// (BoardRender.js's drawRevealLid). Purely local rendering, never sent to or seen by anyone
		// else (unlike a board skin, which opponents see too) — but still ownership-gated server-side
		// (session.js's set_reveal_effect) the same way every other cosmetic here is, rather than
		// trusting the client: a purchasable preference with no server enforcement at all would mean
		// "pay, or just edit localStorage" for anyone who opens devtools, which would undermine
		// selling it in the first place. "ripple" is the free/default treatment (closest to the
		// board's original plain fade-off); every other id here is a ShopCatalog.js purchasable.
		REVEAL_EFFECT_LIST: ["ripple", "spark", "shatter", "crt", "dust"],
		DEFAULT_REVEAL_EFFECT: "ripple",
		REVEAL_EFFECTS: {
			ripple: { label: "Ripple", blurb: "A soft wave outward as the cascade opens — the default." },
			spark: { label: "Spark Trail", blurb: "A quick flash at each cell as the cascade races outward." },
			shatter: { label: "Shatter", blurb: "Covered tiles crack into shards and fly apart." },
			crt: { label: "CRT Flicker", blurb: "A brief flicker and scanline sweep, like an old display waking up." },
			dust: { label: "Dust Puff", blurb: "A soft puff blooms as each tile clears, like brushing away sand." }
		},
		// Avatar cloth colour — the in-game flag. The first entry (matching DEFAULT_AVATAR_COLOR) is
		// free/default; any other colour here would be a purchasable shop item (ShopCatalog.js derives
		// one from every entry past this first one automatically). Deliberately just the one entry for
		// now — flag colours and avatars are conceptually separate things (the flag is tied to
		// country/identity, not a costume), so this isn't where more variety should get added; that's
		// what AVATAR_IMAGES below is for. Used to carry a second, purchasable "Pirate Flag" colour
		// (#111111) — removed outright, not just unlisted, since it blurred exactly that line.
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
