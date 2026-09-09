// Custom room waiting room: one seat per maxPlayers (bots can be added to empty seats by the owner),
// the series ruleset card (editable by the owner in planning), and the Ready bar.
import { getSocket } from "../../online/socket";
import { tierFor } from "../../shared/ranking";
import { formatGameProgress } from "../../game/match-store";
import type { RoomState } from "../../game/match-store";
import styles from "./RoomLobby.module.scss";

const cap = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
export const formatRoundOption = (s: number) => s >= 60 ? (s / 60) + " min" : s + " s";
export const formatPenaltyOption = (s: number) => s === 0 ? "None" : s + " s";
export const formatBoardSize = (size: string) => ({ small: "Small (10×13)", medium: "Medium (16×20)", large: "Large (16×30)" } as Record<string, string>)[size] || size;
export const formatMineDensity = (d: number) => Math.round((d || 0.1) * 100) + "% mines";
const formatSeriesFormat = (n: number, target: number | null) => target ? "First to " + target : "Best of " + n;

export default function RoomLobby({ room, myId }: { room: RoomState; myId: string | null }) {
	const socket = getSocket();
	const isOwner = room.owner === myId;
	const canEdit = isOwner && room.phase === "planning";
	const canAddBot = canEdit && (room.botCount || 0) < room.maxBots;
	const me = room.players.find(p => p.id === myId);
	const iAmReady = !!(me && me.ready);
	const seats = room.maxPlayers || room.players.length;
	const status = room.gamesPlayed === 0 && !room.seriesWinner
		? (room.players.length < 2 ? "Waiting for more players to join…" : "Click Ready when you're set.")
		: "Next series starts when everyone clicks Ready.";
	return (
		<div className={styles.lobby}>
			<div className={styles.card}>
				<h3 className={styles.title}>Players</h3>
				<ul className={styles.slots}>
					{Array.from({ length: seats }, (_, i) => {
						const p = room.players[i];
						if (!p) return (
							<li key={"e" + i} className={`${styles.slot} ${styles.empty}`}>
								<span className={styles.num}>{i + 1}</span>
								<span className={styles.open}>{canAddBot ? "Empty slot" : isOwner ? "Bot limit reached" : "Open slot"}</span>
								{canAddBot && <button className={`btn ${styles.add}`} type="button" onClick={() => socket.emit("add_bot")}>+ Add bot</button>}
							</li>
						);
						const tier = typeof p.rating === "number" ? tierFor(p.rating, p.provisional) : null;
						return (
							<li key={p.id} className={`${styles.slot} ${p.id === myId ? styles.me : ""}`}>
								<span className={styles.num}>{i + 1}</span>
								<div className={styles.main}>
									<div className={styles.name}>{p.name}{p.isOwner ? " ★" : ""}</div>
									<div className={styles.sub}>{p.isBot && !room.ranked && <span className={styles.botTag}>BOT</span>}{tier && <span style={{ color: tier.color }}>{tier.name}</span>}</div>
								</div>
								{p.isBot && canEdit && (
									<>
										<select className={styles.select} value={p.difficulty} onChange={(e) => socket.emit("set_bot_difficulty", { botId: p.id, difficulty: e.target.value })}>
											{(room.botDifficultyOptions || []).map(d => <option key={d} value={d}>{cap(d)}</option>)}
										</select>
										<button className={styles.remove} type="button" title="Remove bot" aria-label="Remove bot" onClick={() => socket.emit("remove_bot")}>×</button>
									</>
								)}
								<span className={`${styles.status} ${p.ready ? styles.ready : styles.waiting}`}>{p.ready ? "Ready" : "Waiting"}</span>
							</li>
						);
					})}
				</ul>
			</div>
			<div className={styles.card}>
				<h3 className={styles.title}>Series</h3>
				<Setting label="Format" edit={canEdit} value={formatSeriesFormat(room.gameCount, room.scoreTarget)} options={room.gameCountOptions} current={room.gameCount} fmt={(n) => String(n)} onChange={(v) => socket.emit("set_game_count", { count: Number(v) })} />
				<Setting label="Round time" edit={canEdit} value={formatRoundOption(room.roundSeconds)} options={room.roundSecondsOptions} current={room.roundSeconds} fmt={formatRoundOption} onChange={(v) => socket.emit("set_round_seconds", { seconds: Number(v) })} />
				<Setting label="Mine penalty" edit={canEdit} value={formatPenaltyOption(room.deathPenalty)} options={room.deathPenaltyOptions} current={room.deathPenalty} fmt={formatPenaltyOption} onChange={(v) => socket.emit("set_death_penalty", { seconds: Number(v) })} />
				<Setting label="Board" edit={canEdit} value={formatBoardSize(room.boardSize)} options={room.boardSizeOptions} current={room.boardSize} fmt={formatBoardSize} onChange={(v) => socket.emit("set_board_size", { size: v })} />
				<div className={styles.setting}>
					<span className={styles.settingLabel}>Mines</span>
					{canEdit ? <span className={styles.density}><input type="range" min={10} max={30} step={1} defaultValue={Math.round((room.mineDensity || 0.1) * 100)} onChange={(e) => socket.emit("set_mine_density", { density: Number(e.target.value) / 100 })} /><b>{formatMineDensity(room.mineDensity)}</b></span> : <span>{formatMineDensity(room.mineDensity)}</span>}
				</div>
				<div className={styles.setting}><span className={styles.settingLabel}>Modifier</span><span>{room.modifier === "noFlags" ? "No flags" : room.modifier === "onlyFlags" ? "Only flags" : "None"}</span></div>
				{room.gamesPlayed > 0 && <div className={styles.progress}>{formatGameProgress(Math.min(room.gamesPlayed + 1, room.gameCount), room.gameCount, room.scoreTarget)}</div>}
			</div>
			<div className={styles.readyBar}>
				<span className={styles.readyStatus}>{iAmReady ? "Waiting for others…" : status}</span>
				{!iAmReady && <button className="btn btn-primary" disabled={room.players.length < 2} onClick={() => socket.emit("ready")}>Ready</button>}
			</div>
		</div>
	);
}

function Setting<T extends string | number>({ label, edit, value, options, current, fmt, onChange }: { label: string; edit: boolean; value: string; options: T[]; current: T; fmt: (v: T) => string; onChange: (v: string) => void }) {
	return (
		<div className={styles.setting}>
			<span className={styles.settingLabel}>{label}</span>
			{edit && options ? <select className={styles.select} value={String(current)} onChange={(e) => onChange(e.target.value)}>{options.map(o => <option key={String(o)} value={String(o)}>{fmt(o)}</option>)}</select> : <span>{value}</span>}
		</div>
	);
}
