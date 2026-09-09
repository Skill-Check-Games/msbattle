// Custom rooms: casual races configured up front. Open lobbies to join, games in progress, and a
// create-lobby modal with segmented rulesets. Joining hands off to the play page via the store.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { match, useMatch, RoomSummary } from "../../game/match-store";
import Modal from "../../app/Modal";
import styles from "./CustomPage.module.scss";

const BOARD_DIMS: Record<string, [number, number]> = { small: [10, 13], medium: [16, 20], large: [16, 30] };
const roundLabel = (s: number) => s === 0 ? "No limit" : s % 60 === 0 ? (s / 60) + " min" : s + "s";
type SegKey = "players" | "boardSize" | "roundSeconds" | "deathPenalty" | "gameCount" | "modifier";
const SEG: Record<SegKey, Array<[string, string, string?]>> = {
	players: [["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"], ["6", "6"]],
	boardSize: [["small", "Small", "10×13"], ["medium", "Medium", "16×20"], ["large", "Large", "16×30"]],
	roundSeconds: [["60", "1 min"], ["120", "2 min"], ["180", "3 min"], ["300", "5 min"], ["0", "∞"]],
	deathPenalty: [["0", "None"], ["3", "3s"], ["5", "5s"], ["10", "10s"]],
	gameCount: [["1", "1 game"], ["3", "Best of 3"], ["5", "Best of 5"], ["7", "Best of 7"], ["10", "Best of 10"]],
	modifier: [["", "None"], ["noFlags", "No flags"], ["onlyFlags", "Only flags"]]
};
const DEFAULTS: Record<SegKey, string> = { players: "2", boardSize: "medium", roundSeconds: "120", deathPenalty: "5", gameCount: "5", modifier: "" };

export default function CustomPage() {
	const s = useMatch();
	const navigate = useNavigate();
	const [create, setCreate] = useState(false);
	useEffect(() => { match.requestRoomList(); }, []);
	useEffect(() => { if (s.inRoom) navigate("/play"); }, [s.inRoom]);
	const rooms = s.rooms || [];
	const open = rooms.filter(r => r.phase === "planning"), busy = rooms.filter(r => r.phase !== "planning");
	return (
		<section>
			<div className={styles.head}>
				<div><h1 className={styles.title}>Custom rooms</h1><p className={styles.sub}>Casual races with your own rules. No rating change.</p></div>
				<button type="button" className="btn btn-primary" onClick={() => setCreate(true)}>+ Create room</button>
			</div>
			{s.message && <p className={styles.error}>{s.message}</p>}
			<h2 className={styles.listTitle}>Open lobbies</h2>
			<ul className={styles.list}>{open.length ? open.map(r => <RoomRow key={r.id} room={r} joinable />) : <li className={styles.empty}>No open lobbies. Create one to get started.</li>}</ul>
			<h2 className={styles.listTitle}>In progress</h2>
			<ul className={styles.list}>{busy.length ? busy.map(r => <RoomRow key={r.id} room={r} />) : <li className={styles.empty}>No games in progress.</li>}</ul>
			<CreateRoomModal open={create} onClose={() => setCreate(false)} />
		</section>
	);
}

function RoomRow({ room, joinable }: { room: RoomSummary; joinable?: boolean }) {
	const full = room.playerCount >= room.maxPlayers, dims = BOARD_DIMS[room.boardSize || ""];
	return (
		<li className={styles.row}>
			<div className={styles.info}>
				<div className={styles.rowTitle}>{room.ownerName}'s lobby</div>
				<div className={styles.chips}>
					<span className={`${styles.chip} ${full ? styles.chipFull : ""}`}>{room.playerCount} / {room.maxPlayers} players</span>
					{dims && <span className={styles.chip}>{dims[0]}×{dims[1]}</span>}
					{typeof room.mineDensity === "number" && <span className={styles.chip}>{Math.round(room.mineDensity * 100)}% mines</span>}
					<span className={styles.chip}>{roundLabel(room.roundSeconds)}</span>
					<span className={styles.chip}>{room.gameCount === 1 ? "Single game" : "Best of " + room.gameCount}</span>
				</div>
				<div className={styles.meta}>{room.phase !== "planning" && `Game ${room.gamesPlayed} of ${room.gameCount} · `}{(room.players || []).join(", ")}</div>
			</div>
			{joinable ? <button type="button" className="btn" disabled={full} onClick={() => match.joinRoom(room.id)}>{full ? "Full" : "Join"}</button> : <span className={styles.badge}>In game</span>}
		</li>
	);
}

function CreateRoomModal({ open, onClose }: { open: boolean; onClose: () => void }) {
	const [sel, setSel] = useState<Record<SegKey, string>>(DEFAULTS);
	const [density, setDensity] = useState(10);
	const seg = (key: SegKey, label: string) => (
		<div className={styles.field}>
			<span className={styles.fieldLabel}>{label}</span>
			<div className={styles.seg}>
				{SEG[key].map(([val, text, small]) => (
					<button key={val} type="button" className={sel[key] === val ? styles.active : ""} onClick={() => setSel(x => ({ ...x, [key]: val }))}>{text}{small && <small>{small}</small>}</button>
				))}
			</div>
		</div>
	);
	const submit = () => {
		match.createRoom({ players: parseInt(sel.players, 10), boardSize: sel.boardSize, mineDensity: density / 100, roundSeconds: parseInt(sel.roundSeconds, 10), deathPenalty: parseInt(sel.deathPenalty, 10), gameCount: parseInt(sel.gameCount, 10), modifier: sel.modifier || null });
		onClose();
	};
	return (
		<Modal open={open} onClose={onClose} title="Create a lobby" width={560}>
			<p className={styles.sub}>Casual race, no rating change. Share the lobby or add bots once you're in.</p>
			<div className={styles.fields}>
				{seg("players", "Players")}
				{seg("boardSize", "Board size")}
				<div className={styles.field}>
					<div className={styles.fieldHead}><span className={styles.fieldLabel}>Mine density</span><span className={styles.sliderVal}>{density}%</span></div>
					<input type="range" className={styles.slider} min={10} max={30} step={1} value={density} aria-label="Mine density" onChange={e => setDensity(Number(e.target.value))} />
					<div className={styles.scale}><span>10%</span><span>20%</span><span>30%</span></div>
				</div>
				{seg("roundSeconds", "Round time")}
				{seg("deathPenalty", "Mine penalty")}
				{seg("gameCount", "Series length")}
				{seg("modifier", "Modifier")}
			</div>
			<div className={styles.actions}><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="btn btn-primary" onClick={submit}>Create lobby</button></div>
		</Modal>
	);
}
