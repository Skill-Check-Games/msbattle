// Marketing HQ (/admin/marketing): the story we tell, the brand kit, a studio that renders social images on the
// live board renderer, a copy library with one-click copy, video storyboards with a recording recipe, the channel
// plan with a launch calendar and a persistent checklist, and a UTM link builder. The words live in
// marketing-data.ts; this file is the tooling.
import { useEffect, useRef, useState } from "react";
import BoardLogic from "core/src/common/BoardLogic.js";
import { BoardView, sizeCellCanvas, KNOWN, UNKNOWN, FLAGGED, MINE, BOARD_SKINS, BOARD_SKIN_LIST, AVATAR_IMAGES } from "../../game/board-render";
import { AdminPage, adminStyles } from "./admin-shared";
import { Seg, LabSection, labStyles } from "./lab-shared";
import { SITE, ONE_LINERS, PILLARS, AUDIENCES, COPY, STORYBOARDS, RECORDING_KIT, FFMPEG, VIDEO_SPECS, IMAGE_SPECS, CHANNELS, CALENDAR, CHECKLIST, METRICS, UTM_SOURCES, UTM_MEDIUMS } from "./marketing-data";
import styles from "./MarketingAdmin.module.scss";

// ---- brand kit ----
const COLOURS: { name: string; hex: string; use: string }[] = [
	{ name: "Background", hex: "#0b1020", use: "Every page, every export" },
	{ name: "Surface", hex: "#131a2e", use: "Cards, panels" },
	{ name: "Text", hex: "#e6e9f5", use: "Body copy" },
	{ name: "Muted", hex: "#8b93b8", use: "Secondary text" },
	{ name: "Accent", hex: "#6366f1", use: "Buttons, links" },
	{ name: "Battle blue", hex: "#3b82f6", use: "The wordmark's 'Battle', your side of a duel" },
	{ name: "Opponent red", hex: "#fb7185", use: "Their side of a duel" },
	{ name: "Sprint", hex: "#fbbf24", use: "The Sprint mode colour" },
	{ name: "Standard", hex: "#a78bfa", use: "The Standard mode colour" },
	{ name: "Win", hex: "#4ade80", use: "Victory, positive deltas" }
];
const ASSETS: { name: string; src: string; note: string }[] = [
	{ name: "Logo (SVG)", src: "/logo.svg", note: "Scales to anything. The mine on the blue tile." },
	{ name: "Logo 512", src: "/logo-512.png", note: "PNG with transparency, app icon size." },
	{ name: "Promo: Then vs Now (WebP)", src: "/marketing/promo-then-now.webp", note: "1536x1024, the hero image. Reddit, X, Product Hunt." },
	{ name: "Promo: Then vs Now (JPEG)", src: "/marketing/promo-then-now.jpg", note: "Same image for places that refuse WebP." }
];

// ---- the studio's demo board: the shop's layout, opened twice and flagged, so it reads as a game in progress ----
const DEMO_ROWS = 8, DEMO_COLS = 11;
const DEMO_MINES = [[0, 5], [2, 3], [2, 5], [3, 1], [3, 2], [3, 3], [1, 8], [6, 1]];
function demoBoard() {
	const isMine = (r: number, c: number) => DEMO_MINES.some(m => m[0] === r && m[1] === c);
	const cellAt = (r: number, c: number) => {
		if (isMine(r, c)) return MINE;
		let n = 0; BoardLogic.forEachNeighbour(r, c, DEMO_ROWS, DEMO_COLS, (nr: number, nc: number) => { if (isMine(nr, nc)) n++; });
		return n;
	};
	const state: number[][] = []; for (let r = 0; r < DEMO_ROWS; r++) state.push(new Array(DEMO_COLS).fill(UNKNOWN));
	const open = (r: number, c: number) => BoardLogic.cascadeReveal(r, c, DEMO_ROWS, DEMO_COLS, (rr: number, cc: number) => state[rr][cc] === UNKNOWN, (rr: number, cc: number) => { state[rr][cc] = KNOWN; return cellAt(rr, cc) === MINE; }, (rr: number, cc: number) => cellAt(rr, cc));
	open(1, 1); open(6, 8);
	for (const m of [[2, 3], [3, 1], [1, 8], [6, 1]]) state[m[0]][m[1]] = FLAGGED;
	return { state, cellAt };
}

interface Format { id: string; label: string; w: number; h: number; }
const FORMATS: Format[] = [
	{ id: "og", label: "Link preview 1200x630", w: 1200, h: 630 },
	{ id: "x-header", label: "X header 1500x500", w: 1500, h: 500 },
	{ id: "yt", label: "YouTube 1280x720", w: 1280, h: 720 },
	{ id: "square", label: "Square 1080", w: 1080, h: 1080 },
	{ id: "story", label: "Story 1080x1920", w: 1080, h: 1920 }
];
const loadImage = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
	const lines: string[] = []; let line = "";
	for (const word of text.split(/\s+/)) {
		const probe = line ? line + " " + word : word;
		if (ctx.measureText(probe).width > maxW && line) { lines.push(line); line = word; } else line = probe;
	}
	if (line) lines.push(line);
	return lines;
}
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
	ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
const FONT = (px: number, weight = 700) => `${weight} ${px}px "Space Grotesk", system-ui, -apple-system, sans-serif`;

// Renders one social image: the site's gradient and a faint tile grid, the logo and wordmark, the headline and
// sub, the demo board on a glowing card in the chosen skin, and the site address. Three layouts by aspect.
async function renderStudio(canvas: HTMLCanvasElement, f: Format, headline: string, sub: string, skin: string, showBoard: boolean) {
	try { await (document as any).fonts?.load(FONT(40)); } catch { /* the fallback font will do */ }
	const logo = await loadImage("/logo-512.png").catch(() => null);
	const w = f.w, h = f.h; canvas.width = w; canvas.height = h;
	const ctx = canvas.getContext("2d")!;
	const g = ctx.createRadialGradient(w * 0.2, 0, 0, w * 0.2, 0, Math.max(w, h) * 0.95); g.addColorStop(0, "#1a2547"); g.addColorStop(0.6, "#0b1020"); g.addColorStop(1, "#0b1020");
	ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
	const tile = Math.round(Math.min(w, h) / 14); ctx.globalAlpha = 0.045; ctx.fillStyle = "#3b82f6";
	for (let y = -tile; y < h + tile; y += tile) for (let x = -tile; x < w + tile; x += tile) { roundRect(ctx, x + tile * 0.08, y + tile * 0.08, tile * 0.84, tile * 0.84, tile * 0.16); ctx.fill(); }
	ctx.globalAlpha = 1;
	const portrait = h / w >= 1.3, landscape = w / h >= 1.4;
	const m = Math.round(Math.min(w, h) * 0.07);
	// the board on its card
	const drawBoard = (x: number, y: number, boardW: number) => {
		if (!showBoard) return 0;
		const { state, cellAt } = demoBoard();
		const cellPx = boardW / DEMO_COLS, bc = document.createElement("canvas");
		sizeCellCanvas(bc, DEMO_COLS, DEMO_ROWS, cellPx);
		new BoardView(bc, DEMO_ROWS, DEMO_COLS, state, cellAt, { skin }).draw();
		const boardH = cellPx * DEMO_ROWS, pad = cellPx * 0.5;
		ctx.save(); ctx.shadowColor = "rgba(59, 130, 246, 0.55)"; ctx.shadowBlur = cellPx * 1.2;
		roundRect(ctx, x - pad, y - pad, boardW + pad * 2, boardH + pad * 2, cellPx * 0.5); ctx.fillStyle = "#131a2e"; ctx.fill(); ctx.restore();
		roundRect(ctx, x - pad, y - pad, boardW + pad * 2, boardH + pad * 2, cellPx * 0.5); ctx.strokeStyle = "#3b82f6"; ctx.lineWidth = Math.max(2, cellPx * 0.06); ctx.stroke();
		ctx.drawImage(bc, x, y, boardW, boardH);
		return boardH + pad * 2;
	};
	const wordmark = (x: number, y: number, size: number, centred = false) => {
		const gap = size * 0.28, logoPx = size * 1.15;
		ctx.font = FONT(size); const msW = ctx.measureText("MS").width, battleW = ctx.measureText("Battle").width;
		const total = logoPx + gap + msW + battleW;
		let cx = centred ? x - total / 2 : x;
		if (logo) ctx.drawImage(logo, cx, y - logoPx * 0.5 - size * 0.36, logoPx, logoPx);
		cx += logoPx + gap;
		ctx.textBaseline = "middle"; ctx.fillStyle = "#ffffff"; ctx.fillText("MS", cx, y); ctx.fillStyle = "#3b82f6"; ctx.fillText("Battle", cx + msW, y);
		return total;
	};
	const paragraph = (text: string, x: number, y: number, size: number, maxW: number, colour: string, centred = false, weight = 700) => {
		ctx.font = FONT(size, weight); ctx.fillStyle = colour; ctx.textBaseline = "top"; ctx.textAlign = centred ? "center" : "left";
		const lines = wrapLines(ctx, text, maxW); lines.forEach((l, i) => ctx.fillText(l, x, y + i * size * 1.12)); ctx.textAlign = "left";
		return lines.length * size * 1.12;
	};
	if (landscape) {
		const textW = w * 0.44, boardW = w * 0.42;
		wordmark(m, m + h * 0.07, h * 0.12);
		let y = m + h * 0.22;
		y += paragraph(headline, m, y, h * 0.125, textW, "#ffffff") + h * 0.04;
		if (sub) paragraph(sub, m, y, h * 0.055, textW, "#8b93b8", false, 500);
		const boardH = DEMO_ROWS * (boardW / DEMO_COLS);
		drawBoard(w - m - boardW, (h - boardH) / 2 - h * 0.03, boardW);
		// the address sits under the board, right-aligned, clear of a long sub line on the left
		ctx.font = FONT(h * 0.05, 600); ctx.fillStyle = "#8b93b8"; ctx.textBaseline = "bottom"; ctx.textAlign = "right"; ctx.fillText("msbattle.net", w - m, h - m * 0.7); ctx.textAlign = "left";
	} else if (portrait) {
		wordmark(w / 2, m + w * 0.09, w * 0.13, true);
		let y = m + w * 0.24;
		y += paragraph(headline, w / 2, y, w * 0.105, w * 0.86, "#ffffff", true) + w * 0.04;
		if (sub) y += paragraph(sub, w / 2, y, w * 0.048, w * 0.8, "#8b93b8", true, 500);
		const boardW = w * 0.82, boardH = DEMO_ROWS * (boardW / DEMO_COLS);
		drawBoard((w - boardW) / 2, Math.max(y + w * 0.12, (h - boardH) / 2 + h * 0.06), boardW);
		ctx.font = FONT(w * 0.05, 600); ctx.fillStyle = "#8b93b8"; ctx.textBaseline = "bottom"; ctx.textAlign = "center"; ctx.fillText("msbattle.net", w / 2, h - m); ctx.textAlign = "left";
	} else {
		wordmark(m, m + w * 0.06, w * 0.09);
		let y = m + w * 0.17;
		y += paragraph(headline, m, y, w * 0.085, w * 0.86, "#ffffff") + w * 0.03;
		if (sub) y += paragraph(sub, m, y, w * 0.04, w * 0.8, "#8b93b8", false, 500);
		const boardW = w * 0.78, boardH = DEMO_ROWS * (boardW / DEMO_COLS);
		drawBoard((w - boardW) / 2, Math.max(y + w * 0.08, h - m - boardH - w * 0.06), boardW);
		ctx.font = FONT(w * 0.038, 600); ctx.fillStyle = "#8b93b8"; ctx.textBaseline = "bottom"; ctx.fillText("msbattle.net", m, h - m * 0.6);
	}
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
	const [done, setDone] = useState(false);
	const copy = async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1400); } catch { /* clipboard blocked */ } };
	return <button type="button" className={`btn ${styles.copyBtn} ${done ? styles.copied : ""}`} onClick={copy}>{done ? "Copied" : label}</button>;
}

function Studio() {
	const [format, setFormat] = useState("og");
	const [headline, setHeadline] = useState(ONE_LINERS[0]);
	const [sub, setSub] = useState("Two players, one board, first to clear it wins. Free in your browser.");
	const [skin, setSkin] = useState("classic");
	const [showBoard, setShowBoard] = useState(true);
	const ref = useRef<HTMLCanvasElement>(null);
	const f = FORMATS.find(x => x.id === format) || FORMATS[0];
	useEffect(() => { let live = true; const c = ref.current; if (!c) return; renderStudio(c, f, headline, sub, skin, showBoard).catch(() => {}); return () => { live = false; void live; }; }, [format, headline, sub, skin, showBoard]);
	const download = () => { const c = ref.current; if (!c) return; c.toBlob(b => { if (!b) return; const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `msbattle-${f.id}-${f.w}x${f.h}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }, "image/png"); };
	return (
		<div className={styles.studio}>
			<div className={styles.controls}>
				<label className={adminStyles.label}>Format</label>
				<select className={adminStyles.input} value={format} onChange={e => setFormat(e.target.value)}>{FORMATS.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
				<label className={adminStyles.label}>Headline</label>
				<input className={adminStyles.input} value={headline} onChange={e => setHeadline(e.target.value)} />
				<div className={styles.chips}>{ONE_LINERS.map(l => <button key={l} type="button" className={styles.chip} onClick={() => setHeadline(l)}>{l}</button>)}</div>
				<label className={adminStyles.label}>Sub line</label>
				<input className={adminStyles.input} value={sub} onChange={e => setSub(e.target.value)} />
				<label className={adminStyles.label}>Board skin</label>
				<Seg options={BOARD_SKIN_LIST.map((id: string) => ({ id, label: BOARD_SKINS[id].label }))} value={skin} onChange={setSkin} ariaLabel="Board skin" />
				<label className={styles.checkRow}><input type="checkbox" checked={showBoard} onChange={e => setShowBoard(e.target.checked)} /> Show the board</label>
				<div className={adminStyles.row}><button type="button" className="btn btn-primary" onClick={download}>Download PNG</button><span className={adminStyles.muted}>{f.w} x {f.h}</span></div>
			</div>
			<div className={styles.preview}><canvas ref={ref} className={styles.previewCanvas} /></div>
		</div>
	);
}

function UtmBuilder() {
	const [source, setSource] = useState("reddit");
	const [medium, setMedium] = useState("social");
	const [campaign, setCampaign] = useState("launch");
	const [content, setContent] = useState("");
	const [path, setPath] = useState("/");
	const build = (s: string, m: string, c = content) => { const p = new URLSearchParams({ utm_source: s, utm_medium: m, utm_campaign: campaign }); if (c) p.set("utm_content", c); return SITE + path + "?" + p.toString(); };
	const url = build(source, medium);
	return (
		<div className={styles.utm}>
			<div className={styles.utmRow}>
				<label className={adminStyles.label}>Source</label><select className={adminStyles.input} value={source} onChange={e => setSource(e.target.value)}>{UTM_SOURCES.map(s => <option key={s}>{s}</option>)}</select>
				<label className={adminStyles.label}>Medium</label><select className={adminStyles.input} value={medium} onChange={e => setMedium(e.target.value)}>{UTM_MEDIUMS.map(s => <option key={s}>{s}</option>)}</select>
				<label className={adminStyles.label}>Campaign</label><input className={adminStyles.input} value={campaign} onChange={e => setCampaign(e.target.value)} />
				<label className={adminStyles.label}>Content</label><input className={adminStyles.input} value={content} placeholder="optional, e.g. thread-1" onChange={e => setContent(e.target.value)} />
				<label className={adminStyles.label}>Path</label><input className={adminStyles.input} value={path} onChange={e => setPath(e.target.value)} />
			</div>
			<div className={styles.utmOut}><code className={adminStyles.mono}>{url}</code><CopyButton text={url} /></div>
			<div className={adminStyles.tableWrap}><table className={adminStyles.table}><thead><tr><th>Ready links for this campaign</th><th></th></tr></thead><tbody>
				{UTM_SOURCES.map(s => { const m = s === "newsletter" ? "email" : s === "youtube" || s === "tiktok" ? "video" : s === "discord" ? "community" : s === "streamer" || s === "itch" ? "referral" : "social"; const u = build(s, m, ""); return <tr key={s}><td className={adminStyles.mono}>{u}</td><td><CopyButton text={u} /></td></tr>; })}
			</tbody></table></div>
		</div>
	);
}

function Checklist() {
	const KEY = "ms_marketing_done";
	const [done, setDone] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } });
	const toggle = (id: string) => { const next = { ...done, [id]: !done[id] }; setDone(next); try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage blocked */ } };
	const count = CHECKLIST.filter(c => done[c.id]).length;
	return (
		<div className={`${adminStyles.card} ${styles.checklist}`}>
			<div className={styles.checkHead}><span className={labStyles.panelTitle}>Launch checklist</span><span className={adminStyles.muted}>{count} / {CHECKLIST.length}</span></div>
			{CHECKLIST.map(c => <label key={c.id} className={`${styles.checkRow} ${done[c.id] ? styles.checkDone : ""}`}><input type="checkbox" checked={!!done[c.id]} onChange={() => toggle(c.id)} /> {c.label}</label>)}
		</div>
	);
}

export default function MarketingAdmin() {
	return (
		<AdminPage title="Marketing HQ" sub="Everything for telling people about MS Battle: the story, the brand kit, a studio for social images, copy to paste, video storyboards, and the plan for where and when to post. This page is only ever seen by admins." wide>
			<LabSection title="The story" sub="One idea, said five ways, backed by five things that are true. Every post on this page comes from these.">
				<div className={styles.oneLiners}>{ONE_LINERS.map(l => <div key={l} className={styles.oneLiner}><span>{l}</span><CopyButton text={l} /></div>)}</div>
				<div className={styles.pillars}>{PILLARS.map(p => <div key={p.title} className={`${adminStyles.card} ${styles.pillar}`}><h3 className={adminStyles.cardTitle}>{p.title}</h3><p className={styles.hook}>{p.hook}</p><p className={adminStyles.cardText}>{p.proof}</p></div>)}</div>
				<div className={adminStyles.tableWrap}><table className={adminStyles.table}><thead><tr><th>Who</th><th>Where they are</th><th>The angle</th></tr></thead><tbody>
					{AUDIENCES.map(a => <tr key={a.who}><td><strong>{a.who}</strong></td><td>{a.where}</td><td>{a.angle}</td></tr>)}
				</tbody></table></div>
			</LabSection>

			<LabSection title="Brand kit" sub="The logo, the wordmark rule (MS in white, Battle in blue), the palette, the type, and the cosmetics that show up in screenshots.">
				<div className={styles.assets}>{ASSETS.map(a => <a key={a.src} className={`${adminStyles.card} ${styles.asset}`} href={a.src} download><img src={a.src} alt={a.name} className={styles.assetImg} /><span className={styles.assetName}>{a.name}</span><span className={adminStyles.muted}>{a.note}</span></a>)}</div>
				<div className={styles.swatches}>{COLOURS.map(c => <div key={c.hex} className={styles.swatch}><span className={styles.swatchColour} style={{ background: c.hex }} /><span className={styles.swatchName}>{c.name}</span><span className={adminStyles.mono}>{c.hex}</span><span className={adminStyles.muted}>{c.use}</span><CopyButton text={c.hex} /></div>)}</div>
				<div className={styles.typeRow}><span className={styles.typeSample}>Space Grotesk 700 for display, system-ui for body.</span><span className={adminStyles.muted}>Wordmark: "MS" #ffffff then "Battle" #3b82f6, no space, Space Grotesk 700. Never stretch the logo, never put it on white without the tile.</span></div>
				<div className={styles.galleryRow}>
					<div><div className={adminStyles.label}>Avatars</div><div className={styles.gallery}>{Object.keys(AVATAR_IMAGES).map(id => <a key={id} href={AVATAR_IMAGES[id]} download title={id}><img src={AVATAR_IMAGES[id]} alt={id} className={styles.avatarImg} /></a>)}</div></div>
					<div><div className={adminStyles.label}>Board skins</div><div className={styles.gallery}>{BOARD_SKIN_LIST.filter((id: string) => id !== "classic").map((id: string) => <a key={id} href={`/skins/${id}-preview.png`} download title={BOARD_SKINS[id].label}><img src={`/skins/${id}-preview.png`} alt={BOARD_SKINS[id].label} className={styles.skinImg} /></a>)}</div></div>
				</div>
			</LabSection>

			<LabSection title="Image studio" sub="Social images rendered by the game's own board renderer, so the tiles are pixel-exact. Pick a format, write the line, choose a skin, download. The first thing to make is the link preview: index.html still points og:image at the bare logo.">
				<Studio />
				<div className={adminStyles.tableWrap}><table className={adminStyles.table}><thead><tr><th>Surface</th><th>Size</th><th>Use</th></tr></thead><tbody>
					{IMAGE_SPECS.map(s => <tr key={s.surface}><td>{s.surface}</td><td className={adminStyles.mono}>{s.size}</td><td>{s.use}</td></tr>)}
				</tbody></table></div>
			</LabSection>

			<LabSection title="Copy library" sub="Ready to paste, one per channel and purpose. Read the note under each: every community has its own rules, and the same words in the wrong tone get removed.">
				<div className={styles.copyGrid}>{COPY.map(c => (
					<div key={c.id} className={`${adminStyles.card} ${styles.copyCard}`}>
						<div className={styles.copyHead}><div><span className={styles.copyChannel}>{c.channel}</span><h3 className={adminStyles.cardTitle}>{c.title}</h3></div><CopyButton text={c.body} /></div>
						<pre className={styles.copyBody}>{c.body}</pre>
						{c.notes && <p className={styles.copyNotes}>{c.notes}</p>}
					</div>
				))}</div>
			</LabSection>

			<LabSection title="Video" sub="Five clips cover every channel. Record all the raw footage in one sitting with the recipe below, then cut. The game's own sounds carry the clips.">
				<div className={styles.storyboards}>{STORYBOARDS.map(s => (
					<div key={s.id} className={`${adminStyles.card} ${styles.storyboard}`}>
						<div className={styles.sbHead}><h3 className={adminStyles.cardTitle}>{s.title}</h3><span className={adminStyles.chip}>{s.length}</span><span className={adminStyles.chip}>{s.aspect}</span></div>
						<p className={adminStyles.cardText}>{s.purpose}</p>
						<table className={styles.shots}><tbody>{s.shots.map((sh, i) => <tr key={i}><td className={styles.shotT}>{sh.t}</td><td><div>{sh.shot}</div>{sh.overlay && <div className={styles.overlay}>Text: {sh.overlay}</div>}{sh.audio && <div className={styles.audio}>Audio: {sh.audio}</div>}</td></tr>)}</tbody></table>
					</div>
				))}</div>
				<div className={styles.twoCol}>
					<div className={adminStyles.card}><div className={labStyles.panelTitle}>Recording recipe</div><ol className={styles.kit}>{RECORDING_KIT.map(k => <li key={k.step}><strong>{k.step}.</strong> {k.detail}</li>)}</ol></div>
					<div className={adminStyles.card}><div className={labStyles.panelTitle}>Cutting with ffmpeg</div>{FFMPEG.map(f => <div key={f.label} className={styles.cmd}><div className={styles.cmdLabel}>{f.label}<CopyButton text={f.cmd} /></div><pre className={styles.cmdPre}>{f.cmd}</pre></div>)}</div>
				</div>
				<div className={adminStyles.tableWrap}><table className={adminStyles.table}><thead><tr><th>Platform</th><th>Aspect</th><th>Length</th><th>Notes</th></tr></thead><tbody>
					{VIDEO_SPECS.map(v => <tr key={v.platform}><td>{v.platform}</td><td className={adminStyles.mono}>{v.aspect}</td><td>{v.length}</td><td>{v.notes}</td></tr>)}
				</tbody></table></div>
			</LabSection>

			<LabSection title="Where to post" sub="Twelve channels, each with its audience, its format, the angle that fits it, and the rule that gets posts removed there.">
				<div className={adminStyles.tableWrap}><table className={`${adminStyles.table} ${styles.channels}`}><thead><tr><th>Channel</th><th>Audience</th><th>Format</th><th>Angle</th><th>Cadence</th><th>Rules</th></tr></thead><tbody>
					{CHANNELS.map(c => <tr key={c.name}><td><strong>{c.name}</strong></td><td>{c.audience}</td><td>{c.format}</td><td>{c.angle}</td><td>{c.cadence}</td><td className={adminStyles.muted}>{c.rules}</td></tr>)}
				</tbody></table></div>
			</LabSection>

			<LabSection title="The launch plan" sub="Six weeks around launch day. Soft launch with the experts first, then the one-shot channels in a single week, then the long tail. The checklist remembers itself in this browser.">
				<div className={styles.twoCol}>
					<div className={styles.calendar}>{CALENDAR.map(c => <div key={c.week} className={`${adminStyles.card} ${styles.week}`}><div className={styles.weekHead}><span className={styles.weekName}>{c.week}</span><span className={adminStyles.muted}>{c.theme}</span></div><ul className={styles.weekList}>{c.actions.map(a => <li key={a}>{a}</li>)}</ul></div>)}</div>
					<Checklist />
				</div>
			</LabSection>

			<LabSection title="Measure" sub="Six numbers that say whether it is working, and the links that make the first one possible.">
				<div className={adminStyles.tableWrap}><table className={adminStyles.table}><thead><tr><th>Metric</th><th>Why</th><th>How</th></tr></thead><tbody>
					{METRICS.map(m => <tr key={m.metric}><td><strong>{m.metric}</strong></td><td>{m.why}</td><td className={adminStyles.muted}>{m.how}</td></tr>)}
				</tbody></table></div>
				<UtmBuilder />
			</LabSection>
		</AdminPage>
	);
}
