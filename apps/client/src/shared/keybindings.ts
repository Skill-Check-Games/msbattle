// Rebindable in-game keyboard controls, persisted to localStorage ("ms_keybinds").
export const KEY_ACTIONS = [
	{ id: "up", label: "Move up" }, { id: "down", label: "Move down" }, { id: "left", label: "Move left" }, { id: "right", label: "Move right" },
	{ id: "reveal", label: "Reveal cell" }, { id: "flag", label: "Flag / unflag" }, { id: "next", label: "Jump to next unsolved area" }
] as const;
export type KeyAction = typeof KEY_ACTIONS[number]["id"];
const DEFAULTS: Record<KeyAction, string> = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", reveal: "x", flag: "z", next: "Tab" };

let binds: Record<KeyAction, string | null> = { ...DEFAULTS };
try {
	const raw = localStorage.getItem("ms_keybinds");
	if (raw) { const parsed = JSON.parse(raw); for (const a of Object.keys(DEFAULTS) as KeyAction[]) if (Object.prototype.hasOwnProperty.call(parsed, a)) binds[a] = (typeof parsed[a] === "string" && parsed[a]) ? parsed[a] : null; }
} catch { /* storage blocked or corrupt */ }
const save = () => { try { localStorage.setItem("ms_keybinds", JSON.stringify(binds)); } catch { /* storage blocked */ } };
const norm = (key: string | null) => (key && key.length === 1) ? key.toLowerCase() : key;

export const keybindings = {
	actionFor(e: KeyboardEvent): KeyAction | null { const k = norm(e.key); for (const a of Object.keys(binds) as KeyAction[]) if (norm(binds[a]) === k) return a; return null; },
	get(a: KeyAction) { return binds[a]; },
	// Binding a key already used by another action frees that action (it shows as unbound).
	set(action: KeyAction, key: string) { for (const b of Object.keys(binds) as KeyAction[]) if (b !== action && binds[b] && norm(binds[b]) === norm(key)) binds[b] = null; binds[action] = key; save(); },
	reset() { binds = { ...DEFAULTS }; save(); },
	label(key: string | null): string {
		switch (key) { case " ": return "Space"; case "ArrowUp": return "↑"; case "ArrowDown": return "↓"; case "ArrowLeft": return "←"; case "ArrowRight": return "→"; case "Tab": return "Tab"; case "Enter": return "Enter"; case "Escape": return "Esc"; case "Backspace": return "⌫"; }
		if (key && key.length === 1) return key.toUpperCase();
		return key || "—";
	}
};
