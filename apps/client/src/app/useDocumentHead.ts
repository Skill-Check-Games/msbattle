// Per-route title, description and canonical.
//
// There is no prerender step here, so every route is served the same index.html.
// Left alone, that means Google sees one title and one canonical for the whole
// site and collapses every URL into a duplicate of the homepage. Googlebot does
// execute JS, so updating the head on navigation is enough to keep the routes in
// the sitemap distinct from each other.
//
// Only routes worth indexing need an entry. Anything absent falls back to the
// homepage copy baked into index.html, and match-flow, profile, shop and admin
// screens are deliberately not listed (they are also absent from sitemap.xml).
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const SITE = "https://msbattle.net";

type Meta = { title: string; description: string };

const HOME: Meta = {
	title: "MS Battle - Play multiplayer Minesweeper online",
	description:
		"Real-time competitive Minesweeper. Race real opponents in ranked matches, sharpen up on daily puzzles, and climb the rating ladder. Free in your browser, no ads, no download.",
};

const ROUTES: Record<string, Meta> = {
	"/": HOME,
	"/learn": {
		title: "Learn Minesweeper - patterns and strategy | MS Battle",
		description:
			"Learn to read a Minesweeper board properly: the common deduction patterns, when a guess is actually forced, and how to get faster. Then put it into practice against real opponents.",
	},
	"/solo": {
		title: "Play Minesweeper solo, free online | MS Battle",
		description:
			"Classic single-player Minesweeper in your browser. No ads, no download, no signup. Pick a size and start clearing.",
	},
	"/puzzles": {
		title: "Minesweeper puzzles and daily challenge | MS Battle",
		description:
			"Hand-picked Minesweeper positions to solve: rated puzzles, streak and storm modes, and a new daily challenge. Train the deductions that decide real games.",
	},
	"/help": {
		title: "How to play - rules and controls | MS Battle",
		description:
			"The rules of Minesweeper, the controls, and how ranked matches and ratings work in MS Battle.",
	},
	"/leaderboard": {
		title: "Leaderboard | MS Battle",
		description: "The current MS Battle rankings: top rated players and where you sit among them.",
	},
	"/custom": {
		title: "Custom Minesweeper games | MS Battle",
		description: "Build a Minesweeper board to your own size and mine count, then play it or share it.",
	},
	"/terms": { title: "Terms | MS Battle", description: "Terms of use for MS Battle." },
	"/privacy": { title: "Privacy | MS Battle", description: "How MS Battle handles your data." },
};

function setMeta(selector: string, attr: string, value: string) {
	const el = document.head.querySelector<HTMLElement>(selector);
	if (el) el.setAttribute(attr, value);
}

export function useDocumentHead() {
	const { pathname } = useLocation();
	useEffect(() => {
		// Trailing slashes and /shop/:tab style children fall back to the parent.
		const key = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
		const meta = ROUTES[key] ?? HOME;

		document.title = meta.title;
		setMeta('meta[name="description"]', "content", meta.description);
		setMeta('meta[property="og:title"]', "content", meta.title);
		setMeta('meta[property="og:description"]', "content", meta.description);
		setMeta('meta[name="twitter:title"]', "content", meta.title);
		setMeta('meta[name="twitter:description"]', "content", meta.description);

		// Canonical must point at the route itself, otherwise every URL claims to be
		// the homepage and Google drops the rest.
		const canonical = ROUTES[key] ? `${SITE}${key === "/" ? "/" : key}` : `${SITE}/`;
		setMeta('link[rel="canonical"]', "href", canonical);

		setMeta('meta[property="og:url"]', "content", canonical);
	}, [pathname]);
}
