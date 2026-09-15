// Thin wrapper over the Plausible queue stub in index.html.
//
// The events mirror achtung-royale's deliberately, so the two dashboards can be
// read side by side: Game Started and Match Finished, both carrying a `mode`.
// The question this exists to answer is which kinds of game people actually
// start, and which ones they stay in to the end.
//
// Never throws: analytics failing must never break a game. The stub means
// plausible() exists before the script loads, but an ad blocker can remove it
// entirely, so the optional call is load-bearing.

type Props = Record<string, string | number | boolean>;

declare global {
	interface Window {
		plausible?: (event: string, options?: { props?: Props }) => void;
	}
}

export function track(event: string, props?: Props) {
	try {
		window.plausible?.(event, props ? { props } : undefined);
	} catch {
		// Analytics is never worth an exception.
	}
}
