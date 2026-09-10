// The customize lab: avatar, board skin and reveal-effect pickers beside a live preview (your
// identity plus a playable demo board through the real engine). Locked items can be previewed and
// bought from here. Hosted by the Shop page and by the home avatar's modal.
import { useEffect, useMemo, useRef, useState } from "react";
import Cosmetics from "core/src/common/Cosmetics.js";
import BoardLogic from "core/src/common/BoardLogic.js";
import { useAuth } from "../../shared/auth";
import { getSocket } from "../../online/socket";
import { BoardSession } from "../../game/board-session";
import { BoardView, MINE, UNKNOWN, KNOWN, buildAvatarCanvas, sizeCellCanvas, applyBoardSkin, applyRevealEffect, localBoardSkin, localRevealEffect, REVEAL_DUR, WAVE_STEP_MS, WAVE_MAX_MS, BOARD_SKINS, BOARD_SKIN_LIST, AVATAR_COLORS, AVATAR_IMAGES, REVEAL_EFFECT_LIST, DEFAULT_AVATAR } from "../../game/board-render";
import { setBoardSkin, setRevealEffect, useCosmetics } from "../../shared/cosmetics";
import GameBoard from "../../game/GameBoard";
import { sound } from "../../audio/sound";
import { DuelIdentity } from "../play/hud";
import Modal from "../../app/Modal";
import { ShopItem, itemById, itemUnlocked, priceLabel, buyItem } from "./shop-api";
import styles from "./CustomizeLab.module.scss";

type Kind = "avatar" | "skin" | "revealEffect";
type Tab = Kind;
const TABS: Array<[Tab, string]> = [["avatar", "Avatar"], ["skin", "Board"], ["revealEffect", "Effects"]];
const AVATAR_BLURBS: Record<string, string> = { anon: "The default anonymous silhouette.", mine: "The classic sea mine, staring back.", "img:scout-dog": "Sniffs out the safest tile first.", "img:sentry-fox": "Keeps a sharp eye on the board.", "img:sentry-owl": "Never misses a clue.", "img:signal-cat": "Always alert for danger.", "img:guard-teddy": "A cuddly line of defense." };
const avatarLabel = (v: string) => v === "anon" ? "Anonymous" : v === "mine" ? "Mine" : itemById(v)?.label || "Flag";
const REVEAL_GLYPHS: Record<string, string> = { ripple: "🌊", spark: "⚡", shatter: "💥", crt: "📺", dust: "💨" };

// Demo board layout: an 8x11 (8x8 on phones) fixed layout with a mine-free opening. The Effects
// demo swaps in a sparse corner-mine layout and floods from the middle so one wave opens it all.
const DEMO_ROWS = 8;
const DEMO_MINES = [[0, 5], [1, 7], [1, 9], [2, 3], [2, 8], [2, 10], [3, 0], [3, 5], [4, 2], [4, 7], [5, 4], [6, 1], [6, 6], [7, 3]];
const FX_MINES = [[0, 0], [7, 0], [0, 7], [7, 7]];
const DEMO_OPEN_AT = [1, 1];

export default function CustomizeLab({ host }: { host: "page" | "modal" }) {
	const { account, update, providers } = useAuth();
	useCosmetics();
	const [tab, setTab] = useState<Tab>("avatar");
	const [preview, setPreview] = useState<{ avatar: string | null; skin: string | null; effect: string | null; last: ShopItem | null }>({ avatar: null, skin: null, effect: null, last: null });
	const [purchase, setPurchase] = useState<ShopItem | null>(null);
	const [fakeShop, setFakeShop] = useState(false);
	const [status, setStatus] = useState<{ text: string; kind: string } | null>(null);
	const [dirty, setDirty] = useState(false);
	const [, bump] = useState(0);
	const minesRef = useRef<number[][]>(DEMO_MINES);
	const colsRef = useRef(window.innerWidth <= 860 ? 8 : 11);
	const fakeAllowed = !!(account && account.isAdmin) || !!providers.dev;

	const cellAt = (r: number, c: number) => {
		if (c >= colsRef.current) return 0;
		const mines = minesRef.current;
		if (mines.some(m => m[0] === r && m[1] === c)) return MINE;
		let n = 0; BoardLogic.forEachNeighbour(r, c, DEMO_ROWS, colsRef.current, (nr: number, nc: number) => { if (mines.some(m => m[0] === nr && m[1] === nc)) n++; });
		return n;
	};
	const restingState = () => {
		const saved = minesRef.current; minesRef.current = DEMO_MINES;
		const s: number[][] = []; for (let r = 0; r < DEMO_ROWS; r++) s.push(new Array(colsRef.current).fill(UNKNOWN));
		BoardLogic.cascadeReveal(DEMO_OPEN_AT[0], DEMO_OPEN_AT[1], DEMO_ROWS, colsRef.current, (r: number, c: number) => s[r][c] === UNKNOWN, (r: number, c: number) => { s[r][c] = KNOWN; return cellAt(r, c) === MINE; }, (r: number, c: number) => cellAt(r, c));
		minesRef.current = saved;
		return s;
	};
	const session = useMemo(() => new BoardSession({ mode: () => "demo", sound, onAction: () => setDirty(true) }), []);
	useEffect(() => { session.setBoard(DEMO_ROWS, colsRef.current, cellAt, restingState()); return () => session.clear(); }, []);
	// Preview skin: the board paints in the previewed skin without changing the stored pick.
	useEffect(() => { session.skin = preview.skin; session.render(); }, [preview.skin]);

	const resetBoard = () => { minesRef.current = DEMO_MINES; session.setBoard(DEMO_ROWS, colsRef.current, cellAt, restingState()); setDirty(false); };
	const demonstrate = () => {
		minesRef.current = FX_MINES;
		session.setBoard(DEMO_ROWS, colsRef.current, cellAt, null);
		session.performAction(Math.floor(DEMO_ROWS / 2), Math.floor(colsRef.current / 2), false);
		setDirty(true);
		if (window.innerWidth <= 860) document.querySelector("[data-lab-preview]")?.scrollIntoView({ behavior: "smooth", block: "start" });
	};
	const owned = account?.ownedItems;
	const previewLocked = (kind: Kind, id: string, item: ShopItem | null) => {
		setPreview(p => ({ ...p, [kind === "avatar" ? "avatar" : kind === "skin" ? "skin" : "effect"]: id, last: item }));
		if (kind === "revealEffect") { applyRevealEffect(id); demonstrate(); }
	};
	const clearPreview = (kind: Kind) => setPreview(p => ({ ...p, [kind === "avatar" ? "avatar" : kind === "skin" ? "skin" : "effect"]: null, last: p.last && p.last.kind === kind ? null : p.last }));
	// Leaving the lab reverts any previewed effect to the real pick (the skin preview never touched the real pick).
	useEffect(() => () => { applyRevealEffect(localRevealEffect); }, []);

	const pickAvatar = (id: string) => { clearPreview("avatar"); update({ avatarColor: id }); getSocket().emit("set_avatar", { color: id }); };
	const pickSkin = (id: string) => { clearPreview("skin"); setBoardSkin(id); session.render(); };
	const pickEffect = (id: string) => { clearPreview("revealEffect"); if (id === localRevealEffect) { demonstrate(); return; } setRevealEffect(id); demonstrate(); };

	const onBought = (item: ShopItem) => {
		update({ ownedItems: [...(owned || []), item.id] });
		setPurchase(null);
		if (item.kind === "avatar") pickAvatar(item.id); else if (item.kind === "skin") pickSkin(item.id); else pickEffect(item.id);
		setStatus({ text: "Purchase complete!", kind: "success" });
	};

	const avatarValues = ["anon", "mine", ...AVATAR_COLORS, ...Object.keys(AVATAR_IMAGES).map(id => "img:" + id)];
	const identity = account ? { id: "", name: account.name, avatar: preview.avatar || account.avatarColor || DEFAULT_AVATAR, country: account.country, rating: Math.max(account.ratingSprint || 0, account.ratingStandard || 0), provisional: account.provisional } : null;

	return (
		<div className={`${styles.body} ${host === "page" ? styles.page : styles.modalHost}`}>
			<div className={styles.picker}>
				<div className={styles.tabs}>{TABS.map(([id, label]) => <button key={id} type="button" className={`${styles.tab} ${tab === id ? styles.tabActive : ""}`} onClick={() => setTab(id)}>{label}</button>)}</div>
				{fakeAllowed && host === "page" && <label className={styles.fake}><input type="checkbox" checked={fakeShop} onChange={(e) => setFakeShop(e.target.checked)} /> Fake shop</label>}
				<div className={styles.panel}>
				{status && <div className={`${styles.status} ${status.kind === "success" ? styles.statusOk : styles.statusErr}`}>{status.text}</div>}
				{tab === "avatar" && (
					<Panel title="Choose Avatar" sub="Opponents see this next to your name in every match.">
						<Grid kind="avatar" ids={avatarValues} owned={owned} activeId={preview.avatar || account?.avatarColor || DEFAULT_AVATAR} labelOf={avatarLabel} blurbOf={(id) => AVATAR_BLURBS[id] || "The default flag colour."} preview={(id) => <CanvasHolder build={() => buildAvatarCanvas(id, 96)} />} onSelect={pickAvatar} onPreviewLocked={(id, item) => previewLocked("avatar", id, item)} />
					</Panel>
				)}
				{tab === "skin" && (
					<Panel title="Choose Board Skin" sub="How your board looks, to you and to opponents.">
						<Grid kind="skin" ids={BOARD_SKIN_LIST} owned={owned} activeId={preview.skin || localBoardSkin} labelOf={(id) => BOARD_SKINS[id].label} blurbOf={(id) => BOARD_SKINS[id].blurb} preview={(id) => <SkinPreview id={id} cellPx={34} />} onSelect={pickSkin} onPreviewLocked={(id, item) => previewLocked("skin", id, item)} />
					</Panel>
				)}
				{tab === "revealEffect" && (
					<Panel title="Choose Reveal Effect" sub="What happens when a tile opens. Click the preview board to play it.">
						<div className={styles.grid}>{REVEAL_EFFECT_LIST.map(id => <EffectCard key={id} id={id} owned={owned} active={id === (preview.effect || localRevealEffect)} onSelect={pickEffect} onPreviewLocked={(item) => previewLocked("revealEffect", id, item)} />)}</div>
					</Panel>
				)}
				</div>
			</div>
			<div className={styles.preview} data-lab-preview="">
				<div className={styles.identity}><DuelIdentity player={identity as any} side="you" /></div>
				<div className={styles.boardFrame}><GameBoard session={session} cellPx={cellPxFor(colsRef.current)} keyboard={false} /></div>
				<div className={styles.boardHint}>Click a tile to test the effect!</div>
				<button type="button" className={`btn btn-ghost ${styles.reset} ${dirty ? styles.resetDirty : ""}`} disabled={!dirty} onClick={resetBoard}>↻ Reset board</button>
				{preview.last && <button type="button" className={`btn btn-primary ${styles.buy}`} onClick={() => setPurchase(preview.last)}>Buy {preview.last.label} · {priceLabel(preview.last.id)}</button>}
			</div>
			{purchase && <PurchaseModal item={purchase} fake={fakeShop && fakeAllowed} onClose={() => setPurchase(null)} onBought={() => onBought(purchase)} onError={(text) => setStatus({ text, kind: "error" })} />}
		</div>
	);
}

const cellPxFor = (cols: number) => window.innerWidth <= 860 ? Math.max(24, Math.min(38, Math.floor((Math.min(window.innerWidth, 480) - 64) / cols))) : 38;

function Panel({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
	return <div><h3 className={styles.panelTitle}>{title}</h3><p className={styles.panelSub}>{sub}</p>{children}</div>;
}

interface GridProps { kind: Kind; ids: string[]; owned?: string[]; activeId: string; labelOf: (id: string) => string; blurbOf: (id: string) => string; preview: (id: string) => React.ReactNode; onSelect: (id: string) => void; onPreviewLocked: (id: string, item: ShopItem | null) => void; }
function Grid({ kind, ids, owned, activeId, labelOf, blurbOf, preview, onSelect, onPreviewLocked }: GridProps) {
	const sorted = [...ids.filter(id => itemUnlocked(kind, id, owned)), ...ids.filter(id => !itemUnlocked(kind, id, owned))];
	return (
		<div className={styles.grid}>
			{sorted.map(id => {
				const unlocked = itemUnlocked(kind, id, owned), active = id === activeId, item = itemById(id);
				return (
					<button key={id} type="button" className={`${styles.tile} ${item?.tier ? styles["tier_" + item.tier] : ""} ${active ? styles.tileActive : ""} ${unlocked ? "" : styles.tileLocked}`} onClick={() => unlocked ? onSelect(id) : onPreviewLocked(id, item)}>
						<div className={styles.tilePreview}>{preview(id)}</div>
						{!unlocked ? <span className={styles.lock}>🔒</span> : active ? <span className={styles.check}>✓</span> : null}
						<div className={styles.tileBody}><div className={styles.tileName}>{labelOf(id)}</div><span className={styles.tileBlurb}>{blurbOf(id)}</span></div>
					</button>
				);
			})}
		</div>
	);
}

function CanvasHolder({ build }: { build: () => HTMLCanvasElement }) {
	const ref = useRef<HTMLSpanElement>(null);
	useEffect(() => { ref.current?.replaceChildren(build()); });
	return <span ref={ref} className={styles.canvasHolder} />;
}

// A 3x3 skin swatch: two mines in the corner, one plain covered cell, the rest revealed clues.
export function SkinPreview({ id, cellPx = 22 }: { id: string; cellPx?: number }) {
	const ref = useRef<HTMLCanvasElement>(null);
	useEffect(() => {
		const canvas = ref.current!; sizeCellCanvas(canvas, 3, 3, cellPx);
		const mines = [[0, 1], [1, 0]], covered = [[0, 0], [0, 1], [1, 0]];
		const inList = (l: number[][], r: number, c: number) => l.some(m => m[0] === r && m[1] === c);
		const at = (r: number, c: number) => { if (inList(mines, r, c)) return MINE; let n = 0; BoardLogic.forEachNeighbour(r, c, 3, 3, (nr: number, nc: number) => { if (inList(mines, nr, nc)) n++; }); return n; };
		const state = [0, 1, 2].map(r => [0, 1, 2].map(c => inList(covered, r, c) ? UNKNOWN : KNOWN));
		new BoardView(canvas, 3, 3, state, at, { skin: id }).draw();
	}, [id, cellPx]);
	return <canvas ref={ref} className={styles.skinSwatch} />;
}

// One reveal-effect card with its own tiny demo board: hover plays it, the active one replays.
function EffectCard({ id, owned, active, onSelect, onPreviewLocked }: { id: string; owned?: string[]; active: boolean; onSelect: (id: string) => void; onPreviewLocked: (item: ShopItem | null) => void }) {
	const unlocked = itemUnlocked("revealEffect", id, owned), item = itemById(id);
	const ref = useRef<HTMLCanvasElement>(null);
	const demo = useRef<{ play: () => void; reset: () => void } | null>(null);
	useEffect(() => {
		const canvas = ref.current!; const rows = 3, cols = 4; sizeCellCanvas(canvas, cols, rows, 30);
		let state: number[][] = [], anims: Record<string, { start: number }> = {}, raf: number | null = null;
		const fresh = () => { state = []; for (let r = 0; r < rows; r++) state.push(new Array(cols).fill(UNKNOWN)); };
		fresh();
		const view = new BoardView(canvas, rows, cols, state, () => 0, { forceRevealEffect: id, animAt: (r, c) => { const a = anims[r + "," + c]; return a ? { type: "reveal", t: (performance.now() - a.start) / REVEAL_DUR } : null; } });
		const loop = () => { const now = performance.now(); let alive = false; for (const k in anims) { if (now - anims[k].start < REVEAL_DUR + WAVE_MAX_MS) alive = true; else delete anims[k]; } view.draw(); raf = alive ? requestAnimationFrame(loop) : null; };
		const reset = () => { if (raf) cancelAnimationFrame(raf); raf = null; anims = {}; fresh(); view.setState(state); view.draw(); };
		const play = () => {
			const cells: number[][] = []; for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push([r, c]);
			cells.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]));
			const t0 = performance.now();
			cells.forEach((p, i) => { if (state[p[0]][p[1]] !== UNKNOWN) return; state[p[0]][p[1]] = KNOWN; anims[p[0] + "," + p[1]] = { start: t0 + i * WAVE_STEP_MS }; });
			if (raf) cancelAnimationFrame(raf); loop();
		};
		demo.current = { play: () => { reset(); play(); }, reset };
		reset();
		let timer: number | null = null;
		if (active) { demo.current.play(); timer = window.setInterval(() => demo.current?.play(), 4200); }
		return () => { if (raf) cancelAnimationFrame(raf); if (timer) clearInterval(timer); };
	}, [id, active]);
	const fx = Cosmetics.REVEAL_EFFECTS[id];
	return (
		<button type="button" className={`${styles.tile} ${item?.tier ? styles["tier_" + item.tier] : ""} ${active ? styles.tileActive : ""} ${unlocked ? "" : styles.tileLocked}`}
			onMouseEnter={() => demo.current?.play()} onMouseLeave={() => demo.current?.reset()}
			onClick={() => unlocked ? onSelect(id) : onPreviewLocked(item)}>
			<div className={styles.tilePreview}><canvas ref={ref} className={styles.fxCanvas} /></div>
			{!unlocked ? <span className={styles.lock}>🔒</span> : active ? <span className={styles.check}>✓</span> : null}
			<div className={styles.tileBody}><div className={styles.tileName}>{fx.label}</div><span className={styles.tileBlurb}>{fx.blurb.replace(" — ", ". ")}</span></div>
		</button>
	);
}

function PurchaseModal({ item, fake, onClose, onBought, onError }: { item: ShopItem; fake: boolean; onClose: () => void; onBought: () => void; onError: (text: string) => void }) {
	const [busy, setBusy] = useState(false);
	const buy = async () => {
		setBusy(true);
		const r = await buyItem(item, fake);
		setBusy(false);
		if (r.ok === false) { onError(r.error); onClose(); return; }
		if (r.owned) onBought();
	};
	return (
		<Modal open onClose={onClose} width={420} title="Buy this item" labelledBy="item_purchase_title">
			<div className={styles.purchase}>
				<div className={styles.purchasePreview}>
					{item.kind === "avatar" ? <CanvasHolder build={() => buildAvatarCanvas(item.id, 72)} /> : item.kind === "skin" ? <SkinPreview id={item.id} /> : <span className={styles.fxGlyph}>{REVEAL_GLYPHS[item.id] || "✨"}</span>}
				</div>
				<div className={styles.purchaseName}>{item.label}</div>
				<button type="button" className="btn btn-primary" disabled={busy} onClick={buy}>{fake ? "Activate (fake)" : priceLabel(item.id)}</button>
			</div>
		</Modal>
	);
}

// Re-export for hosts that need the skin change to repaint (the home page previews use useCosmetics).
export { applyBoardSkin };
