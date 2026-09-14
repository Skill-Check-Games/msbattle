// The sign-in chooser: one button per provider the server offers (Google, Discord; the dev login locally).
// Picking one hands off to the provider's OAuth page; until the browser leaves, the chosen button shows a
// spinner and the rest are disabled, so the tap is seen to have landed (a redirect can take a second or two).
import Modal from "./Modal";
import { useAuth } from "../shared/auth";
import styles from "./SignInModal.module.scss";

const PROVIDERS: Array<{ id: "google" | "discord" | "dev"; label: string; sub: string }> = [
	{ id: "google", label: "Continue with Google", sub: "Your Google account" },
	{ id: "discord", label: "Continue with Discord", sub: "Your Discord account" },
	{ id: "dev", label: "Dev login", sub: "Local development only" }
];

export default function SignInModal({ open, onClose }: { open: boolean; onClose: () => void }) {
	const { providers, signIn, signingIn, account } = useAuth();
	const available = PROVIDERS.filter(p => providers[p.id]);
	return (
		<Modal open={open} onClose={() => { if (!signingIn) onClose(); }} title="Sign in" width={420} labelledBy="signin_title">
			<p className={styles.lead}>{account && account.guest ? "Keep your rating, stats and cosmetics on an account." : "Choose how to sign in."}</p>
			<div className={styles.list}>
				{available.map(p => (
					<button key={p.id} type="button" className={`${styles.provider} ${signingIn === p.id ? styles.busy : ""}`} disabled={!!signingIn} onClick={() => signIn(p.id)}>
						<span className={styles.mark} aria-hidden="true">{signingIn === p.id ? <span className={styles.spinner} /> : <ProviderMark id={p.id} />}</span>
						<span className={styles.text}><b>{signingIn === p.id ? "Connecting…" : p.label}</b><small>{p.sub}</small></span>
					</button>
				))}
				{!available.length && <p className={styles.none}>No sign-in provider is configured on this server.</p>}
			</div>
		</Modal>
	);
}

function ProviderMark({ id }: { id: "google" | "discord" | "dev" }) {
	if (id === "google") return <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.4z" /><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z" /><path fill="#FBBC05" d="M6.4 14a6 6 0 0 1 0-3.9V7.5H3.1a10 10 0 0 0 0 9z" /><path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 0 0 3.1 7.5L6.4 10c.8-2.3 3-4.1 5.6-4.1z" /></svg>;
	if (id === "discord") return <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="#5865F2" d="M19.6 5.6A17 17 0 0 0 15.4 4.3l-.5 1a15.7 15.7 0 0 0-5.8 0l-.5-1a17 17 0 0 0-4.2 1.3C1.7 9.6 1 13.5 1.3 17.3a17.1 17.1 0 0 0 5.2 2.6l1.1-1.8a11 11 0 0 1-1.7-.8l.4-.3a12.2 12.2 0 0 0 11.4 0l.4.3-1.7.8 1.1 1.8a17 17 0 0 0 5.2-2.6c.4-4.4-.7-8.3-3.1-11.7zM8.7 15c-1 0-1.9-.9-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1S9.7 15 8.7 15zm6.6 0c-1 0-1.9-.9-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1-.8 2.1-1.9 2.1z" /></svg>;
	return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 9l-4 3 4 3M16 9l4 3-4 3M14 5l-4 14" /></svg>;
}
