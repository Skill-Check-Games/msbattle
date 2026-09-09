// Top-rated players per ranked style. Rows link to that player's public profile.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getSocket, onSocket } from "../../online/socket";
import { useAuth } from "../../shared/auth";
import { tierFor } from "../../shared/ranking";
import { AvatarChip, FlagChip } from "../../shared/Avatar";
import styles from "./LeaderboardPage.module.scss";

interface Row { id?: number; name: string; rating: number; played: number; avatar_color?: string | null; country?: string | null; }
const MODES: Array<[string, string]> = [["sprint", "Sprint"], ["standard", "Standard"]];

export default function LeaderboardPage() {
	const { account } = useAuth();
	const navigate = useNavigate();
	const [mode, setMode] = useState("sprint");
	const [rows, setRows] = useState<Row[] | null>(null);
	const [provisional, setProvisional] = useState(5);
	useEffect(() => {
		setRows(null);
		const off = onSocket("leaderboard", (d) => { if (!d || (d.mode && d.mode !== mode)) return; if (d.provisionalGames) setProvisional(d.provisionalGames); setRows(d.players || []); });
		getSocket().emit("get_leaderboard", { mode });
		return off;
	}, [mode]);
	return (
		<section>
			<h1 className={styles.title}>Leaderboard</h1>
			<p className={styles.sub}>Top-rated players. Filter by mode.</p>
			<div className={styles.tabs} role="tablist">{MODES.map(([m, label]) => <button key={m} type="button" role="tab" className={`${styles.tab} ${m === mode ? styles.active : ""}`} onClick={() => setMode(m)}>{label}</button>)}</div>
			<div className={styles.card}>
				{rows === null ? <div className={styles.empty}>Loading…</div> : rows.length === 0 ? <div className={styles.empty}>No ranked players yet.</div> : (
					<ol className={styles.list}>
						{rows.map((p, i) => {
							const t = tierFor(p.rating, p.played < provisional);
							const me = account && p.name === account.name;
							const open = () => { if (p.id) navigate("/profile?id=" + p.id); };
							return (
								<li key={p.id ?? i} className={`${styles.row} ${me ? styles.me : ""} ${p.id ? styles.linked : ""}`} tabIndex={p.id ? 0 : -1} role={p.id ? "link" : undefined} onClick={open} onKeyDown={(e) => { if (e.key === "Enter") open(); }}>
									<span className={styles.rank}>{i + 1}</span>
									<AvatarChip avatar={p.avatar_color} country={p.country} px={52} className={styles.avatar} />
									<span className={styles.id}><span className={styles.name}>{p.name}<FlagChip country={p.country} px={16} /></span><span className={styles.tier} style={{ color: t.color }}>{t.name}</span></span>
									<span className={styles.rating}>{p.rating}</span>
								</li>
							);
						})}
					</ol>
				)}
			</div>
		</section>
	);
}
