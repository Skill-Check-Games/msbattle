// Per-route title, description, canonical and robots directive.
//
// There is no prerender step here, so every route is served the same index.html.
// Left alone, that means Google sees one title and one canonical for the whole
// site and collapses every URL into a duplicate of the homepage. Googlebot does
// execute JS, so updating the head on navigation keeps the routes distinct.
//
// Routes come from src/seo/indexable-routes.json, which is also what generates
// public/sitemap.xml at build time. One list, so the two cannot drift apart.
// Anything not in that list is non-indexable: it gets noindex and stays out of
// the sitemap. Match-flow, profile, shop, settings and admin screens qualify.
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import seo from "../seo/indexable-routes.json";

type Meta = { path: string; title: string; description: string };

const SITE = seo.site;
const ROUTES: Record<string, Meta> = Object.fromEntries(seo.routes.map((r) => [r.path, r as Meta]));
const HOME = ROUTES["/"];

function setAttr(selector: string, attr: string, value: string) {
	document.head.querySelector<HTMLElement>(selector)?.setAttribute(attr, value);
}

// The robots tag is not in index.html: it only exists while on a non-indexable
// route, so the default (indexable) state leaves no tag behind at all.
function setRobots(noindex: boolean) {
	const existing = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
	if (!noindex) {
		existing?.remove();
		return;
	}
	const el = existing ?? document.head.appendChild(Object.assign(document.createElement("meta"), { name: "robots" }));
	el.setAttribute("content", "noindex, follow");
}

export function useDocumentHead() {
	const { pathname } = useLocation();
	useEffect(() => {
		// Trailing slashes normalise; /shop/:tab style children fall back to non-indexable.
		const key = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
		const match = ROUTES[key];
		const meta = match ?? HOME;

		document.title = meta.title;
		setAttr('meta[name="description"]', "content", meta.description);
		setAttr('meta[property="og:title"]', "content", meta.title);
		setAttr('meta[property="og:description"]', "content", meta.description);
		setAttr('meta[name="twitter:title"]', "content", meta.title);
		setAttr('meta[name="twitter:description"]', "content", meta.description);

		// Canonical always points at the page you are actually on. Pointing a
		// non-indexable route at the homepage instead would simply be false; the
		// right way to keep it out of the index is noindex, which is what we do.
		const canonical = `${SITE}${key === "/" ? "/" : key}`;
		setAttr('link[rel="canonical"]', "href", canonical);
		setAttr('meta[property="og:url"]', "content", canonical);
		setRobots(!match);
	}, [pathname]);
}
