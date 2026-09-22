// Marketing HQ content (/admin/marketing): the story, the copy library, the video storyboards and the channel
// plan. Plain data, kept apart from the page so the words can be edited without touching the tooling.

export const SITE = "https://msbattle.net";

// ---- the story: what we say, to whom, and why it lands ----
export const ONE_LINERS = [
	"Minesweeper, but it's a race.",
	"The Minesweeper you remember. Against real people. Live.",
	"Real-time competitive Minesweeper. No guessing, just reading and speed.",
	"Same board, two players, one winner.",
	"You never had to guess. You just never had an opponent."
];

export const PILLARS: { title: string; hook: string; proof: string }[] = [
	{ title: "Live races", hook: "Two players, or six, on the same board at the same time. First to clear it wins.", proof: "1v1 duels and 6-player fields, a shared no-guess layout every round, best-of series with a live opponent board next to yours." },
	{ title: "Never guess", hook: "Every board is solvable by logic alone. Losing is on you, never on the dice.", proof: "A no-guess generator and a real solver behind every layout; the centre is pre-revealed so the race starts at once." },
	{ title: "The ladder", hook: "Bronze to Master, one Elo per style. Your rank means something.", proof: "Placement matches, pairwise Elo with win-streak multipliers, Sprint and Standard ladders, a public leaderboard." },
	{ title: "Puzzles every day", hook: "A daily puzzle, rated positions, streaks and a storm mode for when you have five minutes.", proof: "Thousands of solver-rated deduction puzzles, a monotonic Puzzle Ladder, streaks that pay like ranked wins." },
	{ title: "Make it yours", hook: "Board skins, avatars and reveal effects. Your board, your look, opponents see it too.", proof: "Seven skins, five avatar presets, five reveal effects, all rendered live on the canvas." }
];

export const AUDIENCES: { who: string; where: string; angle: string }[] = [
	{ who: "The nostalgia crowd", where: "Reddit (r/nostalgia, r/gaming), X, LinkedIn of all places, office Slack channels", angle: "Then vs Now. The game you played in 1998 between spreadsheets, now with an opponent. Lead with the Windows 3.1 image." },
	{ who: "The Minesweeper community", where: "r/Minesweeper, minesweeper.online forums, the Authoritative Minesweeper site, speedrun Discords", angle: "Respect first. They are the experts; the pitch is no-guess boards and live races, never 'we fixed Minesweeper'. Ask for feedback, share the solver story." },
	{ who: "Daily puzzle people", where: "r/puzzles, Wordle and Sudoku communities, puzzle newsletters, Mastodon", angle: "The daily puzzle and the streak. One position a day, rated, shareable. The ladder as the long game." },
	{ who: "Competitive browser gamers", where: "r/WebGames, tetr.io and chess.com crowds, Discord servers, itch.io", angle: "It has a ranked ladder and Elo. Show the 6-player start grid and the VS banner; this is an esport-shaped thing." },
	{ who: "Streamers and YouTubers", where: "Minesweeper and puzzle YouTubers, variety streamers who do 'chat vs me' segments", angle: "Custom rooms make a 'race the chat' segment trivial. Offer a skin code and a bot-free lobby; send the outreach email below." }
];

// ---- copy library: ready to paste, one entry per channel and purpose ----
export interface CopyEntry { id: string; channel: string; title: string; body: string; notes?: string; }
export const COPY: CopyEntry[] = [
	{
		id: "reddit-minesweeper", channel: "Reddit, r/Minesweeper", title: "Community post (the honest one)",
		body: `I built a multiplayer Minesweeper and would love this community's take on it.

msbattle.net puts two players (or six) on the same no-guess board at the same time; first to clear it wins. There's a ranked ladder with Elo per style (Sprint is wide and fast, Standard is dense and punishing), a daily puzzle, and a few thousand solver-rated deduction puzzles for when you don't want a live opponent.

A couple of things I cared about: every board is solvable without guessing (there's a real solver behind the generator), the centre is pre-revealed so races start immediately, and mistakes cost time rather than ending the round in ranked.

It's free and runs in the browser. I'd genuinely like to hear what feels wrong to people who actually know the game. Happy to answer anything about the generator or the solver.`,
		notes: "Read the subreddit's self-promotion rules first; post as a person, not a brand. Reply to every comment in the first two hours. Do not mention the shop."
	},
	{
		id: "reddit-webgames", channel: "Reddit, r/WebGames", title: "Link post title + comment",
		body: `Title: MS Battle: real-time competitive Minesweeper (1v1 and 6-player, ranked, no-guess boards)

Comment: Made this. Same board for everyone, live opponent boards next to yours, a ranked ladder, and a daily puzzle. No install, no account needed to try it (guests can play ranked). Feedback very welcome, especially on the phone layout.`,
		notes: "r/WebGames wants the game link as the post. Keep the title factual; the mods remove hype."
	},
	{
		id: "show-hn", channel: "Hacker News", title: "Show HN",
		body: `Show HN: MS Battle, real-time multiplayer Minesweeper with no-guess boards

I've been building a competitive Minesweeper: two players (or six) get the same board at the same time and race to clear it, with an Elo ladder on top.

The interesting engineering was in the boards. Every layout is generated to be solvable by deduction alone (a CSP solver checks every board and also rates puzzle difficulty), the centre is pre-revealed so a race starts at once, and the server hands each match to a stateless game server with a signed token so a deploy never kills a live match.

Stack: Node + socket.io, SQLite via node:sqlite, React + canvas on the client. Free, in the browser: https://msbattle.net

I'd love feedback on the no-guess generator and on the matchmaking; both are described in the help page.`,
		notes: "Post Tuesday to Thursday, 8 to 10am US Eastern. Stay in the thread all day. HN rewards technical detail and hates marketing tone."
	},
	{
		id: "x-thread", channel: "X / Twitter", title: "Launch thread (3 posts)",
		body: `1/ Minesweeper, but it's a race.

Two players, one board, first to clear it wins. Ranked ladder, no-guess boards, free in the browser.

msbattle.net

[promo image: then vs now]

2/ Every board is solvable by logic alone. A real solver checks each layout before it ships, so when you lose it's because they read the board faster, not because of a coin flip.

[clip: 15s duel]

3/ There's also a daily puzzle and a few thousand rated deduction positions if you'd rather sharpen up than fight. Bronze to Master, one Elo per style. Come climb.

[clip: 6-player start grid]`,
		notes: "First post carries the image. Pin it. Reply to yourself with the clips so the thread stays one unit."
	},
	{
		id: "discord", channel: "Discord", title: "Server announcement",
		body: `@everyone MS Battle is live at msbattle.net

What's in: 1v1 and 6-player ranked races (Sprint and Standard), custom rooms for playing with friends, a daily puzzle, rated puzzles with streaks, replays, and a shop with board skins and avatars.

Come race: pick Sprint on the home page, hit 1v1, and you'll have an opponent inside a few seconds. Post your rank in #ranks and your worst 50/50 story in #salt.`,
		notes: "Follow up in 48h with the leaderboard top 10 as a screenshot."
	},
	{
		id: "product-hunt", channel: "Product Hunt", title: "Tagline + description",
		body: `Tagline (60 chars): Real-time competitive Minesweeper with a ranked ladder

Description: MS Battle is Minesweeper as a race. Two players (or six) get the same no-guess board at the same time and the first to clear it wins. Climb an Elo ladder from Bronze to Master, solve a daily puzzle, sharpen up on thousands of solver-rated positions, and make the board yours with skins and avatars. Free, in the browser, on your phone too.

First comment (maker): I grew up playing Minesweeper between homework tabs and always wished it had an opponent. Every board here is checked by a solver so you never have to guess, and matches hand off to a separate game server so a deploy never drops you mid-race. Ask me anything about the generator.`,
		notes: "Launch at 12:01am PT. Gallery: promo image first, then the duel clip, then the 6-player grid, then the puzzle screen."
	},
	{
		id: "press-short", channel: "Press kit", title: "Boilerplate (short, medium, long)",
		body: `Short (one line): MS Battle is real-time competitive Minesweeper: same board, live opponents, a ranked ladder, free in the browser.

Medium (50 words): MS Battle turns Minesweeper into a race. Two players, or six, get the same board at the same moment and the first to clear it wins. Every board is solvable without guessing. A ranked Elo ladder, a daily puzzle and thousands of rated deduction puzzles round it out. Free, in any browser.

Long (120 words): MS Battle is a free, browser-based multiplayer Minesweeper. In ranked play, two players (1v1) or six (free-for-all) receive the identical board at the same moment and race to clear it; a live view of each opponent's board sits next to your own. Every layout is generated to be solvable by deduction alone and verified by a solver, so no round is decided by a guess. Two styles, Sprint and Standard, each carry their own Elo ladder from Bronze to Master. Outside ranked play there is a daily puzzle, a pool of thousands of solver-rated deduction puzzles with streaks, replays of every match, custom rooms for friends, and cosmetics: board skins, avatars and reveal effects. MS Battle runs on desktop and phones with no install.`
	},
	{
		id: "streamer-email", channel: "Outreach", title: "Streamer / YouTuber email",
		body: `Subject: A Minesweeper you can race your chat in

Hi [name],

I watched your [video/stream] on [topic] and thought you might enjoy this: I built a multiplayer Minesweeper called MS Battle (msbattle.net). Two players, or six, get the same no-guess board at the same time and race to clear it. There's a ranked ladder, and custom rooms where you can race viewers directly.

If a "race the chat" segment sounds fun, I can set up a private lobby with no bots, put a skin on your account, and be on hand during the stream if anything breaks. No obligations either way, and I'm happy to send a build note on how the no-guess generator works if the tech side interests you.

Thanks for the content either way.

[your name]
MS Battle, msbattle.net`,
		notes: "One personal line at the top, always. Send Monday or Tuesday morning in their timezone. Follow up once after a week, then stop."
	},
	{
		id: "youtube-desc", channel: "YouTube / TikTok", title: "Video description + hashtags",
		body: `Minesweeper, but it's a race. Two players, one board, first to clear it wins.

Play free in your browser: https://msbattle.net

Ranked ladder from Bronze to Master, no-guess boards (a solver checks every layout), a daily puzzle, and thousands of rated deduction puzzles.

#minesweeper #puzzlegame #browsergame #indiegame #speedrun #ranked`,
		notes: "Shorts under 30s get pushed hardest. Burn captions in; most viewers are muted."
	},
	{
		id: "blog-outline", channel: "Blog / newsletter", title: "Launch post outline",
		body: `Title: Minesweeper never needed guessing. It needed an opponent.

1. The 1998 memory (one paragraph, the Windows window, the smiley).
2. What went wrong: the 50/50 at the end. Why it made competitive play impossible.
3. The fix: no-guess generation and a solver that grades every board. What "solvable by deduction" really means.
4. The race: same board, same moment, live opponent view. The 3-2-1, the VS banner, the mistakes-cost-time rule.
5. The ladder: placement, Elo per style, streak multipliers, Bronze to Master.
6. Puzzles for the quiet days: the daily, the ladder, storm mode.
7. How to start: one link, no account needed, thirty seconds to a first match.
8. What's next and where to send feedback.`
	}
];

// ---- video: storyboards, the recording recipe, the platform specs ----
export interface Shot { t: string; shot: string; overlay?: string; audio?: string; }
export interface Storyboard { id: string; title: string; length: string; aspect: string; purpose: string; shots: Shot[]; }
export const STORYBOARDS: Storyboard[] = [
	{
		id: "then-now", title: "Then vs Now", length: "15s", aspect: "9:16 and 16:9", purpose: "The hook video. The nostalgia crowd, X, Shorts, TikTok, Reels.",
		shots: [
			{ t: "0.0 to 3.0", shot: "Windows 3.1 Minesweeper, one guess at the end, the mine hits, the smiley dies.", overlay: "THEN", audio: "Silence, then the classic Windows error chime." },
			{ t: "3.0 to 4.0", shot: "Hard cut to black. The MSBattle logo punches in.", overlay: "NOW", audio: "The found sting (three pings and the pling)." },
			{ t: "4.0 to 9.0", shot: "The VS banner slams in, then a live duel: both boards, cascades ripping open, flags landing.", overlay: "Same board. Two players. Live.", audio: "The VS whooshes, then the battle theme." },
			{ t: "9.0 to 13.0", shot: "The winner banner. The opponent board still half covered.", overlay: "First to clear it wins.", audio: "Series win arp." },
			{ t: "13.0 to 15.0", shot: "End card: logo, wordmark, msbattle.net.", overlay: "Free in your browser. msbattle.net", audio: "Theme fades." }
		]
	},
	{
		id: "duel", title: "The Duel", length: "30s", aspect: "16:9", purpose: "The showcase. Product Hunt gallery, the blog post, the Reddit comment.",
		shots: [
			{ t: "0 to 4", shot: "Home page, click Sprint, click 1v1. The heartbeat search, the radar, 'Target acquired'.", overlay: "Find a match in seconds", audio: "Heartbeat, found sting." },
			{ t: "4 to 8", shot: "VS banner, then the 3-2-1 spelled out in tiles on both boards, then GO.", overlay: "", audio: "Whooshes, countdown beeps, go." },
			{ t: "8 to 22", shot: "The race, real time, your board full frame with the opponent's small in the corner. Include one mine hit and the penalty freeze.", overlay: "Mistakes cost time, not the round", audio: "Battle theme, cascades, one mine blast." },
			{ t: "22 to 27", shot: "The last cells, the win, the winner banner, the Elo change on the result modal.", overlay: "+24 Elo", audio: "Win arp, rank up." },
			{ t: "27 to 30", shot: "End card.", overlay: "msbattle.net", audio: "" }
		]
	},
	{
		id: "six", title: "Six on the grid", length: "20s", aspect: "16:9", purpose: "The esport shape. Discord, X, Reddit r/WebGames.",
		shots: [
			{ t: "0 to 5", shot: "The 6-player start grid gliding in: six names, flags and ranks.", overlay: "Six players. One board.", audio: "Riser whoosh." },
			{ t: "5 to 15", shot: "The field view: your board plus five opponent cards, standings shifting as people finish.", overlay: "Live standings", audio: "Theme, opponent-done chimes." },
			{ t: "15 to 20", shot: "Final standings, the placement stamp.", overlay: "Where do you place?", audio: "" }
		]
	},
	{
		id: "no-guess", title: "You never have to guess", length: "45s", aspect: "16:9", purpose: "The explainer. YouTube, the blog, Hacker News.",
		shots: [
			{ t: "0 to 8", shot: "A classic board ending in a 50/50. Freeze on the two candidate cells.", overlay: "This is why Minesweeper was never a sport", audio: "Voice-over." },
			{ t: "8 to 20", shot: "The generator: a board being built and rejected in the Puzzle Lab, then accepted. The solver's difficulty score appearing.", overlay: "Every board is checked by a solver", audio: "Voice-over." },
			{ t: "20 to 35", shot: "A puzzle from the daily: the deduction step highlighted (the Learn page's rule demo works well here).", overlay: "Read it. Never guess it.", audio: "Voice-over." },
			{ t: "35 to 45", shot: "Cut to a live duel, then the end card.", overlay: "Now race someone. msbattle.net", audio: "Theme." }
		]
	},
	{
		id: "loop", title: "The satisfying loop", length: "8s, looping", aspect: "1:1", purpose: "Ads and pinned posts. No text needed.",
		shots: [
			{ t: "0 to 8", shot: "One big cascade opening across the board with the Ripple effect, then a flag, then another cascade. Cut so the loop is seamless.", overlay: "", audio: "Cascade ticks only." }
		]
	}
];

export const RECORDING_KIT: { step: string; detail: string }[] = [
	{ step: "Window", detail: "Chrome at exactly 1920x1080 (or 1080x1920 for vertical: open DevTools, device toolbar, custom size). Hide bookmarks, zoom 100%, dark tab bar. Full screen the page with the game's own fullscreen button." },
	{ step: "Account", detail: "A named account with a good-looking rank (Gold I reads well) and an image avatar. Use /admin to set a rank and reset puzzle progress." },
	{ step: "Opponents", detail: "Ranked search fills with pool bots within seconds; their names and flags are randomised, so re-queue until the roster looks right. For staged footage, a custom room with a friend gives you control of the pace." },
	{ step: "Short rounds", detail: "RANKED_ROUND_SECONDS=20 in .env makes round ends and the result modal quick to reach when you only want the ending." },
	{ step: "B-roll", detail: "/admin/bots can watch any pool bot play a full board: endless cascade footage with no hands on the keyboard." },
	{ step: "Sound", detail: "Record system audio (BlackHole on macOS, or OBS's desktop audio). The game's own sounds carry the clips; add music only under voice-over." },
	{ step: "Capture", detail: "macOS: Cmd+Shift+5 records at native resolution. OBS for anything with audio mixing. Record 10 seconds more than you need on both ends." },
	{ step: "Cursor", detail: "Keep it. Clicks are the point. Slow your hands down 20%: fast play reads as noise in a 15-second clip." }
];

export const FFMPEG: { label: string; cmd: string }[] = [
	{ label: "Trim (from 0:12, 15 seconds long)", cmd: "ffmpeg -ss 00:00:12 -t 15 -i raw.mov -c:v libx264 -crf 18 -preset slow -c:a aac -movflags +faststart duel.mp4" },
	{ label: "Crop 16:9 to 9:16 (centre) for Shorts", cmd: "ffmpeg -i duel.mp4 -vf \"crop=ih*9/16:ih,scale=1080:1920\" -c:a copy duel-vertical.mp4" },
	{ label: "Square 1080 for feeds", cmd: "ffmpeg -i duel.mp4 -vf \"crop=ih:ih,scale=1080:1080\" -c:a copy duel-square.mp4" },
	{ label: "Looping GIF, 8s, 30fps, small", cmd: "ffmpeg -t 8 -i loop.mp4 -vf \"fps=30,scale=600:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse\" loop.gif" },
	{ label: "Burn captions from an .srt", cmd: "ffmpeg -i duel.mp4 -vf \"subtitles=duel.srt:force_style='FontName=Space Grotesk,FontSize=28,Outline=2'\" duel-captioned.mp4" }
];

export const VIDEO_SPECS: { platform: string; aspect: string; length: string; notes: string }[] = [
	{ platform: "YouTube Shorts", aspect: "9:16, 1080x1920", length: "Under 60s, best under 30s", notes: "Burned-in captions. Hook in the first second. Title with a question." },
	{ platform: "TikTok / Reels", aspect: "9:16, 1080x1920", length: "7 to 30s", notes: "Native upload, no watermark from another app. Trending sound optional; the game's sounds are fine." },
	{ platform: "X", aspect: "16:9 or 1:1", length: "Under 45s", notes: "Autoplays muted: text overlay carries it. Under 512MB, H.264." },
	{ platform: "Reddit", aspect: "16:9 or 1:1", length: "Under 60s", notes: "Native video posts outperform links in most game subs. GIF for comments." },
	{ platform: "Product Hunt", aspect: "16:9", length: "30 to 60s", notes: "YouTube link in the gallery. The Duel video." },
	{ platform: "Discord", aspect: "Any", length: "Short", notes: "8MB limit without Nitro: the GIF loop, or a link." }
];

// ---- images: what each surface wants ----
export const IMAGE_SPECS: { surface: string; size: string; use: string }[] = [
	{ surface: "Open Graph / link preview", size: "1200x630", use: "index.html og:image: the live 6-player race (public/og-six.jpg); og-duel.jpg and og-then-now.jpg sit next to it for posts that want the duel or the contrast." },
	{ surface: "X header", size: "1500x500", use: "Profile header." },
	{ surface: "Square feed post", size: "1080x1080", use: "Instagram, Mastodon, Discord." },
	{ surface: "Story / Short cover", size: "1080x1920", use: "TikTok, Reels, Shorts thumbnail." },
	{ surface: "YouTube thumbnail", size: "1280x720", use: "Big face-sized text, three words at most." },
	{ surface: "Product Hunt gallery", size: "1270x760", use: "Four to six images; the promo image first." },
	{ surface: "Reddit thumbnail", size: "1200x630", use: "Same as OG; the crop is unpredictable, keep the subject centred." }
];

// ---- channels: where to post, what, how often ----
export interface Channel { name: string; audience: string; format: string; angle: string; cadence: string; rules: string; }
export const CHANNELS: Channel[] = [
	{ name: "r/Minesweeper", audience: "Experts, speedrunners", format: "Text post, then a video comment", angle: "No-guess boards, the solver, live races. Ask, don't sell.", cadence: "Launch, then only real updates (monthly at most)", rules: "Self-promo tolerated when you engage. Never link the shop." },
	{ name: "r/WebGames", audience: "Browser gamers", format: "Link post", angle: "Ranked, live, free, no install.", cadence: "Launch + one big update", rules: "Link must be the game. Factual title." },
	{ name: "r/IndieGaming, r/IndieDev", audience: "Devs and fans", format: "Video post", angle: "The dev story: solver, split game servers, canvas rendering.", cadence: "Launch, Feedback Friday threads", rules: "Weekend self-promo threads on some subs." },
	{ name: "Hacker News", audience: "Engineers", format: "Show HN", angle: "The no-guess generator and the match hand-off.", cadence: "Once", rules: "One shot. Technical, humble, present all day." },
	{ name: "Product Hunt", audience: "Early adopters", format: "Launch page", angle: "Minesweeper as a sport.", cadence: "Once", rules: "Line up 20 people to comment in the first hour. Hunter optional." },
	{ name: "X / Twitter", audience: "Everyone, devs", format: "Thread with image + clips", angle: "Then vs Now. Progress posts (#buildinpublic).", cadence: "3 posts a week: a clip, a stat, a puzzle", rules: "Pin the launch thread. Reply to every quote." },
	{ name: "TikTok / Shorts / Reels", audience: "Under 30", format: "Vertical clips", angle: "Satisfying cascades, 50/50 rage, 'race me'.", cadence: "Daily for the first two weeks", rules: "Hook in one second. Same clip on all three." },
	{ name: "Discord", audience: "Your players", format: "Announcements, events", angle: "Weekend tournaments, rank flexing, salt.", cadence: "Weekly event, daily presence", rules: "The community home. Put the invite on the site footer." },
	{ name: "YouTube", audience: "Puzzle fans", format: "Explainer + gameplay", angle: "You never have to guess.", cadence: "Monthly", rules: "Long tail: the explainer keeps working for years." },
	{ name: "Streamers", audience: "Their chats", format: "Race-the-chat segments", angle: "Custom rooms, a private lobby.", cadence: "Five outreach emails a week", rules: "Personal, short, one follow-up." },
	{ name: "Newsletter / blog", audience: "Returning players", format: "Monthly post", angle: "Patch notes as stories, top players, puzzle of the month.", cadence: "Monthly", rules: "Collect emails from the profile page first." },
	{ name: "Game directories", audience: "Searchers", format: "Listing", angle: "'Multiplayer minesweeper' is a searched phrase with weak results.", cadence: "Once each", rules: "itch.io, CrazyGames-style portals (check their embed terms), Poki, AlternativeTo." }
];

// ---- the launch calendar and the checklist ----
export const CALENDAR: { week: string; theme: string; actions: string[] }[] = [
	{ week: "Week -2", theme: "Get the house in order", actions: ["Studio export for the OG image, replace og:image in index.html", "Discord server with #ranks and #salt, invite on the site footer", "Record the raw footage for all five storyboards in one session", "Set up UTM links and check the analytics events fire"] },
	{ week: "Week -1", theme: "Soft launch", actions: ["r/Minesweeper post: ask for feedback, fix what they find", "Streamer outreach batch one (five emails)", "Cut the Duel and Then vs Now videos", "Line up 20 friends for Product Hunt morning"] },
	{ week: "Week 0", theme: "Launch", actions: ["Tuesday: Show HN at 9am ET", "Wednesday: Product Hunt at 12:01am PT, X thread at 9am ET", "Thursday: r/WebGames and r/IndieGaming video posts", "Daily vertical clips all week", "Reply to everything within the hour"] },
	{ week: "Week +1", theme: "Keep the fire", actions: ["First weekend tournament on Discord", "Publish the no-guess explainer video and blog post", "Streamer outreach batch two", "Share the leaderboard top 10 on X"] },
	{ week: "Week +2", theme: "Directories and long tail", actions: ["Submit to itch.io and the game portals", "AlternativeTo listing", "Newsletter issue one: what launch week looked like, in numbers"] },
	{ week: "Week +4", theme: "Review", actions: ["Compare channels by signups and D7 retention", "Double down on the top two channels, drop the rest", "Plan the first content update as the next launch beat"] }
];

export const CHECKLIST: { id: string; label: string }[] = [
	{ id: "og", label: "OG image replaced with a studio export (index.html og:image)" },
	{ id: "discord", label: "Discord server live and linked from the site" },
	{ id: "footage", label: "Raw footage recorded for all five storyboards" },
	{ id: "duel-video", label: "The Duel video cut (30s, 16:9)" },
	{ id: "then-now-video", label: "Then vs Now video cut (15s, 9:16 and 16:9)" },
	{ id: "utm", label: "UTM links created for every channel" },
	{ id: "reddit-ms", label: "r/Minesweeper feedback post published" },
	{ id: "outreach-1", label: "Streamer outreach batch one sent" },
	{ id: "hn", label: "Show HN posted" },
	{ id: "ph", label: "Product Hunt launched" },
	{ id: "x-thread", label: "X launch thread posted and pinned" },
	{ id: "webgames", label: "r/WebGames and r/IndieGaming posted" },
	{ id: "tournament", label: "First Discord tournament run" },
	{ id: "explainer", label: "No-guess explainer published" },
	{ id: "directories", label: "itch.io and portals submitted" },
	{ id: "review", label: "Week +4 channel review done" }
];

export const METRICS: { metric: string; why: string; how: string }[] = [
	{ metric: "Visits by source", why: "Which channel actually sends people.", how: "UTM links below; the analytics dashboard's referrer view." },
	{ metric: "First match within 5 minutes", why: "The funnel's only step that matters: did they race someone?", how: "The Game Started event, keyed by first session." },
	{ metric: "D1 and D7 return", why: "Whether the ladder and the daily puzzle hook.", how: "Sessions by account age." },
	{ metric: "Ranked matches per player per day", why: "Depth of the core loop.", how: "match_history rows per user per day." },
	{ metric: "Daily puzzle solves", why: "The quiet-day retention product.", how: "daily_attempts with solved = 1." },
	{ metric: "Shares of the daily result", why: "Organic reach, Wordle style.", how: "Add a share button first; count its clicks." }
];

export const UTM_SOURCES = ["reddit", "hackernews", "producthunt", "twitter", "tiktok", "youtube", "discord", "newsletter", "itch", "streamer"];
export const UTM_MEDIUMS = ["social", "referral", "email", "video", "community"];
