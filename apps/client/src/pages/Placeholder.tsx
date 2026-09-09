// Stand-in for routes that are not ported yet. Removed as each page lands.
export default function Placeholder({ title }: { title: string }) {
	return (
		<section>
			<h1>{title}</h1>
			<p style={{ color: "var(--muted)" }}>This page is being rebuilt.</p>
		</section>
	);
}
