// Data the home dashboard needs beyond the account payload: recent match history (for the stat
// strip) and today's daily puzzle status (board, streak, attempt).
import { useEffect, useState } from "react";
import { getSocket, onSocket } from "../../online/socket";
import type { Account } from "../../shared/types";

export interface MatchRow { won: number; rating_before: number; rating_after: number; created_at: number; style?: string; placement?: number; players?: number; opponent?: string | null; replay_id?: number | null; }

export function useMatchHistory(account: Account | null): MatchRow[] | null {
	const [matches, setMatches] = useState<MatchRow[] | null>(null);
	useEffect(() => {
		if (!account) return;
		const off = onSocket("match_history", (data) => setMatches((data && data.matches) || []));
		getSocket().emit("get_match_history");
		return off;
	}, [account && account.name, account && account.played]);
	return matches;
}

export interface DailyStatus { streak: number; bestStreak: number; attempt: { solved: boolean; at?: string } | null; board: { rows: number; cols: number; mines: number[][]; revealed: number[][] } | null; date: string | null; }

export function useDailyStatus(account: Account | null): DailyStatus | null {
	const [daily, setDaily] = useState<DailyStatus | null>(null);
	useEffect(() => {
		if (!account) return;
		const off = onSocket("puzzle_daily_status", (d) => setDaily({ streak: d.streak || 0, bestStreak: d.bestStreak || 0, attempt: d.attempt || null, board: d.board || null, date: d.date || null }));
		getSocket().emit("puzzle_daily_status");
		return off;
	}, [account && account.name]);
	return daily;
}

// The stat strip: today's session if there are matches today, else the last day played (greyed),
// else nothing. The win streak is the run of wins at the head of the list.
export interface SessionStats { isToday: boolean; played: number; winRate: number; streak: number; gain: number; }
export function sessionStats(matches: MatchRow[]): SessionStats | null {
	if (!matches.length) return null;
	const dayStart = (ts: number) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
	const today = dayStart(Date.now());
	const day = matches[0].created_at >= today ? today : dayStart(matches[0].created_at);
	let n = 0, wins = 0, gain = 0;
	for (const m of matches) if (dayStart(m.created_at) === day) { n++; if (m.won) wins++; gain += (m.rating_after || 0) - (m.rating_before || 0); }
	let streak = 0;
	for (const m of matches) { if (m.won) streak++; else break; }
	return { isToday: day === today, played: n, winRate: Math.round(wins / n * 100), streak, gain };
}

// "2026-08-18" -> "Aug 18", parsed as UTC so it cannot drift a day around midnight.
export function formatDailyDate(isoDate: string): string {
	const parts = isoDate.split("-");
	if (parts.length !== 3) return isoDate;
	const d = new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2]));
	if (isNaN(d.getTime())) return isoDate;
	return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
