// Privacy Policy and Terms of Service, as in-app pages (the navbar stays, and they deep-link).
import styles from "./LegalPages.module.scss";

export function PrivacyPage() {
	return (
		<article className={styles.legal}>
			<h1>Privacy Policy</h1>
			<p className={styles.updated}>Last updated: 11 June 2026</p>
			<p>MSBattle is a free online multiplayer Minesweeper game. In short: we collect as little as possible, never sell your data, and run no ads, analytics, or tracking cookies. Here's what the game touches.</p>
			<h2>What we collect</h2>
			<ul>
				<li><strong>Only if you sign in:</strong> your account ID, display name, email, and avatar from Google or Discord. We use OAuth and never see your password.</li>
				<li><strong>Gameplay data:</strong> your display name, ranked rating, and match and puzzle results, stored on our server to run the ladder and leaderboard. Play as a guest and you get a temporary account you can upgrade later.</li>
				<li><strong>On your device:</strong> a session token kept in your browser keeps you signed in. It isn't an advertising or tracking identifier.</li>
				<li><strong>Standard logs:</strong> our hosting and auth providers may log routine request data (such as your IP address) to keep the service running and secure.</li>
			</ul>
			<h2>Who processes it</h2>
			<p>We use <strong>Google</strong> and <strong>Discord</strong> for sign-in and <strong>Fly.io</strong> for hosting and our database. Signing in with Google or Discord is also covered by that provider's own privacy policy. Your display name, avatar, and ranked standing are visible to other players and on the public leaderboard.</p>
			<h2>Your choices</h2>
			<p>You can clear your browser data for this site to remove the local session, or email us to access or delete your account data. You can also revoke MSBattle's access from your <a href="https://myaccount.google.com/permissions">Google permissions</a> page. We keep your data only while your account exists.</p>
			<h2>Children</h2>
			<p>The game isn't directed at children under 13, and we don't knowingly collect their data.</p>
			<h2>Changes and contact</h2>
			<p>We may update this policy; the date above shows the latest version. Questions? Email <a href="mailto:erik.odenman@gmail.com">erik.odenman@gmail.com</a>.</p>
		</article>
	);
}

export function TermsPage() {
	return (
		<article className={styles.legal}>
			<h1>Terms of Service</h1>
			<p className={styles.updated}>Last updated: 11 June 2026</p>
			<p>MSBattle is a free online multiplayer Minesweeper game. By playing or signing in, you agree to these terms.</p>
			<h2>Fair play</h2>
			<ul>
				<li>Don't cheat, use bots or automation, or exploit bugs to manipulate matches, ratings, or the leaderboard.</li>
				<li>Don't disrupt the game, its servers, or other players.</li>
				<li>Pick a display name that isn't offensive, impersonating, or infringing. We may change or remove names that break this.</li>
			</ul>
			<p>We may suspend or remove accounts that break these rules.</p>
			<h2>Your account</h2>
			<p>You're responsible for what happens under your account. The MSBattle name, logo, and its original code and artwork belong to us.</p>
			<h2>No warranty</h2>
			<p>The game is provided "as is", without warranties, and may change or go offline at any time. Ranked ratings and match data may be reset. To the extent permitted by law, we aren't liable for any damages arising from your use of it.</p>
			<h2>Governing law</h2>
			<p>These terms are governed by the laws of Sweden.</p>
			<h2>Changes and contact</h2>
			<p>We may update these terms; the date above shows the latest version. Questions? Email <a href="mailto:erik.odenman@gmail.com">erik.odenman@gmail.com</a>.</p>
		</article>
	);
}
