// Shared pieces for the admin pages: the page frame (title, sub, back link, admin gate), the pager
// used by the paginated list views, and URL-backed filter state so a reload keeps the filters.
import { ReactNode, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../shared/auth";
import styles from "./admin-shared.module.scss";

export function AdminPage({ title, sub, actions, children, wide }: { title: string; sub?: ReactNode; actions?: ReactNode; children: ReactNode; wide?: boolean }) {
	const { account } = useAuth();
	const admin = !!(account && account.isAdmin);
	return (
		<section className={wide ? styles.wide : undefined}>
			<div className={styles.head}>
				<div>
					<div className={styles.crumbs}><Link to="/admin">Admin</Link>{title !== "Admin" && <span> / {title}</span>}</div>
					<h1 className={styles.title}>{title}</h1>
					{sub && <p className={styles.sub}>{sub}</p>}
				</div>
				{actions && <div className={styles.actions}>{actions}</div>}
			</div>
			{account && !admin ? <p className={styles.gate}>Admins only. Sign in with an admin account to use these tools.</p> : children}
		</section>
	);
}

// ← Prev / 1 … window … N / Next →. Hidden with a single page. Pages are 0-based.
export function Pager({ total, page, pageSize, onGoto }: { total: number; page: number; pageSize: number; onGoto: (p: number) => void }) {
	const totalPages = Math.max(1, Math.ceil(total / pageSize));
	if (totalPages <= 1) return null;
	const go = (t: number) => { if (t !== page) onGoto(Math.max(0, Math.min(totalPages - 1, t))); };
	const win = 5;
	let start = Math.max(0, page - Math.floor(win / 2));
	const end = Math.min(totalPages - 1, start + win - 1);
	start = Math.max(0, end - win + 1);
	const btn = (label: string, target: number, current = false, disabled = false) => (
		<button key={label + target} type="button" className={`${styles.pagerBtn} ${current ? styles.pagerCurrent : ""}`} disabled={disabled || target === page} onClick={() => go(target)}>{label}</button>
	);
	const items: ReactNode[] = [btn("← Prev", page - 1, false, page <= 0)];
	if (start > 0) { items.push(btn("1", 0)); if (start > 1) items.push(<span key="d1" className={styles.pagerDots}>…</span>); }
	for (let i = start; i <= end; i++) items.push(btn(String(i + 1), i, i === page));
	if (end < totalPages - 1) { if (end < totalPages - 2) items.push(<span key="d2" className={styles.pagerDots}>…</span>); items.push(btn(String(totalPages), totalPages - 1)); }
	items.push(btn("Next →", page + 1, false, page >= totalPages - 1));
	return <div className={styles.pager}>{items}</div>;
}

// Filter state mirrored into the query string (replace, not push). `defaults` are omitted from the URL.
export function useQueryState<T extends Record<string, string>>(defaults: T): [T, (patch: Partial<T>) => void] {
	const [params, setParams] = useSearchParams();
	const state = { ...defaults } as T;
	for (const k of Object.keys(defaults)) { const v = params.get(k); if (v != null) (state as any)[k] = v; }
	const set = useCallback((patch: Partial<T>) => {
		const next = new URLSearchParams(params);
		for (const [k, v] of Object.entries(patch)) { if (v == null || v === defaults[k]) next.delete(k); else next.set(k, String(v)); }
		setParams(next, { replace: true });
	}, [params, setParams, defaults]);
	return [state, set];
}

export { styles as adminStyles };
