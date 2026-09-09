// Learn course catalogue. Ported verbatim from the legacy client's Learn.js (data only).
// Tokens in a board spec: mines/revealed/flagged/covered are [r,c] lists; revealStart cascades
// from one cell; revealAll opens every safe cell first. Mentor lessons have `steps`; the older
// prose format has idea/how/puzzles.
export interface BoardSpec {
	rows: number; cols: number; mines?: number[][]; revealed?: number[][]; flagged?: number[][]; covered?: number[][];
	revealStart?: number[]; revealAll?: boolean; xray?: boolean; skin?: string | null;
	chordOnly?: boolean; mustFlag?: boolean; clickMine?: boolean; guess?: boolean; goodGuessCells?: number[][];
	title?: string; why?: string; requirements?: { minCascades?: number; minChords?: number };
}
export interface DemoScene extends BoardSpec { clueCell?: number[]; targets?: number[][]; action?: "flag" | "reveal"; revealFrom?: number[]; }
export interface RuleSpec { label: string; desc: string; demos: DemoScene[]; }
export interface Step {
	board?: BoardSpec; requirements?: BoardSpec["requirements"]; guess?: boolean;
	intro?: string | string[]; hints?: string[]; mistakes?: { mine?: string; wrongFlag?: string }; outro?: string;
	rulesPanel?: { rules: RuleSpec[] };
}
export interface Lesson {
	title: string; steps?: Step[];
	idea?: string; how?: string; mistake?: string; guess?: boolean; demo?: BoardSpec | BoardSpec[]; puzzles?: BoardSpec[];
}
export interface Course { id: string; title: string; sub: string; lessons: Lesson[]; }

export const LEARN_COURSES: Course[] = [
{
	id: "basics",
	title: "How to play the game",
	sub: "How to play. Every move you can make.",
	lessons: [
	{
		title: "Revealing cells",
		steps: [
		{
			// One mine dead centre on a 5x5 board: a corner cascade (pre-applied here via revealStart,
			// so the player isn't asked to find/click it themselves) opens the ENTIRE rest of the board
			// in one go (verified: leaves only the mine covered), so this one board demonstrates both
			// a cascade AND a mine without the player needing to do anything but look, then click the
			// one cell left. Deliberately backwards on the mine itself: before explaining "avoid
			// mines," let the player click it on purpose, risk-free, so "mine" is a concrete thing
			// they've seen rather than an abstract warning. Reused (see the "Flagging cells" lesson
			// below) with the objective swapped to mustFlag instead of clickMine: same board, same
			// cascade, the new skill applied to it.
			board: { rows: 5, cols: 5, mines: [[2,2]], revealStart: [0,0], clickMine: true },
			intro: [
				"Left-click the cell to see what's inside."
			],
			outro: "That's a mine. Hit one in a real game and it's over. Now let's reveal a cell for real."
		},
		{
			// Moved here from "Simple deductions": it's the same core skill (left-click to reveal)
			// as this lesson's first puzzle, just requiring one read of the numbers instead of a
			// free pass. Mine sits one cell in from a corner: a real cascade from elsewhere opens
			// everything except the mine and the one cell diagonally past it, which never gets an
			// automatic 0-neighbour of its own. Cleared normally: reveal the safe cell, mine stays covered.
			board: { rows: 7, cols: 9, mines: [[1,2]], revealStart: [6,8] },
			intro: [
				"A number counts the mines touching it. One cell here is safe: find it."
			],
			hints: [
				"The '1' below-left of the mine touches only one covered cell: that's the mine.",
				"The '1' above-right of it is already satisfied by that same mine.",
				"So its other covered neighbour is safe. Click it."
			],
			mistakes: {
				mine: "That was the mine. Check the '1's again."
			},
			outro: "That's reading the board: no guessing."
		}
		]
	},
	{
		title: "Flagging cells",
		steps: [
		{
			// Same 5x5 board as "Revealing cells": the cascade is already applied (revealStart)
			// since that lesson already covered clicking a corner to open it; here the only thing
			// left to do is flag the one covered cell instead of clicking it.
			board: { rows: 5, cols: 5, mines: [[2,2]], revealStart: [0,0], mustFlag: true },
			intro: [
				"Right-click a cell to flag it. Right-click again to unflag."
			],
			outro: "Flagged. One mine's easy: let's try a few more."
		},
		{
			// Two separate groups (a 2-mine pair, a 3-mine L-tromino), spaced far enough apart that
			// each mine still gets its own exclusive '1': no chaining needed, just more of them to
			// find. Real cascade from a corner opens everything except the five mines themselves.
			board: {
				rows: 6, cols: 11,
				mines: [[2,2], [2,3], [2,7], [2,8], [3,7]],
				revealStart: [5,0],
				mustFlag: true
			},
			intro: [ "Five mines this time: two groups. Flag every one." ],
			hints: [
				"The pair on the left each have their own '1': find both.",
				"The three on the right work the same way, one '1' per mine.",
				"Flag all five once every mine is pinned."
			],
			mistakes: {
				wrongFlag: "Not a mine: check the numbers around it."
			},
			outro: "In a real game, flagging is optional: nothing forces you to place one. But it's a great tool for keeping track of what you've already worked out."
		}
		]
	},
	{
		title: "Simple deductions",
		steps: [
		{
			// A single mine a full step diagonally off the corner instead of straight off an edge —
			// its 8-neighbourhood now traps THREE cells with no 0-neighbour of their own, not one:
			// the two cells flanking it, and the true corner beyond them, freed only once one
			// flanking cell is revealed and its own (now-satisfied) number frees the next.
			board: { rows: 6, cols: 9, mines: [[1,1]], revealStart: [5,8] },
			intro: [ "This mine sits one step off the corner instead of the edge: three safe cells to find, not one." ],
			hints: [
				"The '1' past the mine, away from the corner, touches only one covered cell: that's the mine.",
				"That satisfies the numbers next to it: the two cells flanking the mine are safe.",
				"Reveal those, and their own numbers free the last cell, right in the corner."
			],
			mistakes: {
				mine: "That was the mine. Check the '1's again."
			},
			outro: "Read a number, chase it to the next one: that's all deduction ever is."
		},
		{
			// Two mines side by side, flush against the top wall and one cell in from the corner —
			// the classic 1-2-2-1 wall run. The far '2' touches only the two mines and forces both at
			// once; the near '1' is then already satisfied, freeing the corner cell.
			board: { rows: 6, cols: 9, mines: [[0,1], [0,2]], revealStart: [5,8] },
			intro: [ "Two mines side by side against the wall. Which cell is safe?" ],
			hints: [
				"The second '2' (away from the corner) touches only the two mines and nothing else: both are forced.",
				"Once both mines are known, the '1' nearest the corner is already satisfied.",
				"That leaves the corner cell safe. Click it."
			],
			mistakes: {
				mine: "That was a mine. Check the numbers along the wall again."
			},
			outro: "The classic 1-2-2-1 wall pattern: two mines confirmed from one number, the corner falls out."
		},
		{
			// Adapted from the real puzzle pool (id 100), shifted one cell so the true corner (3,3)
			// is safe rather than a mine. The '2' pins both mines in one read; the corner itself only
			// has covered/mine neighbours to start, so it isn't freed until the cell beside it is
			// revealed and contributes its own (now-satisfied) number: a real two-hop chain.
			board: {
				rows: 4, cols: 4,
				mines: [[2,2], [3,2]],
				revealed: [[0,0],[0,1],[0,2],[0,3],[1,0],[1,1],[1,2],[1,3],[2,0],[2,1],[3,0],[3,1]]
			},
			intro: [ "Same two-mine idea, but tucked into a corner this time. Find both safe cells." ],
			hints: [
				"A '2' touches both covered cells next to it: exactly its count, so both are mines.",
				"The 1s beside them are already satisfied by those two mines: the third covered cell is safe.",
				"Click it: revealing it uncovers its own number, which frees the last cell in the corner."
			],
			mistakes: {
				mine: "That was a mine. Check the 1s around it again."
			},
			outro: "Same trick, two mines and two safe cells this time."
		},
		{
			// Real puzzle pool, id 52: plus one extra mine added at the bottom-left corner (4,0),
			// paired with the pool's original lone mine at (3,1); and the board widened by one
			// column with the bottom-right mine shifted from (4,6) to (4,7), opening a one-cell gap
			// at (4,6) that no cascade can reach (all three of its neighbours border a mine). Reading
			// the row above that gap: 1-1-2-1: each mine pinned by its own exclusive '1', then the
			// '2' between them (now satisfied by both) frees the gap cell itself.
			board: {
				rows: 5, cols: 8,
				mines: [[0,4], [3,1], [4,0], [4,5], [4,7]],
				revealed: [[0,0],[0,1],[0,2],[0,3],[0,5],[0,6],[0,7],[1,0],[1,1],[1,2],[1,3],[1,4],[1,5],[1,6],[1,7],
					[2,0],[2,1],[2,2],[2,3],[2,4],[2,5],[2,6],[2,7],[3,2],[3,3],[3,4],[3,5],[3,6],[3,7],[4,2],[4,3],[4,4]]
			},
			intro: [ "Five mines scattered around the board. Find the safe cells." ],
			hints: [
				"Treat each cluster on its own: the lone mine at the top pins the same way as always.",
				"The corner pair in the bottom-left, and each mine in the bottom-right pair, still get their own exclusive '1'.",
				"Once both bottom-right mines are pinned, the '2' between them is satisfied: the gap cell is safe."
			],
			mistakes: {
				mine: "That was a mine. Check the numbers around it again."
			},
			outro: "That's the toolkit: read a number, work out what's forced. One more board to go."
		},
		{
			// Real puzzle pool, id 41: three mines run along the left edge, an L rather than a chain,
			// with three safe cells clustered in the corner they leave behind.
			board: {
				rows: 4, cols: 4,
				mines: [[0,0], [1,0], [2,1]],
				revealed: [[0,1],[0,2],[0,3],[1,1],[1,2],[1,3],[2,2],[2,3],[3,2],[3,3]]
			},
			intro: [ "Three mines along the edge this time. Find all three safe cells." ],
			hints: [
				"The '2' at the top touches two covered cells: exactly its count, so both are mines.",
				"The '1' next to it has only one covered cell left uncovered by those two: that's the third mine.",
				"With all three pinned, the numbers below them are already satisfied: those cells are safe."
			],
			mistakes: {
				mine: "That was a mine. Check the numbers around it again."
			},
			outro: "Same idea, just more numbers to read before it clicks."
		}
		]
	},
	{
		title: "Chord clicks",
		steps: [
		{
			board: {
				rows: 3,
				cols: 9,
				mines: [[0,1], [0,4], [0,7], [1,3], [1,6], [1,8]],
				flagged: [[0,1], [0,4], [0,7], [1,3], [1,6], [1,8]],
				revealed: [[1,1], [1,4], [1,7]],
				chordOnly: true
			},
			intro: [
				"Click a satisfied number to chord: it opens all its other neighbours at once."
			],
			hints: [
				"Click the number itself, not a covered cell.",
				"Left- or right-click both work.",
				"Chord each of the three numbers in the middle row."
			],
			outro: "Chording: the fastest way to open cells you've already worked out."
		}
		]
	}
	]
},
{
	id: "simple",
	title: "Simple moves",
	sub: "Two rules, and how far they take you.",
	lessons: [
	{
		title: "The two rules",
		steps: [
		{
			// A pure reference step, no puzzle to solve: see the rulesPanel branch in loadStep.
			// Lesson has just this one step: watch the two rules happen, then go practice them for
			// real on the first puzzle of the next lesson.
			intro: [
				"Just two rules solve almost every board. Watch them below, then try them yourself."
			],
			rulesPanel: {
				rules: [
					{
						label: "Rule #1",
						desc: "Find a cell that only has mines left around it, and flag them all.",
						demos: [
							{
								// Two covered cells tucked in the top-right corner: one size up from
								// the smallest possible case, sitting at the top of a much larger
								// cascaded board (same size as Rule #2's demos) so it reads as one
								// corner of a real board rather than a bare scrap.
								rows: 4, cols: 6,
								mines: [[0,4], [0,5]],
								revealed: [[0,0],[0,1],[0,2],[0,3],[1,0],[1,1],[1,2],[1,3],[1,4],[1,5],
									[2,0],[2,1],[2,2],[2,3],[2,4],[2,5],[3,0],[3,1],[3,2],[3,3],[3,4],[3,5]],
								clueCell: [1,4],
								targets: [[0,4], [0,5]],
								action: "flag"
							},
							{
								// A '3' with exactly three covered cells beneath it, grown to an
								// L of four mines: three across the top plus one more hanging down
								// from the right end: with a single clue cell still touching all
								// four (a straight run of four is one mine too wide for any one
								// clue to reach every cell, so the extra mine has to turn a corner).
								rows: 4, cols: 6,
								mines: [[0,1], [0,2], [0,3], [1,3]],
								revealed: [[0,0],[0,4],[0,5],[1,0],[1,1],[1,2],[1,4],[1,5],
									[2,0],[2,1],[2,2],[2,3],[2,4],[2,5],[3,0],[3,1],[3,2],[3,3],[3,4],[3,5]],
								clueCell: [1,2],
								targets: [[0,1], [0,2], [0,3], [1,3]],
								action: "flag"
							},
							{
								// A '2' on the left edge, grown to three mines: same idea, one size
								// up, and this time bordering the side of the board instead of the
								// top. The clue cell sits one column in rather than flush against the
								// edge, since it needs to reach all three mines, not just two. Not
								// every covered cell on this board is a mine, though: a fourth mine
								// sits unflagged at (2,4), invisible until some other clue explains
								// it, and (3,4) right next to it is genuinely safe: neither one is
								// reachable from the highlighted clue, so this demo doesn't touch them.
								rows: 4, cols: 6,
								mines: [[0,0], [0,1], [0,2], [2,4]],
								revealed: [[0,3],[0,4],[0,5],[1,0],[1,1],[1,2],[1,3],[1,4],[1,5],
									[2,0],[2,1],[2,2],[2,3],[2,5],[3,0],[3,1],[3,2],[3,3],[3,5]],
								clueCell: [1,1],
								targets: [[0,0], [0,1], [0,2]],
								action: "flag"
							},
							{
								// Four mines running down the right edge, but the highlighted clue is
								// the '1' below all of them: it only touches the bottom mine, so only
								// that one gets flagged here. The other three stay covered the whole
								// time: a reminder that a clue only tells you about its own immediate
								// neighbours, not about a whole cluster sitting nearby. Two of those
								// three really are mines (one more sits unflagged at (1,3), shielding
								// the board's left side from a cascade); the third, (1,5), is genuinely
								// safe: from the outside the three look identical.
								rows: 4, cols: 6,
								mines: [[0,4], [0,5], [1,3], [2,5]],
								revealed: [[0,0],[0,1],[0,2],[0,3],[1,0],[1,1],[1,2],[1,4],
									[2,0],[2,1],[2,2],[2,3],[2,4],[3,0],[3,1],[3,2],[3,3],[3,4],[3,5]],
								clueCell: [3,5],
								targets: [[2,5]],
								action: "flag"
							}
						]
					},
					{
						label: "Rule #2",
						desc: "Find a cell that already has all its mines flagged, and reveal all its other cells.",
						demos: [
							{
								// Three covered cells in a row, mine on the right: the '1' beyond it
								// touches only that one covered cell, so it's flagged by simple count-
								// matching (rule #1): no elimination needed. That satisfies the '1'
								// below the row, freeing (0,0): which is itself a '0', so revealing
								// it really is a cascade (revealFrom, not a hand-picked targets list):
								// it opens (0,1) and (1,0) too, and (1,0) being also '0' carries it one
								// step further into (2,0), which is where the actual cascade algorithm
								// stops, since that cell is nonzero. The entire left column stays
								// covered until then. A second, unflagged mine tucked in the
								// bottom-left corner is what lets the rest of the board cascade open
								// around it without that same cascade reaching in and prematurely
								// revealing the covered cells above it.
								rows: 4, cols: 6,
								mines: [[0,2], [3,0]],
								flagged: [[0,2]],
								revealed: [[0,3],[0,4],[0,5],[1,1],[1,2],[1,3],[1,4],[1,5],
									[2,1],[2,2],[2,3],[2,4],[2,5],
									[3,1],[3,2],[3,3],[3,4],[3,5]],
								clueCell: [1,1],
								revealFrom: [0,0],
								action: "reveal"
							},
							{
								// Top row: four covered cells (two mines, a target, then a third
								// mine), then a revealed '1' and an empty cell. The '2' below the
								// pair forces them, the '1' below the lone mine forces it too: once
								// all three are flagged, the '2' between them is satisfied and frees
								// the target sitting right in the middle of the row.
								rows: 4, cols: 6,
								mines: [[0,0], [0,1], [0,3]],
								flagged: [[0,0], [0,1], [0,3]],
								revealed: [[0,4],[0,5],
									[1,0],[1,1],[1,2],[1,3],[1,4],[1,5],
									[2,0],[2,1],[2,2],[2,3],[2,4],[2,5],
									[3,0],[3,1],[3,2],[3,3],[3,4],[3,5]],
								clueCell: [1,2],
								targets: [[0,2]],
								action: "reveal"
							},
							{
								// Same idea, two mines this time and two cells freed at once. Each
								// mine is independently provable too: a different '1' elsewhere
								// touches only one of them apiece: so nothing here is just asserted.
								rows: 4, cols: 6,
								mines: [[0,2], [1,0]],
								flagged: [[0,2], [1,0]],
								revealed: [[0,3],[0,4],[0,5],[1,1],[1,2],[1,3],[1,4],[1,5],
									[2,0],[2,1],[2,2],[2,3],[2,4],[2,5],[3,0],[3,1],[3,2],[3,3],[3,4],[3,5]],
								clueCell: [1,1],
								targets: [[0,0], [0,1]],
								action: "reveal"
							}
						]
					}
				]
			}
		}
		]
	},
	{
		title: "Row by row",
		steps: [
		{
			// A real cascade (revealStart) opens two clean rows above the border, like a real
			// opening would, before the mines start: instead of the clue row sitting right at the
			// board's top edge. Mines split across BOTH covered rows (not just the first), since a
			// real board never leaves a whole row guaranteed mine-free.
			board: { rows: 5, cols: 5, mines: [[3,3], [3,4], [4,0]], revealStart: [0,0] },
			intro: [
				"Start from a corner when you can: fewer neighbours means its number is easiest to trust completely."
			],
			hints: [
				"Work along the border row first: each number either matches its covered neighbours (flag) or is already satisfied (reveal).",
				"Once the first covered row is sorted, its own numbers are enough to explain the row behind it too."
			],
			mistakes: {
				mine: "That was a mine. Go back to a number that's fully explained by its flagged neighbours, and work outward from there."
			},
			outro: "Same two rules, twice: once to clear the first row, once more for the row behind it: mines and all, in both."
		},
		{
			// Wider, more mines, still split across both covered rows.
			board: {
				rows: 5, cols: 6,
				mines: [[3,1], [3,3], [4,2], [4,3]],
				revealStart: [0,0]
			},
			intro: [ "Wider now: and this time the second row isn't a free pass either." ],
			hints: [
				"Start at a number that already matches its covered neighbours exactly.",
				"Work across one number at a time. Nothing here needs more than the two rules."
			],
			mistakes: {
				mine: "That was a mine. Find a number that's fully explained already, and work outward from it."
			},
			outro: "Same idea, just more of it: the two rules don't care how wide the board is, or which row the mines are in."
		},
		{
			// Wider still, mines in both rows again, one board hugging the right edge.
			board: {
				rows: 5, cols: 7,
				mines: [[3,6], [4,0], [4,1], [4,3], [4,6]],
				revealStart: [0,0]
			},
			intro: [ "Wider again. Same two rules, just more of the board to work through." ],
			hints: [
				"Same start as always: a number that matches its covered neighbours exactly.",
				"Work across one number at a time: flag what matches, reveal what's satisfied."
			],
			mistakes: {
				mine: "That was a mine. Find what's already explained, and work outward from it."
			},
			outro: "That's row by row: work the first covered row with the two rules, and the row behind it falls out the same way."
		},
		{
			// Widest and busiest of the set: six mines split across both rows, 11 forced moves.
			board: {
				rows: 5, cols: 8,
				mines: [[3,0], [3,2], [3,3], [3,4], [4,0], [4,5]],
				revealStart: [0,0]
			},
			intro: [
				"The widest one yet. Same two rules: just more of them to chain together.",
				"If you get stuck in one section of the board, move over and look for opportunities somewhere else."
			],
			hints: [
				"Start from a number that already matches its covered neighbours exactly.",
				"Work across the row one number at a time. Every mine here, top row or bottom, comes from the same two rules."
			],
			mistakes: {
				mine: "That was a mine. Eight columns or five, the method's the same: find what's already explained and work outward."
			},
			outro: "That's the whole lesson: reveal what you can, and the rest reveals itself, row after row."
		}
		]
	},
	{
		title: "Clearing a whole board",
		steps: [
		{
			// Real puzzle pool, id 67: a genuine two-dimensional board (not just rows stacked on
			// rows), so the same two rules now have to be found in any direction, not just left to
			// right. Kept from the original version of this course.
			board: {
				rows: 6, cols: 5,
				mines: [[0,3], [3,4], [4,1], [5,4]],
				revealed: [[0,0],[0,1],[0,2],[1,0],[1,1],[1,2],[1,3],[2,0],[2,1],[2,2],[2,3],[3,0],[3,1],[3,2],[3,3]]
			},
			intro: [ "One more board: a real one, not just rows stacked on rows. Same two rules, any direction." ],
			hints: [
				"If a number's covered cells don't resolve yet, leave it: try a different number first.",
				"There's no required order. Work whichever number is easiest right now."
			],
			mistakes: {
				mine: "That was a mine. Check a number you haven't tried yet."
			},
			outro: "That's a real two-dimensional board cleared: the rest of this lesson just makes them bigger."
		},
		{
			// Real puzzle pool, id 163: one mine more than the last board, still fully clearable
			// with only the two rules (verified by simulating trivial-only flag/reveal to
			// completion before wiring it in).
			board: {
				rows: 6, cols: 5,
				mines: [[2,0], [2,4], [3,1], [4,0], [5,4]],
				revealed: [[0,0],[0,1],[0,2],[0,3],[0,4],[1,0],[1,1],[1,2],[1,3],[1,4],[2,1],[2,2],[2,3]]
			},
			intro: [ "Bigger now: five mines instead of four, spread across more of the board." ],
			hints: [
				"Same approach: find a number whose covered cells already match its count, or one whose mines are already flagged.",
				"Work outward from whichever number is easiest, in any direction."
			],
			mistakes: {
				mine: "That was a mine. Look for a number that's already fully explained, and work outward from it."
			},
			outro: "Same two rules, just more of the board: size doesn't change the method."
		},
		{
			// Real puzzle pool, id 195: wider still, six mines spread across the full width of
			// the board. Also verified fully trivial-solvable before wiring it in.
			board: {
				rows: 6, cols: 8,
				mines: [[2,3], [2,7], [3,3], [3,7], [4,5], [5,7]],
				revealed: [[0,0],[0,1],[0,2],[0,3],[0,4],[0,5],[0,6],[0,7],[1,0],[1,1],[1,2],[1,3],[1,4],[1,5],[1,6],[1,7],
					[2,0],[2,1],[2,2],[2,4],[2,5],[2,6],[3,0],[3,1],[3,2],[3,4],[3,5],[3,6],
					[4,0],[4,1],[4,2],[4,3],[4,4],[5,0],[5,1],[5,2],[5,3],[5,4]]
			},
			intro: [ "Wider still, and the mines are spread across the whole width of the board." ],
			hints: [
				"Nothing new here: just more numbers to work through with the same two rules.",
				"If one area stalls, move to another part of the board and come back to it after."
			],
			mistakes: {
				mine: "That was a mine. Move to a number you haven't worked yet, and come back to this area after."
			},
			outro: "Same two rules cover a board this size just as easily as a small one."
		},
		{
			// Real puzzle pool, id 88: the biggest and busiest board in the course, 7x7 with six
			// mines. Still fully trivial-solvable (verified the same way as the other three), so
			// even at this size, nothing here needs more than the two rules.
			board: {
				rows: 7, cols: 7,
				mines: [[0,0], [2,1], [2,5], [4,1], [5,6], [6,4]],
				revealed: [[0,1],[0,2],[0,3],[0,4],[0,5],[0,6],[1,1],[1,2],[1,3],[1,4],[1,5],[1,6],
					[2,2],[2,3],[2,4],[3,2],[3,3],[3,4],[3,5],[4,2],[4,3],[4,4],[4,5],[5,2],[5,3],[5,4],[5,5]]
			},
			intro: [ "The biggest board yet: six mines, no shortcuts, still just the two rules." ],
			hints: [
				"Work through it the same way as every board before this one: match the count to flag, satisfy the count to reveal.",
				"There's no trick here: just more of the board to cover."
			],
			mistakes: {
				mine: "That was a mine. Every mine on this board is findable with the two rules: check what's already explained."
			},
			outro: "That's the whole course: two simple rules, patiently applied, clear a board of any size."
		}
		]
	}
	]
},
{
	id: "intermediate",
	title: "Intermediate moves",
	sub: "When one number isn't enough, compare two.",
	lessons: [
	{
		title: "Nested numbers: safe cells",
		steps: [
		{
			// Real puzzle pool, id 134: the cleanest possible nested pair: two mines at the ends
			// of a row of four covered cells, under four "1"s. The rightmost 1 reaches two covered
			// cells; the one beside it reaches those same two, plus one more. Same mine count (1
			// each), so the extra cell the bigger one alone reaches has to be safe.
			board: {
				rows: 5, cols: 4,
				mines: [[1,0], [1,3]],
				revealed: [[2,0],[2,1],[2,2],[2,3],[3,0],[3,1],[3,2],[3,3],[4,0],[4,1],[4,2],[4,3]]
			},
			intro: [
				"New trick: comparing two numbers side by side, not just reading one alone.",
				"Look at the two rightmost 1s in that row of four covered cells."
			],
			hints: [
				"The rightmost '1' only touches two covered cells. The one beside it touches those same two, plus one more.",
				"Both need exactly one mine. The smaller one already accounts for it: so the extra cell the bigger one alone reaches must be safe.",
				"That's the second cell from the left in the covered row. Click it."
			],
			mistakes: {
				mine: "That was a mine. Compare the two 1s again: one of them reaches one extra cell the other doesn't."
			},
			outro: "That's a nested pair: one number's reach sits entirely inside another's. Same mine count, so the extra reach is safe."
		}
		]
	},
	{
		title: "Nested numbers: forced mines",
		steps: [
		{
			// Real puzzle pool, id 81: same nested idea, flipped: the bigger number here needs
			// MORE mines than the smaller one, by exactly its one extra cell.
			board: {
				rows: 4, cols: 4,
				mines: [[1,3], [2,3]],
				revealed: [[0,0],[0,1],[0,2],[1,0],[1,1],[1,2],[2,0],[2,1],[2,2],[3,0],[3,1],[3,2]]
			},
			intro: [ "Same trick, flipped: this time the bigger number needs MORE mines than the smaller one." ],
			hints: [
				"The '1' near the bottom of that column touches two covered cells. The '2' just above it touches those same two, plus one more.",
				"The '2' needs one more mine than the '1': and it only has one extra cell to put it in.",
				"That extra cell has to be a mine."
			],
			mistakes: {
				mine: "That was a mine. Compare the numbers again: the '2' already told you which extra cell had to be the mine."
			},
			outro: "Same trick, opposite outcome: when the bigger number needs more mines than the smaller one, its extra cells are forced mines."
		}
		]
	},
	{
		title: "Comparing numbers twice",
		steps: [
		{
			// Real puzzle pool, id 193: one nested-pair comparison forces a mine; that changes what
			// a DIFFERENT pair of numbers can tell you, and a second comparison is needed before the
			// rest falls out trivially. The point: one comparison often isn't the end of it.
			board: {
				rows: 4, cols: 4,
				mines: [[1,3], [2,0], [2,2]],
				revealed: [[0,0],[0,1],[0,2],[1,0],[1,1],[1,2]]
			},
			intro: [ "Sometimes one comparison isn't enough: a second pair of numbers needs comparing too." ],
			hints: [
				"Start with the '1' and the '2' that share two covered cells: the '2' needs one more mine, and it only has one extra cell.",
				"Once that mine is placed, re-read the numbers around it: a different pair is now ready to compare.",
				"Keep comparing pairs as you go. Solving one often sets up the next."
			],
			mistakes: {
				mine: "That was a mine. Go back to comparing numbers in pairs: there's always another pair ready to compare."
			},
			outro: "That's the real skill: not just spotting one nested pair, but re-comparing as new numbers turn up."
		}
		]
	},
	{
		title: "Clearing harder boards",
		steps: [
		{
			// Real puzzle pool, id 150: a full small-board clear mixing trivial reads with nested
			// comparisons, instead of one isolated pattern. Same idea as Simple moves' capstone, one
			// tier harder.
			board: {
				rows: 4, cols: 4,
				mines: [[0,1], [1,0], [2,3]],
				revealed: [[2,0],[2,1],[2,2],[3,0],[3,1],[3,2]]
			},
			intro: [ "Now put it together: clear a whole board, comparing numbers wherever one read isn't enough." ],
			hints: [
				"Start with the plain reads first: they'll open up more of the board.",
				"When a number alone doesn't resolve, look for a second number whose reach overlaps or nests inside it."
			],
			mistakes: {
				mine: "That was a mine. Somewhere else on the board a number: or a nested pair: is ready to read."
			},
			outro: "Trivial reads and nested comparisons, chained together. That's the toolkit so far."
		},
		{
			// Real puzzle pool, id 65: bigger board, three separate nested comparisons instead of
			// one, each in its own area.
			board: {
				rows: 5, cols: 6,
				mines: [[0,0], [0,4], [3,1], [3,3], [4,4]],
				revealed: [[0,1],[0,2],[0,3],[1,1],[1,2],[1,3],[2,1],[2,2],[2,3]]
			},
			intro: [ "Bigger board, same idea. Three separate nested comparisons this time." ],
			hints: [
				"Work each side of the board on its own: the comparisons don't depend on each other.",
				"If a number's covered cells don't resolve alone, find the number next to it that shares them."
			],
			mistakes: {
				mine: "That was a mine. Try a different number: the board has more than one place to compare from."
			},
			outro: "Same reading, more of it: and more places where two numbers had to work together."
		},
		{
			// Real puzzle pool, id 155: wider board still; most of it opens with plain trivial reads
			// before the nested comparisons show up deeper in.
			board: {
				rows: 6, cols: 6,
				mines: [[1,0], [1,2], [1,5], [2,2], [3,4], [4,2]],
				revealed: [[2,0],[2,1],[3,0],[3,1],[4,0],[4,1],[5,0],[5,1]]
			},
			intro: [ "A wider board now. Most of it opens up before you even need to compare two numbers." ],
			hints: [
				"Clear the trivial reads first, working down the left side.",
				"The nested comparisons show up once you're deeper into the board: keep an eye out for them."
			],
			mistakes: {
				mine: "That was a mine. Check the numbers you haven't read yet before comparing pairs."
			},
			outro: "Bigger, but the same two tools: read a number, or compare two of them."
		},
		{
			// Real puzzle pool, id 84: the biggest board in the course, and the most nested
			// comparisons needed in a row (four).
			board: {
				rows: 6, cols: 7,
				mines: [[0,3], [1,1], [1,6], [2,3], [4,2], [4,3]],
				revealed: [[2,4],[2,5],[2,6],[3,4],[3,5],[3,6],[4,4],[4,5],[4,6],[5,4],[5,5],[5,6]]
			},
			intro: [ "The biggest board in this course: and the most nested comparisons you'll need in a row." ],
			hints: [
				"Work in from both sides: one cluster of numbers is forming on the right, another on the left.",
				"Whenever you get stuck, look for two numbers sharing covered cells: one of them almost always resolves the other."
			],
			mistakes: {
				mine: "That was a mine. Somewhere else on the board, a number or a nested pair is still ready to go."
			},
			outro: "That's Intermediate moves: read what's forced, compare what isn't, and the board opens up."
		}
		]
	}
	]
},
{
	id: "speed",
	title: "Speed solving",
	sub: "Finish boards faster with fewer clicks.",
	lessons: [
	{
		title: "Smart guessing",
		idea: "When forced to guess, pick the group with the lowest per-cell mine probability.",
		how: "Risk per cell ≈ mines ÷ candidates. A 1 over 3 cells (33%) beats a 1 over 2 cells (50%).",
		guess: true,
		puzzles: [
			{
				title: "Two cells vs three",
				rows: 3,
				cols: 5,
				mines: [[0,0], [0,1]],
				revealAll: true,
				covered: [[0,2], [0,3], [0,4]],
				goodGuessCells: [[0,2], [0,3], [0,4]],
				guess: true,
				why: "Left 1 over two cells → 1/2 each. Right 1 over three cells → 1/3 each. Guess in the right group."
			},
			{
				title: "Watch the number",
				rows: 3,
				cols: 5,
				mines: [[0,2], [0,3], [0,4]],
				revealAll: true,
				covered: [[0,0], [0,1]],
				goodGuessCells: [[0,0], [0,1]],
				guess: true,
				why: "Left 1 over two cells → 1/2 each. Right 2 over three cells → 2/3 each. This time the left group is safer."
			}
		]
	}
	]
}
];
