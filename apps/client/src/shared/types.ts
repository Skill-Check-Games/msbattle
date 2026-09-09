// Payloads shared with apps/server (session.js buildAccountPayload and friends). Kept in one place;
// widen here when the server grows a field.

export interface Account {
	userId?: number;
	name: string;
	ratingSprint: number;
	ratingStandard: number;
	avatarUrl?: string | null;
	avatarColor: string | null;   // "#rrggbb" flag colour, "anon", "mine", or "img:<id>"
	country: string | null;       // ISO-3166 alpha-2
	wins: number;
	played: number;
	playedSprint: number;
	playedStandard: number;
	placementGames: number;
	createdAt?: string;
	provisional: boolean;
	puzzleRating: number;
	puzzlePoints: number;
	puzzlesSolved: number;
	puzzlesAttempted: number;
	streakBest: number;
	stormBest: number;
	dailyStreak: number;
	dailyAttempt: { solved: boolean; at: string } | null;
	isAdmin: boolean;
	guest: boolean;
	soloBests: Record<string, number>;
	provider?: string;
	ownedItems: string[];
	token?: string;               // only on a freshly minted guest session
}

export interface ProviderFlags { google?: boolean; discord?: boolean; dev?: boolean; }
