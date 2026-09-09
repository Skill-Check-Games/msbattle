// Learn: the interactive deduction trainer. A course list, then one course at a time as a stepper
// of lessons. Progress lives in localStorage only (same key as the legacy client, so it carries over).
import { useEffect, useMemo, useRef, useState } from "react";
import { LEARN_COURSES, Course, Lesson, Step, BoardSpec, RuleSpec } from "./learn-data";
import LearnPuzzle, { MistakeKind } from "./LearnPuzzle";
import LearnBoard from "./LearnBoard";
import RuleDemo from "./RuleDemo";
import { pushToast } from "../../app/Toasts";
import styles from "./LearnPage.module.scss";

const KEY = "msbattle.learn.progress.v3";
interface Progress { courseId: string | null; lesson: number; completed: Record<string, boolean[]>; completedAt: Record<string, number | null>; }
const courseById = (id: string | null) => LEARN_COURSES.find(c => c.id === id) || null;
function emptyProgress(): Progress {
	const completed: Record<string, boolean[]> = {}, completedAt: Record<string, number | null> = {};
	for (const c of LEARN_COURSES) { completed[c.id] = new Array(c.lessons.length).fill(false); completedAt[c.id] = null; }
	return { courseId: null, lesson: 0, completed, completedAt };
}
function loadProgress(): Progress {
	const p = emptyProgress();
	try {
		const raw = localStorage.getItem(KEY); if (!raw) return p;
		const parsed = JSON.parse(raw); if (!parsed || typeof parsed !== "object") return p;
		for (const c of LEARN_COURSES) {
			const saved = parsed.completed?.[c.id];
			if (Array.isArray(saved)) for (let j = 0; j < c.lessons.length && j < saved.length; j++) p.completed[c.id][j] = !!saved[j];
			if (parsed.completedAt?.[c.id]) p.completedAt[c.id] = parsed.completedAt[c.id];
		}
		p.courseId = (typeof parsed.currentCourseId === "string" && courseById(parsed.currentCourseId)) ? parsed.currentCourseId : null;
		p.lesson = Math.max(0, parsed.currentLesson | 0);
	} catch { /* corrupt state */ }
	return p;
}
function saveProgress(p: Progress) {
	try { localStorage.setItem(KEY, JSON.stringify({ currentCourseId: p.courseId, currentLesson: p.lesson, completed: p.completed, completedAt: p.completedAt })); } catch { /* storage blocked */ }
}
const courseDone = (p: Progress, id: string) => { const a = p.completed[id] || []; return a.length > 0 && a.every(Boolean); };
const courseProgress = (p: Progress, id: string) => { const a = p.completed[id] || []; return { done: a.filter(Boolean).length, total: a.length }; };
const firstIncomplete = (p: Progress, id: string) => { const i = (p.completed[id] || []).indexOf(false); return i < 0 ? 0 : i; };

export default function LearnPage() {
	const [p, setP] = useState<Progress>(loadProgress);
	useEffect(() => saveProgress(p), [p]);
	const course = courseById(p.courseId);
	if (!course) return <CourseList p={p} onEnter={id => setP(x => ({ ...x, courseId: id, lesson: firstIncomplete(x, id) }))} />;
	return <CourseView key={course.id} course={course} p={p} setP={setP} />;
}

function CourseList({ p, onEnter }: { p: Progress; onEnter: (id: string) => void }) {
	return (
		<section>
			<h1 className={styles.pageTitle}>Learn</h1>
			<div className={styles.courses}>
				{LEARN_COURSES.map(c => {
					const prog = courseProgress(p, c.id), done = courseDone(p, c.id);
					return (
						<button key={c.id} type="button" className={`${styles.course} ${done ? styles.courseDone : ""}`} onClick={() => onEnter(c.id)}>
							{done && <div><span className={styles.courseBadge}>✓ Done</span></div>}
							<h2 className={styles.courseTitle}>{c.title}</h2>
							<p className={styles.courseSub}>{c.sub}</p>
							<div className={styles.courseBar}><div className={styles.courseBarFill} style={{ width: (prog.total ? Math.round(100 * prog.done / prog.total) : 0) + "%" }} /></div>
							<div className={styles.courseMeta}><span>{prog.done} / {prog.total} lessons</span><span className={styles.courseCta}>{done ? "Review →" : prog.done > 0 ? "Continue →" : "Start →"}</span></div>
						</button>
					);
				})}
			</div>
		</section>
	);
}

function CourseView({ course, p, setP }: { course: Course; p: Progress; setP: React.Dispatch<React.SetStateAction<Progress>> }) {
	const lessons = course.lessons, completed = p.completed[course.id], idx = Math.min(p.lesson, lessons.length - 1), lesson = lessons[idx];
	const done = courseDone(p, course.id), prog = courseProgress(p, course.id), isLast = idx === lessons.length - 1;
	const goTo = (i: number) => setP(x => ({ ...x, lesson: i }));
	const finishCourse = () => {
		pushToast({ icon: "🏆", label: "Course complete", name: course.title, complete: true });
		setP(x => ({ ...x, completedAt: { ...x.completedAt, [course.id]: x.completedAt[course.id] || Date.now() }, lesson: lessons.length - 1, courseId: null }));
	};
	const markComplete = () => setP(x => {
		const arr = x.completed[course.id].slice(); arr[idx] = true;
		const completedAt = { ...x.completedAt }; if (arr.every(Boolean) && !completedAt[course.id]) completedAt[course.id] = Date.now();
		return { ...x, completed: { ...x.completed, [course.id]: arr }, completedAt };
	});
	// Mentor lessons advance on their final Continue; prose lessons stay put so solved puzzles can be reviewed.
	const onLessonComplete = () => { markComplete(); if (lesson.steps) { if (isLast) finishCourse(); else goTo(idx + 1); } };
	return (
		<section>
			<div className={styles.titleRow}>
				<button type="button" className="btn btn-ghost" onClick={() => setP(x => ({ ...x, courseId: null }))}>← All courses</button>
				<h1 className={styles.pageTitle}>{course.title}</h1>
			</div>
			<div className={styles.stepper} aria-label="Lesson progress">
				{lessons.map((l, i) => {
					const unlocked = done || completed[i] || i <= idx;
					return (
						<span key={i} className={styles.stepWrap}>
							<button type="button" title={l.title} disabled={!unlocked} onClick={() => goTo(i)}
								className={`${styles.step} ${completed[i] ? styles.stepDone : ""} ${i === idx ? styles.stepCurrent : ""} ${unlocked ? styles.stepUnlocked : ""}`}>{i + 1}</button>
							{i < lessons.length - 1 && <span className={`${styles.stepLine} ${completed[i] ? styles.stepLineDone : ""}`} />}
						</span>
					);
				})}
			</div>
			{lesson.steps ? <MentorLesson key={`${course.id}-${idx}`} lesson={lesson} onComplete={onLessonComplete} /> : <ProseLesson key={`${course.id}-${idx}`} lesson={lesson} onComplete={onLessonComplete} />}
			<div className={styles.nav}>
				<button type="button" className="btn" disabled={idx === 0} onClick={() => goTo(idx - 1)}>← Previous lesson</button>
				<div className={styles.progressText}>{prog.done} of {prog.total} complete</div>
				<button type="button" className="btn btn-primary" disabled={!completed[idx]} onClick={() => isLast ? finishCourse() : goTo(idx + 1)}>{isLast ? "Finish course" : "Next lesson →"}</button>
			</div>
		</section>
	);
}

// ---- Mentor lesson: one coach bubble above a sequence of boards, Continue / Try again gated. ----
type Bubble = { text: string; kind: "intro" | "hint" | "mistake" | "outro" };
function MentorLesson({ lesson, onComplete }: { lesson: Lesson; onComplete: () => void }) {
	const steps = lesson.steps || [];
	const [stepIdx, setStepIdx] = useState(0);
	const [attempt, setAttempt] = useState(0);
	const [phase, setPhase] = useState<"playing" | "solved" | "failed">("playing");
	const [hintIdx, setHintIdx] = useState(0);
	const step: Step | undefined = steps[stepIdx];
	const introText = (s: Step) => (Array.isArray(s.intro) ? s.intro : s.intro ? [s.intro] : []).join(" ");
	const [bubble, setBubble] = useState<Bubble>(() => ({ text: step ? introText(step) : "", kind: "intro" }));
	const actionRef = useRef<HTMLButtonElement>(null);
	// Stable per step: LearnPuzzle re-initialises its board whenever the spec object changes.
	const puzzle: BoardSpec | null = useMemo(() => step?.board ? { title: lesson.title, ...step.board, requirements: step.requirements } : null, [lesson, step]);
	useEffect(() => { if (phase !== "playing") actionRef.current?.focus(); }, [phase]);
	if (!step) return null;
	const hints = step.hints || [];
	const load = (i: number) => { setStepIdx(i); setAttempt(a => a + 1); setPhase("playing"); setHintIdx(0); setBubble({ text: introText(steps[i]), kind: "intro" }); };
	const advance = () => { if (stepIdx + 1 < steps.length) load(stepIdx + 1); else onComplete(); };
	const onSolved = () => { setBubble({ text: step.outro || "", kind: "outro" }); setPhase("solved"); };
	const onFailed = () => setPhase("failed");
	const onMistake = (kind: MistakeKind) => { const t = step.mistakes?.[kind]; if (t) setBubble({ text: t, kind: "mistake" }); };
	const showHint = () => { if (hintIdx >= hints.length) return; setBubble({ text: hints[hintIdx], kind: "hint" }); setHintIdx(hintIdx + 1); };
	const bubbleCls = bubble.kind === "hint" ? styles.bubbleHint : bubble.kind === "mistake" ? styles.bubbleMistake : bubble.kind === "outro" ? styles.bubbleOutro : "";
	return (
		<div className={styles.mentor}>
			<h2 className={styles.mentorTitle}>{lesson.title}</h2>
			<div className={styles.coach}>
				<CoachAvatar px={64} />
				<div className={styles.bubbleCol}>
					<div className={`${styles.bubble} ${bubbleCls}`}><div className={styles.bubbleText}>{bubble.text}</div></div>
					{hints.length > 0 && <button type="button" className="btn btn-ghost" disabled={hintIdx >= hints.length || phase === "solved"} onClick={showHint}>Hint</button>}
				</div>
			</div>
			<div className={styles.boardCol}>
				{step.rulesPanel ? <RulesPanel rules={step.rulesPanel.rules} />
					: puzzle && <LearnPuzzle key={`${stepIdx}-${attempt}`} puzzle={puzzle} isGuess={!!step.guess} compact hideKbdHint autoFocus onSolved={onSolved} onFailed={onFailed} onMistake={onMistake} />}
			</div>
			<div className={styles.actions}>
				{(step.rulesPanel || phase === "solved") && <button ref={actionRef} type="button" className={`btn btn-primary ${styles.continueBtn}`} onClick={advance}>Continue</button>}
				{phase === "failed" && <button ref={actionRef} type="button" className={`btn ${styles.actionBtn}`} onClick={() => load(stepIdx)}>Try again</button>}
			</div>
		</div>
	);
}

function RulesPanel({ rules }: { rules: RuleSpec[] }) {
	return (
		<div className={styles.rules}>
			{rules.map(rule => (
				<div key={rule.label} className={styles.ruleCard}>
					<div className={styles.ruleLabel}>{rule.label}</div>
					<div className={styles.ruleDesc}>{rule.desc}</div>
					<RuleDemo scenes={rule.demos} />
				</div>
			))}
		</div>
	);
}

// ---- Prose lesson: idea + how + worked examples, then practice puzzles. ----
function ProseLesson({ lesson, onComplete }: { lesson: Lesson; onComplete: () => void }) {
	const puzzles = lesson.puzzles || [];
	const [solved, setSolved] = useState<boolean[]>(() => puzzles.map(() => false));
	const demos = Array.isArray(lesson.demo) ? lesson.demo : lesson.demo ? [lesson.demo] : [];
	const markSolved = (i: number) => setSolved(s => { if (s[i]) return s; const n = s.slice(); n[i] = true; if (n.every(Boolean)) onComplete(); return n; });
	return (
		<div className={styles.mentor}>
			<h2 className={styles.lessonTitle}>{lesson.title}</h2>
			<p className={styles.lessonIdea}>{lesson.idea}</p>
			<p className={styles.how}>{lesson.how}</p>
			{lesson.mistake && <p className={styles.mistake}><strong>Watch out: </strong>{lesson.mistake}</p>}
			{demos.map((d, i) => (
				<div key={i} className={styles.demo}>
					<div className={styles.demoLabel}>{d.title || "Worked example"}</div>
					<LearnBoard spec={d} />
					{d.why && <div className={styles.demoWhy}>{d.why}</div>}
				</div>
			))}
			{puzzles.length > 0 && <div className={styles.tryLabel}>{puzzles.length > 1 ? "Now you try" : "Your turn"}</div>}
			{puzzles.map((pz, i) => <LearnPuzzle key={i} puzzle={pz} isGuess={!!lesson.guess} hideKbdHint onSolved={() => markSolved(i)} />)}
			{solved.length > 0 && solved.every(Boolean) && <div className={styles.tryLabel}>All solved</div>}
		</div>
	);
}

// The coach: the game's own spiky mine, bigger and with a face.
function CoachAvatar({ px }: { px: number }) {
	const ref = useRef<HTMLCanvasElement>(null);
	useEffect(() => {
		const c = ref.current; if (!c) return;
		const dpr = window.devicePixelRatio || 1;
		c.width = Math.round(px * dpr); c.height = Math.round(px * dpr); c.style.width = px + "px"; c.style.height = px + "px";
		const ctx = c.getContext("2d")!; ctx.scale(dpr, dpr);
		const cx = px * 0.5, cy = px * 0.52, rad = px * 0.34;
		ctx.strokeStyle = "#475569"; ctx.lineWidth = Math.max(1.5, rad * 0.22); ctx.lineCap = "round";
		for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + Math.PI / 8; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * rad * 0.88, cy + Math.sin(a) * rad * 0.88); ctx.lineTo(cx + Math.cos(a) * rad * 1.4, cy + Math.sin(a) * rad * 1.4); ctx.stroke(); }
		const g = ctx.createLinearGradient(0, cy - rad, 0, cy + rad); g.addColorStop(0, "#3b4a68"); g.addColorStop(1, "#0b1220");
		ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
		ctx.lineWidth = Math.max(1, px * 0.015); ctx.strokeStyle = "rgba(148,163,184,0.45)"; ctx.stroke();
		const eyeY = cy - rad * 0.05, eyeDx = rad * 0.32, eyeR = rad * 0.14;
		ctx.fillStyle = "#e6e9f5"; ctx.beginPath(); ctx.arc(cx - eyeDx, eyeY, eyeR, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(cx + eyeDx, eyeY, eyeR, 0, Math.PI * 2); ctx.fill();
		ctx.fillStyle = "#0b1020"; ctx.beginPath(); ctx.arc(cx - eyeDx, eyeY, eyeR * 0.5, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(cx + eyeDx, eyeY, eyeR * 0.5, 0, Math.PI * 2); ctx.fill();
		ctx.strokeStyle = "#e6e9f5"; ctx.lineWidth = Math.max(1.2, rad * 0.07); ctx.lineCap = "round";
		ctx.beginPath(); ctx.arc(cx, cy + rad * 0.24, rad * 0.3, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
	}, [px]);
	return <canvas ref={ref} className={styles.coachAvatar} aria-hidden="true" />;
}
