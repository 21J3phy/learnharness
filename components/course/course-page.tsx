"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { stashOpeningPrompt } from "@/components/opening-prompt";
import { SetupDialog } from "@/components/setup-dialog";
import { cn } from "@/lib/utils";
import {
	DEFAULT_PLAN_PREFS, currentSession, daysBetween, diagnosticBudget, diagnosticCandidates, goalScope, indexCourse, isScheduled, knowledgeOf, nextGoal, overdueSessions,
	type CourseIndex, type Goal, type Mastery, type PlanPrefs, type PlanSession,
} from "@/src/core";
import { ChevronDownIcon } from "lucide-react";
import { nothingRead } from "@/lib/course-limits";
import { courseApi, needsModels, sendFiles, useCourse, type CourseView } from "./api";
import { ConceptDetail } from "./concept-detail";
import { ConceptMap, MapLegend } from "./concept-map";
import { DiagnosticRun } from "./diagnostic";
import { useFileDrop, type Dropped } from "./dropzone";
import { sortFiles, sourceSize } from "./files";
import { GoalForm } from "./goal-form";
import { DayStrip } from "./plan-strip";
import { PlanView, copyCalendarPrompt } from "./plan-view";
import { ErrorNote, LinkButton, Meter, MoreMenu, PageFrame, PrimaryButton, Stroke, Tex, awayDays, dayMonth, duration, longDay, useAction, weekdayShort, type MenuItem } from "./parts";

const BUILDING = new Set(["reading", "mapping", "organizing"]);

/** Sessions the plan scheduled (not ones the learner opened off-schedule). */
const scheduled = (goal: Goal) => (goal.plan?.sessions ?? []).filter(isScheduled);

/**
 * One course. The page answers three questions in order — how much of the
 * goal do I know (the meter), what do I do now (one action), and what does
 * the goal cover (the map) — and keeps everything else behind one menu.
 */
export function CoursePage({ id, initial }: { id: string; initial: CourseView }) {
	const router = useRouter();
	const { course: current, missing, adopt } = useCourse(id, initial);
	const course = current ?? initial;
	const [goalId, setGoalId] = useState<string | null>(null);
	const [adding, setAdding] = useState(false);
	const [whole, setWhole] = useState(false);
	const [selected, setSelected] = useState<string | null>(null);
	const [session, setSession] = useState<string | null>(null);
	const [diagnosticOpen, setDiagnosticOpen] = useState(false);
	const [setupOpen, setSetupOpen] = useState(false);
	const [replanning, setReplanning] = useState(false);
	const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
	const [refusal, setRefusal] = useState<string | null>(null);
	const act = useAction();
	const study = useAction();

	useEffect(() => { if (missing) router.replace("/"); }, [missing, router]);

	const index = useMemo(() => indexCourse(course), [course]);
	const mastery = useMemo(() => new Map<string, Mastery>(Object.entries(course.mastery)), [course.mastery]);
	const goal = course.goals.find((g) => g.id === goalId) ?? nextGoal(course.goals, course.today) ?? course.goals.at(-1) ?? null;
	const scope = useMemo(() => (goal ? goalScope(course, goal, index) : null), [course, goal, index]);
	const building = BUILDING.has(course.build.status);
	const ready = course.concepts.length > 0;
	const all = useMemo(() => course.concepts.map((c) => c.id), [course.concepts]);
	const knowledge = useMemo(() => knowledgeOf(course, scope?.core ?? all, index), [course, scope, all, index]);

	const visible = useMemo(() => new Set(!whole && scope ? [...scope.core, ...scope.assumed] : all), [whole, scope, all]);
	const assumed = useMemo(() => new Set(!whole && scope ? scope.assumed : []), [whole, scope]);
	const hasPlan = !!goal && scheduled(goal).length > 0;
	const upcoming = goal ? currentSession(goal.plan, course.today) : undefined;
	const shown = (goal && session && goal.plan?.sessions.find((s) => s.id === session)) || upcoming;
	const todays = useMemo(() => new Set(shown && shown.status !== "done" ? shown.conceptIds : []), [shown]);

	/** Run a model-backed action; a "set up your models" refusal opens setup. */
	const guarded = <T,>(work: () => Promise<T>) => act.run(async () => {
		try { return await work(); } catch (error) { if (needsModels(error)) setSetupOpen(true); throw error; }
	});

	const addFiles = ({ files }: Dropped) => {
		setRefusal(null);
		const sorted = sortFiles(files);
		if (sorted.take.length === 0) { setRefusal(nothingRead(sorted.skipped)); return; }
		void guarded(async () => adopt(await sendFiles(course.id, sorted)));
	};
	const { over, zone, choose, picker } = useFileDrop(addFiles, !building && !act.busy);

	const open = async (start: () => Promise<{ chatId: string; prompt?: string }>) => {
		const { chatId, prompt } = await start();
		if (prompt) stashOpeningPrompt(chatId, prompt);
		router.push(`/chat/${chatId}`);
	};
	const startDiagnostic = () => goal && void guarded(async () => { adopt(await courseApi.startDiagnostic(course.id, goal.id)); setDiagnosticOpen(true); });
	const plan = (prefs?: PlanPrefs) => goal && void act.run(async () => { adopt(await courseApi.plan(course.id, goal.id, prefs)); setReplanning(false); setSession(null); });

	const menu: MenuItem[] = [
		...(!building ? [{ label: "Add material", onSelect: choose }] : []),
		...(ready && !adding && course.goals.length > 0 ? [{ label: "Add a goal", onSelect: () => setAdding(true) }] : []),
		...(hasPlan ? [{ label: "Change the plan", onSelect: () => setReplanning(true) }] : []),
		...(hasPlan && goal ? [{ label: "Copy calendar prompt", onSelect: () => void copyCalendarPrompt(course, goal) }] : []),
		...(goal && goal.diagnostic?.status !== "writing" ? [{ label: goal.diagnostic ? "Retake the diagnostic" : "Take the diagnostic", onSelect: startDiagnostic }] : []),
		...(goal ? [{ label: `Remove ${goal.title}`, confirm: "Click again to remove it", danger: true, onSelect: () => void act.run(async () => { adopt(await courseApi.deleteGoal(course.id, goal.id)); setGoalId(null); }) }] : []),
		{ label: "Delete this course", confirm: "Click again to delete it", danger: true, onSelect: () => void act.run(async () => { await courseApi.remove(course.id); router.replace("/"); }) },
	];

	return (
		<div {...zone} className="relative h-dvh overflow-hidden">
			<PageFrame aside={<MoreMenu items={menu} label="Course options" />}>
				<main className="mx-auto w-full max-w-[68rem] px-10 pt-24 [&>*]:max-w-[42rem]">
					<p><Link href="/" className="sy-focus rounded-sm font-ui text-sm text-muted-foreground transition-colors hover:text-foreground">Courses</Link></p>
					<h1 className="mt-2 font-title text-[38px] leading-[1.1]" data-testid="course-title"><Tex>{course.title}</Tex></h1>
					<Material course={course} />
					{refusal && <p role="alert" className="mt-3 font-ui text-sm text-error">{refusal}</p>}
					{picker}

					{building ? (
						<BuildProgress course={course} />
					) : !ready ? (
						<div className="mt-14">
							<h2 className="font-title text-[28px] leading-tight">{course.build.status === "failed" ? "The map couldn't be built." : "Add your material."}</h2>
							<p className="mt-3 font-ui text-lg leading-relaxed text-muted-foreground">
								{course.build.error ?? "Drop a textbook, slides, a syllabus or your notes anywhere on this page. A whole folder works too."}
							</p>
							<div className="mt-6 flex items-center gap-4">
								{course.sources.length > 0
									? <PrimaryButton disabled={act.busy} onClick={() => void guarded(async () => adopt(await courseApi.rebuild(course.id)))}>Try again</PrimaryButton>
									: <PrimaryButton onClick={choose} disabled={act.busy}>{act.busy ? "Reading…" : "Choose files"}</PrimaryButton>}
								{course.build.code && <LinkButton onClick={() => setSetupOpen(true)}>Choose your models</LinkButton>}
							</div>
						</div>
					) : adding || !goal || !scope ? (
						<div className="mt-14">
							<GoalForm
								course={course}
								onCancel={course.goals.length > 0 ? () => setAdding(false) : undefined}
								onCreated={(next, newId) => { adopt(next); setGoalId(newId); setAdding(false); setWhole(false); }}
							/>
						</div>
					) : (
						<>
							{course.goals.length > 1 && (
								<nav className="mt-8 flex flex-wrap gap-x-5 gap-y-1" aria-label="Goals">
									{course.goals.map((g) => (
										<button
											key={g.id}
											type="button"
											onClick={() => { setGoalId(g.id); setSession(null); setReplanning(false); }}
											aria-current={goal.id === g.id}
											className={cn("sy-focus rounded-sm font-ui text-[15px] transition-colors", goal.id === g.id ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
										>
											<span className={cn(goal.id === g.id && "sy-hl-half")}>{g.title}</span>
										</button>
									))}
								</nav>
							)}

							<p className={cn("font-ui text-[17px]", course.goals.length > 1 ? "mt-8" : "mt-12")} data-testid="goal-line">
								<span className="font-semibold">{goal.title}</span>{" "}
								{daysBetween(course.today, goal.date) >= 0 ? `is ${awayDays(daysBetween(course.today, goal.date))}` : `was ${awayDays(daysBetween(course.today, goal.date))}`}
								<span className="text-muted-foreground">, {longDay(goal.date)}</span>
							</p>
							{knowledge.value !== null ? (
								<Meter knowledge={knowledge} of={goal.title} className="mt-5" />
							) : (
								// Nothing to show on the meter yet: one line, so the first step leads.
								<p className="mt-1.5 font-ui text-[15px] text-muted-foreground" data-testid="knowledge-meter" data-value="">
									Your meter isn't set yet. Your first answers set it.
								</p>
							)}

							<div className={knowledge.value !== null ? "mt-14" : "mt-11"} data-testid="next-step">
								<NextStep
									course={course}
									goal={goal}
									index={index}
									shown={shown}
									hasPlan={hasPlan}
									replanning={replanning}
									skipped={skipped.has(goal.id)}
									busy={act.busy}
									onStartDiagnostic={startDiagnostic}
									onOpenDiagnostic={() => setDiagnosticOpen(true)}
									onSkip={() => setSkipped((prev) => new Set(prev).add(goal.id))}
									onPlan={plan}
									onCancelReplan={() => setReplanning(false)}
									onOpenSession={(s) => void act.run(() => open(() => courseApi.startSession(course.id, goal.id, s.id)))}
									onCompleteSession={(s) => void act.run(async () => { adopt(await courseApi.completeSession(course.id, goal.id, s.id)); setSession(null); })}
								/>
								<ErrorNote error={act.error} className="mt-3" />
							</div>

							{hasPlan && !replanning && (
								<>
									<div className="mt-10">
										<DayStrip goal={goal} today={course.today} selected={shown?.id ?? null} onSelect={setSession} />
									</div>
									<PlanView
										course={course}
										goal={goal}
										index={index}
										mastery={mastery}
										adopt={adopt}
										onPick={setSession}
										onChanged={() => setSession(null)}
										onNeedsModels={() => setSetupOpen(true)}
									/>
								</>
							)}
						</>
					)}
					{(!ready || adding || !goal) && <ErrorNote error={act.error} className="mt-3" />}
				</main>

				{ready && !building && (
					<section className="mx-auto mt-24 w-full max-w-[68rem] px-10 pb-32" aria-label="Course map">
						<div className="mb-6 flex items-baseline justify-between gap-6">
							<p className="font-ui text-[15px]">
								<span className="font-semibold">{!whole && goal ? `What ${goal.title} covers` : "The whole course"}</span>
								{goal && <LinkButton onClick={() => setWhole((w) => !w)} className="ml-3">{whole ? `Only ${goal.title}` : "Whole course"}</LinkButton>}
							</p>
							<MapLegend next={todays.size > 0} />
						</div>
						<ConceptMap course={course} index={index} mastery={mastery} visible={visible} assumed={assumed} today={todays} selected={selected} onSelect={setSelected} />
					</section>
				)}
			</PageFrame>

			{selected && index.byId.has(selected) && (
				<ConceptDetail
					course={course}
					index={index}
					mastery={mastery}
					conceptId={selected}
					onSelect={setSelected}
					onClose={() => setSelected(null)}
					onStudy={goal ? () => void study.run(() => open(() => courseApi.studyConcept(course.id, goal.id, selected))) : undefined}
					studying={study.busy}
					studyError={study.error}
				/>
			)}

			{diagnosticOpen && goal?.diagnostic && goal.diagnostic.status !== "writing" && goal.diagnostic.status !== "failed" && (
				<DiagnosticRun course={course} goal={goal} adopt={adopt} onClose={() => setDiagnosticOpen(false)} onPlan={() => setDiagnosticOpen(false)} />
			)}

			{over && !building && (
				<div className="pointer-events-none absolute inset-3 z-50 flex items-center justify-center rounded-2xl border-2 border-dashed border-[color:var(--sy-hl)] bg-background/90">
					<p className="font-title text-3xl"><span className="sy-hl">Drop to add to this course</span></p>
				</div>
			)}

			<SetupDialog open={setupOpen} onClose={() => setSetupOpen(false)} onDone={() => setSetupOpen(false)} />
		</div>
	);
}

const LEAD = "font-title text-[28px] leading-tight";
const SUB = "mt-2 max-w-[34rem] font-ui text-base leading-relaxed text-muted-foreground";

/** The one thing to do next for a goal: take the diagnostic, build the
 *  plan, or study the session that is due. */
function NextStep({
	course, goal, index, shown, hasPlan, replanning, skipped, busy,
	onStartDiagnostic, onOpenDiagnostic, onSkip, onPlan, onCancelReplan, onOpenSession, onCompleteSession,
}: {
	course: CourseView;
	goal: Goal;
	index: CourseIndex;
	shown: PlanSession | undefined;
	hasPlan: boolean;
	replanning: boolean;
	skipped: boolean;
	busy: boolean;
	onStartDiagnostic: () => void;
	onOpenDiagnostic: () => void;
	onSkip: () => void;
	onPlan: (prefs?: PlanPrefs) => void;
	onCancelReplan: () => void;
	onOpenSession: (session: PlanSession) => void;
	onCompleteSession: (session: PlanSession) => void;
}) {
	const d = goal.diagnostic;
	const budget = useMemo(() => diagnosticBudget(diagnosticCandidates(course, goal, index).length), [course, goal, index]);
	const overdue = overdueSessions(goal.plan, course.today).filter(isScheduled);

	if (d?.status === "writing") {
		return (
			<div role="status">
				<h2 className={LEAD}>Writing your diagnostic…</h2>
				<p className={SUB}>{d.questions.length > 0 ? `${d.questions.length} questions so far.` : "This takes about a minute."}</p>
			</div>
		);
	}
	if (d?.status === "failed") {
		return (
			<div>
				<h2 className={LEAD}>The diagnostic couldn't be written.</h2>
				<p className={SUB}>{d.error}</p>
				<PrimaryButton onClick={onStartDiagnostic} disabled={busy} className="mt-5">Try again</PrimaryButton>
			</div>
		);
	}
	if (d && (d.status === "ready" || d.status === "in-progress")) {
		return (
			<div>
				<h2 className={LEAD}>{d.status === "ready" ? "Your diagnostic is ready." : "Your diagnostic is waiting."}</h2>
				<p className={SUB}>
					{d.status === "ready" ? `At most ${budget} questions. It stops as soon as it knows enough.` : `${d.answers.length} answered so far.`}
				</p>
				<PrimaryButton onClick={onOpenDiagnostic} className="mt-5" data-testid="diagnostic-open">{d.status === "ready" ? "Start" : "Continue"}</PrimaryButton>
			</div>
		);
	}
	if (!hasPlan && !d && !skipped) {
		return (
			<div>
				<h2 className={LEAD}>First, find out where you stand.</h2>
				<p className={SUB}>A diagnostic of at most {budget} questions sets your meter, so your plan only spends time on what you don't know yet.</p>
				<div className="mt-5 flex flex-wrap items-center gap-5">
					<PrimaryButton onClick={onStartDiagnostic} disabled={busy} data-testid="diagnostic-start">{busy ? "Starting…" : "Take the diagnostic"}</PrimaryButton>
					<LinkButton onClick={onSkip}>Skip it</LinkButton>
				</div>
			</div>
		);
	}
	if (!hasPlan || replanning) {
		return <PlanSetup initial={goal.plan?.prefs ?? DEFAULT_PLAN_PREFS} busy={busy} again={hasPlan} onBuild={onPlan} onCancel={hasPlan ? onCancelReplan : undefined} />;
	}
	if (overdue.length > 0) {
		return (
			<div>
				<h2 className={LEAD}>{overdue.length === 1 ? "A session slipped past." : `${overdue.length} sessions slipped past.`}</h2>
				<p className={SUB}>The plan can be laid out again over the days that are left.</p>
				<PrimaryButton onClick={() => onPlan()} disabled={busy} className="mt-5" data-testid="plan-rebuild">Rebuild the plan</PrimaryButton>
			</div>
		);
	}
	if (!shown) return <h2 className={LEAD}>Every session in this plan is done.</h2>;

	const done = shown.status === "done";
	// A session named after its unit says what it covers underneath.
	const covers = shown.kind === "learn" && shown.conceptIds.length > 2
		? shown.conceptIds.flatMap((id) => index.byId.get(id)?.title ?? [])
		: [];
	const when = shown.date === course.today ? "Today" : `${weekdayShort(shown.date)} ${dayMonth(shown.date)}`;
	return (
		<div data-testid="session-card">
			<p className="font-ui text-sm text-muted-foreground">{when}{done ? ", done" : ""}</p>
			<h2 className={cn(LEAD, "mt-1")}>{done ? <span className="sy-hl"><Tex>{shown.title}</Tex></span> : <Tex>{shown.title}</Tex>}</h2>
			{covers.length > 0 && (
				<p className="mt-3 max-w-[38rem] font-ui text-[15px] leading-relaxed text-muted-foreground" data-testid="session-concepts">
					{covers.map((title, i) => <span key={i}>{i > 0 && <span className="mx-2 text-border" aria-hidden="true">/</span>}<Tex>{title}</Tex></span>)}
				</p>
			)}
			<div className="mt-5 flex flex-wrap items-center gap-5">
				<PrimaryButton onClick={() => onOpenSession(shown)} disabled={busy} data-testid="session-start">
					{done ? "Open" : shown.chatId ? "Continue" : "Start"}
				</PrimaryButton>
				{!done && <span className="font-ui text-sm text-muted-foreground">{duration(shown.minutes)}</span>}
				{!done && shown.chatId && <LinkButton onClick={() => onCompleteSession(shown)} disabled={busy}>Mark done</LinkButton>}
			</div>
		</div>
	);
}

const WEEK = [
	{ day: 1, label: "M", name: "Monday" }, { day: 2, label: "T", name: "Tuesday" }, { day: 3, label: "W", name: "Wednesday" },
	{ day: 4, label: "T", name: "Thursday" }, { day: 5, label: "F", name: "Friday" }, { day: 6, label: "S", name: "Saturday" }, { day: 0, label: "S", name: "Sunday" },
];

/** How much time, on which days — everything the planner needs to ask. */
function PlanSetup({ initial, busy, again, onBuild, onCancel }: {
	initial: PlanPrefs;
	busy: boolean;
	again: boolean;
	onBuild: (prefs: PlanPrefs) => void;
	onCancel?: () => void;
}) {
	const [minutes, setMinutes] = useState(initial.minutesPerDay);
	const [weekdays, setWeekdays] = useState<Set<number>>(new Set(initial.weekdays));
	const step = (by: number) => setMinutes((m) => Math.min(240, Math.max(15, m + by)));
	const toggle = (day: number) => setWeekdays((prev) => {
		const next = new Set(prev);
		if (next.has(day)) { if (next.size > 1) next.delete(day); } else next.add(day);
		return next;
	});
	const ROUND = "sy-focus inline-flex size-9 items-center justify-center rounded-full border border-border font-ui text-[15px] transition-colors hover:bg-accent";
	return (
		<div data-testid="plan-setup">
			<h2 className={LEAD}>How much time can you give it?</h2>
			<div className="mt-6 flex flex-wrap items-center gap-x-10 gap-y-5">
				<div className="flex items-center gap-3">
					<button type="button" className={ROUND} onClick={() => step(-15)} aria-label="Fifteen minutes less">−</button>
					<p className="w-28 text-center font-ui text-sm text-muted-foreground"><span className="font-title text-3xl text-foreground tabular-nums">{minutes}</span> min a day</p>
					<button type="button" className={ROUND} onClick={() => step(15)} aria-label="Fifteen minutes more">+</button>
				</div>
				<div className="flex items-center gap-1.5" role="group" aria-label="Study days">
					{WEEK.map(({ day, label, name }) => (
						<button key={day} type="button" aria-pressed={weekdays.has(day)} aria-label={name} onClick={() => toggle(day)}
							className={cn(ROUND, weekdays.has(day) ? "border-foreground bg-foreground text-background hover:bg-foreground/90" : "text-muted-foreground")}>
							{label}
						</button>
					))}
				</div>
			</div>
			<div className="mt-7 flex items-center gap-5">
				<PrimaryButton onClick={() => onBuild({ minutesPerDay: minutes, weekdays: [...weekdays].sort() })} disabled={busy} data-testid="plan-build">
					{busy ? "Planning…" : again ? "Rebuild the plan" : "Build my plan"}
				</PrimaryButton>
				{onCancel && <LinkButton onClick={onCancel}>Cancel</LinkButton>}
			</div>
		</div>
	);
}

const PHASE: Record<string, string> = {
	reading: "Opening your material…",
	mapping: "Reading your material…",
	organizing: "Putting the map in order…",
};

/** The map being built: how far along, and the concepts found so far
 *  arriving one by one. */
/**
 * What the course was built from. One file needs no list; several fold
 * into a line that opens into every file, how much of each was read, and
 * the ones that could not be read with what to do about them.
 */
function Material({ course }: { course: CourseView }) {
	const [open, setOpen] = useState(false);
	const unread = course.skipped ?? [];
	const { sources } = course;
	if (sources.length <= 1 && unread.length === 0) {
		const only = sources[0];
		return only?.notice ? <p className="mt-2 font-ui text-sm text-muted-foreground">{only.name}: {only.notice}</p> : null;
	}
	return (
		<div className="mt-2 font-ui text-sm text-muted-foreground" data-testid="material">
			<button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="sy-focus group inline-flex items-center gap-1.5 rounded-sm text-left transition-colors hover:text-foreground">
				<span>
					{sources.length} {sources.length === 1 ? "file" : "files"}
					{unread.length > 0 && <span className="text-foreground"> · {unread.length} {unread.length === 1 ? "wasn't" : "weren't"} read</span>}
				</span>
				<ChevronDownIcon className={cn("size-3.5 transition-transform duration-150", open && "rotate-180")} aria-hidden="true" />
			</button>
			{open && (
				<ul className="mt-3 max-h-[19rem] space-y-2 overflow-y-auto border-l border-border pl-4" data-testid="material-list">
					{sources.map((s) => (
						<li key={s.id}>
							<p className="flex items-baseline gap-4">
								<span className="min-w-0 flex-1 truncate text-foreground" title={s.name}>{s.name}</span>
								<span className="shrink-0 tabular-nums">{sourceSize(s)}</span>
							</p>
							{s.notice && <p className="text-[13px]">{s.notice}</p>}
						</li>
					))}
					{unread.map((file, i) => (
						<li key={`${i}:${file.name}`} data-testid="material-unread">
							<p className="truncate text-foreground" title={file.name}>{file.name} <span className="text-error">wasn't read</span></p>
							<p className="text-[13px]">{file.reason}</p>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

function BuildProgress({ course }: { course: CourseView }) {
	const { status, done, total, found } = course.build;
	const recent = found.slice(-36);
	return (
		<div className="mt-14" role="status" data-testid="build-progress">
			<h2 className={LEAD}>{PHASE[status] ?? "Working…"}</h2>
			<p className={SUB}>
				{status === "mapping" && total > 0
					? `Part ${Math.min(done + 1, total)} of ${total}. ${found.length} ${found.length === 1 ? "concept" : "concepts"} so far.`
					: status === "organizing"
						? `${found.length} concepts found. Linking what depends on what.`
						: "A whole textbook takes a few minutes. You can leave this page."}
			</p>
			<Stroke value={status === "organizing" ? 0.96 : total > 0 ? (done / total) * 0.92 : 0.02} label="Building the map" className="mt-6" />
			<ul className="mt-8 flex flex-wrap gap-x-5 gap-y-1.5 font-ui text-[15px] text-muted-foreground">
				{recent.map((title, i) => <li key={`${found.length - recent.length + i}:${title}`} className="sy-found"><Tex>{title}</Tex></li>)}
			</ul>
		</div>
	);
}
