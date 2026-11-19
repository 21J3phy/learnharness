/**
 * COURSES — the layer this fork adds on top of LearnHarness.
 *
 * A course is built from the learner's own material (a textbook, a
 * syllabus, lecture notes): units, concepts, and the prerequisite links
 * between them. On top of that map sit GOALS (a midterm on a date, a quiz
 * next Friday), each with a diagnostic, a dated study plan, and the
 * teaching sessions that plan opens.
 *
 * This module is pure: record shapes plus the deterministic algorithms
 * (mastery from evidence, the diagnostic's next-question choice, the
 * scheduler). No IO, no model calls — those live in src/store/courses.ts,
 * src/agent/subagents/course-agents.ts and src/server/courses.ts.
 */

export const COURSE_FORMAT_VERSION = 1;

// ─── record shapes ───────────────────────────────────────────────────────────

export type ConceptKind = "definition" | "theorem" | "technique" | "idea";
export const CONCEPT_KINDS: readonly ConceptKind[] = ["definition", "theorem", "technique", "idea"];

/** One file the learner dropped in. The converted text lives beside the
 *  record (store: sources/<id>.json), never inside it. */
export interface CourseSource {
	id: string;
	name: string;
	kind: "pdf" | "text";
	/** Pages with text (PDF) or 1 for plain text. */
	pages: number;
	chars: number;
	addedAt: string;
	/** Shown beside the source (e.g. skipped scanned pages). */
	notice?: string;
}

export interface CourseUnit {
	id: string;
	title: string;
	summary?: string;
}

/** Where in the material a concept is taught. */
export interface ConceptRef {
	sourceId: string;
	from: number;
	to: number;
}

export interface CourseConcept {
	/** A permanent lowercase slug — also a valid lesson-plan node id, so a
	 *  teaching session's checks can be traced back to the concept. */
	id: string;
	unitId: string;
	title: string;
	summary: string;
	kind: ConceptKind;
	/** Ids of the concepts this one depends on. */
	prereqs: string[];
	refs: ConceptRef[];
}

export type EvidenceSource = "diagnostic" | "session" | "manual";

/** One observation of the learner on one concept. Mastery is always
 *  DERIVED by folding these in time order — never stored. */
export interface Evidence {
	/** Idempotency key (a chat check is folded at most once). */
	id: string;
	conceptId: string;
	correct: boolean;
	at: string;
	source: EvidenceSource;
	goalId?: string;
	chatId?: string;
}

export type GoalKind = "midterm" | "final" | "test" | "quiz" | "assignment" | "other";
export const GOAL_KINDS: readonly GoalKind[] = ["midterm", "final", "test", "quiz", "assignment", "other"];

export interface DiagnosticQuestion {
	id: string;
	conceptId: string;
	/** Markdown with LaTeX. */
	question: string;
	options: string[];
	correctIndex: number;
	explanation: string;
}

export interface DiagnosticAnswer {
	questionId: string;
	conceptId: string;
	/** null = "I don't know". */
	choice: number | null;
	correct: boolean;
	at: string;
}

export interface Diagnostic {
	status: "writing" | "ready" | "in-progress" | "done" | "failed";
	questions: DiagnosticQuestion[];
	answers: DiagnosticAnswer[];
	error?: string;
	startedAt?: string;
	completedAt?: string;
}

export type PlanSessionKind = "learn" | "review" | "practice";

export interface PlanSession {
	id: string;
	/** Local calendar day, YYYY-MM-DD. */
	date: string;
	kind: PlanSessionKind;
	title: string;
	conceptIds: string[];
	minutes: number;
	status: "upcoming" | "done";
	chatId?: string;
	completedAt?: string;
}

export interface PlanPrefs {
	minutesPerDay: number;
	/** Days of the week the learner studies (0 = Sunday … 6 = Saturday). */
	weekdays: number[];
}

export const DEFAULT_PLAN_PREFS: PlanPrefs = { minutesPerDay: 45, weekdays: [0, 1, 2, 3, 4, 5, 6] };

export interface Plan {
	createdAt: string;
	prefs: PlanPrefs;
	sessions: PlanSession[];
	/** Set when the material does not fit the stated time: the minutes per
	 *  study day the plan actually needs. */
	neededMinutesPerDay?: number;
}

export interface Goal {
	id: string;
	title: string;
	kind: GoalKind;
	/** The day of the exam, YYYY-MM-DD. */
	date: string;
	/** The units the goal covers. */
	unitIds: string[];
	note?: string;
	createdAt: string;
	diagnostic?: Diagnostic;
	plan?: Plan;
}

/** An assessment found in the material (a syllabus usually lists them). */
export interface SuggestedGoal {
	title: string;
	kind: GoalKind;
	/** YYYY-MM-DD, or absent when the material gave no usable date. */
	date?: string;
	unitIds: string[];
	note?: string;
}

export type BuildStatus = "idle" | "reading" | "mapping" | "organizing" | "ready" | "failed";

/** Progress of turning the material into the map. */
export interface BuildState {
	status: BuildStatus;
	/** Parts of the material read so far / in total (mapping phase). */
	done: number;
	total: number;
	/** Concept titles found so far — the live preview while the map builds. */
	found: string[];
	error?: string;
	/** Machine code for refusals the UI can act on. */
	code?: "models_not_configured" | "provider_key_missing";
	startedAt?: string;
}

export interface Course {
	id: string;
	version: number;
	title: string;
	createdAt: string;
	updatedAt: string;
	sources: CourseSource[];
	units: CourseUnit[];
	concepts: CourseConcept[];
	evidence: Evidence[];
	goals: Goal[];
	suggestions: SuggestedGoal[];
	build: BuildState;
}

/** The list view's row. */
export interface CourseSummary {
	id: string;
	title: string;
	updatedAt: string;
	status: BuildStatus;
	conceptCount: number;
	solidCount: number;
	/** 0–1, how much of the course is highlighted. */
	progress: number;
	/** The knowledge meter of the next goal (or of the whole course when
	 *  no goal is set), 0–1; `measured` is false before any answer. */
	knowledge: number;
	measured: boolean;
	nextGoal?: { id: string; title: string; date: string; daysLeft: number };
}

// ─── ids and dates ───────────────────────────────────────────────────────────

/** A lesson-plan-safe slug: lowercase words joined by hyphens. */
export function slugify(text: string): string {
	const slug = text
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48)
		.replace(/-+$/g, "");
	return slug || "concept";
}

/** `base`, or `base-2`, `base-3`… — the first not in `taken`. Adds it. */
export function uniqueSlug(base: string, taken: Set<string>): string {
	let id = base;
	for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
	taken.add(id);
	return id;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDay(value: unknown): value is string {
	if (typeof value !== "string" || !DAY_RE.test(value)) return false;
	const d = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** The local calendar day of a Date. */
export function dayOf(date: Date): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, "0");
	const d = String(date.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

export function addDays(day: string, n: number): string {
	const d = new Date(`${day}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + n);
	return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
	return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function weekdayOf(day: string): number {
	return new Date(`${day}T00:00:00Z`).getUTCDay();
}

// ─── the map ─────────────────────────────────────────────────────────────────

export interface CourseIndex {
	byId: Map<string, CourseConcept>;
	/** concept → the concepts that list it as a prerequisite (backlinks). */
	dependents: Map<string, string[]>;
	/** Every concept, prerequisites first; ties keep the course's order. */
	order: string[];
	/** Position in `order`. */
	rank: Map<string, number>;
}

/** Index the concept graph. Unknown prerequisite ids are ignored, and any
 *  cycle is broken at the back-edge, so every consumer sees a DAG. */
export function indexCourse(course: Pick<Course, "concepts" | "units">): CourseIndex {
	const byId = new Map(course.concepts.map((c) => [c.id, c]));
	const unitOrder = new Map(course.units.map((u, i) => [u.id, i]));
	const position = new Map(course.concepts.map((c, i) => [c.id, i]));
	const tie = (a: string, b: string) => {
		const ca = byId.get(a)!, cb = byId.get(b)!;
		return (unitOrder.get(ca.unitId) ?? 1e9) - (unitOrder.get(cb.unitId) ?? 1e9) || position.get(a)! - position.get(b)!;
	};
	const prereqs = new Map<string, string[]>();
	for (const c of course.concepts) {
		prereqs.set(c.id, [...new Set(c.prereqs.filter((p) => p !== c.id && byId.has(p)))]);
	}
	// Kahn's algorithm with a stable tie-break; leftovers are in a cycle.
	const remaining = new Map([...prereqs].map(([id, ps]) => [id, new Set(ps)]));
	const order: string[] = [];
	const placed = new Set<string>();
	while (order.length < course.concepts.length) {
		let ready = [...remaining].filter(([, ps]) => ps.size === 0).map(([id]) => id);
		if (ready.length === 0) {
			// A cycle: release the earliest concept by dropping its unmet edges.
			const [first] = [...remaining.keys()].sort(tie);
			prereqs.set(first!, prereqs.get(first!)!.filter((p) => placed.has(p)));
			ready = [first!];
		}
		ready.sort(tie);
		const next = ready[0]!;
		order.push(next);
		placed.add(next);
		remaining.delete(next);
		for (const ps of remaining.values()) ps.delete(next);
	}
	const dependents = new Map<string, string[]>(course.concepts.map((c) => [c.id, []]));
	for (const [id, ps] of prereqs) for (const p of ps) dependents.get(p)!.push(id);
	// Consumers read prerequisites through the index's cleaned edges.
	for (const [id, ps] of prereqs) byId.set(id, { ...byId.get(id)!, prereqs: ps });
	return { byId, dependents, order, rank: new Map(order.map((id, i) => [id, i])) };
}

/** Everything reachable through `next`, with its distance (start excluded). */
function reach(start: string, next: (id: string) => readonly string[]): Map<string, number> {
	const seen = new Map<string, number>();
	let frontier = [start];
	for (let depth = 1; frontier.length > 0; depth++) {
		const layer: string[] = [];
		for (const id of frontier) {
			for (const n of next(id)) {
				if (n === start || seen.has(n)) continue;
				seen.set(n, depth);
				layer.push(n);
			}
		}
		frontier = layer;
	}
	return seen;
}

export function ancestorsOf(index: CourseIndex, id: string): Map<string, number> {
	return reach(id, (c) => index.byId.get(c)?.prereqs ?? []);
}

export function descendantsOf(index: CourseIndex, id: string): Map<string, number> {
	return reach(id, (c) => index.dependents.get(c) ?? []);
}

// ─── mastery ─────────────────────────────────────────────────────────────────

export type MasteryState = "untested" | "new" | "shaky" | "solid";

export interface Mastery {
	/** Estimated probability the learner holds the concept, 0–1. */
	p: number;
	state: MasteryState;
	/** Direct observations on this concept. */
	direct: number;
	/** Observations on neighbours that moved this estimate. */
	inferred: number;
	lastAt?: string;
}

/** The estimate before anything is known. */
export const PRIOR = 0.3;
export const SOLID_AT = 0.7;
export const SHAKY_AT = 0.4;

function stateOf(p: number, observed: boolean): MasteryState {
	if (!observed) return "untested";
	return p >= SOLID_AT ? "solid" : p >= SHAKY_AT ? "shaky" : "new";
}

/**
 * Fold the evidence, oldest first, into an estimate per concept.
 *
 * A right answer lifts the concept and — more weakly, fading with distance —
 * its prerequisites (you could not have got it right without them). A wrong
 * answer drops the concept and, fading the same way, everything built on it.
 * A direct observation always outweighs an inferred one.
 *
 * `onStep` sees the running estimates after each piece of evidence — the
 * knowledge meter's history is read from it.
 */
function foldEvidence(
	course: Pick<Course, "concepts" | "units" | "evidence">,
	index: CourseIndex,
	onStep?: (evidence: Evidence, estimates: ReadonlyMap<string, { p: number; direct: number; inferred: number }>) => void,
): Map<string, { p: number; direct: number; inferred: number; lastAt?: string }> {
	const m = new Map<string, { p: number; direct: number; inferred: number; lastAt?: string }>(
		course.concepts.map((c) => [c.id, { p: PRIOR, direct: 0, inferred: 0 }]),
	);
	const ancestors = new Map<string, Map<string, number>>();
	const descendants = new Map<string, Map<string, number>>();
	const evidence = [...course.evidence].sort((a, b) => a.at.localeCompare(b.at));
	for (const e of evidence) {
		const self = m.get(e.conceptId);
		if (!self) continue;
		const weight = e.source === "manual" ? 0.5 : 1;
		if (e.correct) {
			self.p += (1 - self.p) * 0.6 * weight;
			if (!ancestors.has(e.conceptId)) ancestors.set(e.conceptId, ancestorsOf(index, e.conceptId));
			for (const [id, d] of ancestors.get(e.conceptId)!) {
				const a = m.get(id)!;
				// Deliberately modest: one right answer (a quarter of them are
				// guesses) must not mark a prerequisite solid on its own. It
				// takes a second supporting answer, or a direct one.
				a.p += (1 - a.p) * 0.45 * 0.7 ** (d - 1) * weight;
				a.inferred++;
			}
		} else {
			self.p *= 1 - 0.65 * weight;
			if (!descendants.has(e.conceptId)) descendants.set(e.conceptId, descendantsOf(index, e.conceptId));
			for (const [id, d] of descendants.get(e.conceptId)!) {
				const a = m.get(id)!;
				a.p *= 1 - 0.3 * 0.6 ** (d - 1) * weight;
				a.inferred++;
			}
		}
		self.direct++;
		self.lastAt = e.at;
		onStep?.(e, m);
	}
	return m;
}

export function masteryOf(course: Pick<Course, "concepts" | "units" | "evidence">, index = indexCourse(course)): Map<string, Mastery> {
	return new Map([...foldEvidence(course, index)].map(([id, v]) => [id, { ...v, state: stateOf(v.p, v.direct + v.inferred > 0) }]));
}

// ─── the knowledge meter ─────────────────────────────────────────────────────

export interface KnowledgePoint {
	at: string;
	/** The estimate after this answer, 0–1. */
	value: number;
}

/**
 * The knowledge meter over a set of concepts (a goal's, or the course's):
 * the share of them the learner is estimated to hold.
 *
 * It is first set by the diagnostic and then moves with every graded
 * answer after it — a check in a teaching session counts exactly like a
 * diagnostic question. `history` is the estimate after each answer that
 * touched the set, so the meter can show itself being refined.
 */
export interface Knowledge {
	/** null until at least one answer bears on these concepts. */
	value: number | null;
	/** Answers that bear on these concepts. */
	answers: number;
	/** Concepts with a direct answer of their own / in the set. */
	measured: number;
	total: number;
	history: KnowledgePoint[];
}

export function knowledgeOf(
	course: Pick<Course, "concepts" | "units" | "evidence">,
	ids: readonly string[],
	index = indexCourse(course),
): Knowledge {
	const set = new Set(ids.filter((id) => index.byId.has(id)));
	const history: KnowledgePoint[] = [];
	if (set.size === 0) return { value: null, answers: 0, measured: 0, total: 0, history };
	const mean = (m: ReadonlyMap<string, { p: number }>) => {
		let sum = 0;
		for (const id of set) sum += m.get(id)!.p;
		return sum / set.size;
	};
	let before = PRIOR;
	let answers = 0;
	const final = foldEvidence(course, index, (e, m) => {
		const value = mean(m);
		// An answer bears on the set when it is on one of its concepts or
		// moved the estimate of one through the graph.
		if (!set.has(e.conceptId) && Math.abs(value - before) < 1e-9) return;
		before = value;
		answers++;
		history.push({ at: e.at, value });
	});
	let measured = 0;
	for (const id of set) if (final.get(id)!.direct > 0) measured++;
	return { value: answers > 0 ? mean(final) : null, answers, measured, total: set.size, history };
}

/** How much of a set of concepts is "highlighted": solid counts fully,
 *  partial knowledge counts partially. 0–1. */
export function progressOf(ids: readonly string[], mastery: Map<string, Mastery>): { progress: number; solid: number; total: number } {
	if (ids.length === 0) return { progress: 0, solid: 0, total: 0 };
	let sum = 0, solid = 0;
	for (const id of ids) {
		const s = mastery.get(id);
		if (!s || s.state === "untested") continue;
		if (s.state === "solid") solid++;
		sum += Math.min(1, s.p / SOLID_AT);
	}
	return { progress: sum / ids.length, solid, total: ids.length };
}

// ─── goals ───────────────────────────────────────────────────────────────────

export interface GoalScope {
	/** The concepts the goal examines, in learning order. */
	core: string[];
	/** Concepts outside the goal's units that its concepts rest on. */
	assumed: string[];
}

/** A goal's own small map: its units' concepts, plus the prerequisites
 *  from elsewhere in the course they depend on. */
export function goalScope(course: Pick<Course, "concepts" | "units">, goal: Pick<Goal, "unitIds">, index = indexCourse(course)): GoalScope {
	const units = new Set(goal.unitIds);
	const core = new Set(course.concepts.filter((c) => units.has(c.unitId)).map((c) => c.id));
	const assumed = new Set<string>();
	for (const id of core) {
		for (const a of ancestorsOf(index, id).keys()) if (!core.has(a)) assumed.add(a);
	}
	const sort = (ids: Set<string>) => [...ids].sort((a, b) => index.rank.get(a)! - index.rank.get(b)!);
	return { core: sort(core), assumed: sort(assumed) };
}

/** The soonest goal that has not passed (today counts). */
export function nextGoal(goals: readonly Goal[], today: string): Goal | undefined {
	return goals.filter((g) => g.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
}

// ─── the diagnostic ──────────────────────────────────────────────────────────

/** Which concepts the diagnostic may ask about: the goal's own, plus the
 *  outside prerequisites closest to it. */
export function diagnosticCandidates(course: Pick<Course, "concepts" | "units">, goal: Pick<Goal, "unitIds">, index = indexCourse(course)): string[] {
	const scope = goalScope(course, goal, index);
	const core = new Set(scope.core);
	const near = scope.assumed.filter((a) => (index.dependents.get(a) ?? []).some((d) => core.has(d)));
	return [...near, ...scope.core];
}

/** The most questions one diagnostic asks. */
export function diagnosticBudget(candidates: number): number {
	return Math.min(candidates, Math.max(6, Math.min(30, Math.ceil(candidates * 0.75))));
}

const settled = (p: number) => p >= SOLID_AT || p <= 0.22;

/**
 * Pick the concept whose answer tells us the most, or null when the picture
 * is clear enough to stop.
 *
 * Every answer also moves the estimates of the concepts around it, so a
 * well-chosen question resolves several at once. The score favours concepts
 * whose estimate is still near the middle AND that sit between many other
 * unresolved concepts — the same idea as a binary search down each strand.
 */
export function nextDiagnosticConcept(
	course: Pick<Course, "concepts" | "units" | "evidence">,
	goal: Pick<Goal, "unitIds" | "diagnostic">,
	index = indexCourse(course),
): string | null {
	const diagnostic = goal.diagnostic;
	if (!diagnostic) return null;
	const candidates = diagnosticCandidates(course, goal, index);
	const asked = new Set(diagnostic.answers.map((a) => a.conceptId));
	if (asked.size >= diagnosticBudget(candidates.length)) return null;
	const written = new Set(diagnostic.questions.map((q) => q.conceptId));
	const mastery = masteryOf(course, index);
	const open = new Set(candidates.filter((id) => !asked.has(id) && !settled(mastery.get(id)!.p)));
	let best: string | null = null, bestScore = -1;
	for (const id of candidates) {
		if (!open.has(id) || !written.has(id)) continue;
		const p = mastery.get(id)!.p;
		const uncertainty = 1 - Math.abs(2 * p - 1);
		let below = 0, above = 0;
		for (const a of ancestorsOf(index, id).keys()) if (open.has(a)) below++;
		for (const d of descendantsOf(index, id).keys()) if (open.has(d)) above++;
		const score = uncertainty * (1 + Math.min(below, above) + 0.25 * (below + above));
		if (score > bestScore) { best = id; bestScore = score; }
	}
	return best;
}

// ─── the plan ────────────────────────────────────────────────────────────────

const MINUTES_NEW = 20;
const MINUTES_SHAKY = 10;
const MINUTES_REVIEW = 15;
const MINUTES_PRACTICE = 45;

function sessionTitle(ids: readonly string[], course: Pick<Course, "concepts" | "units">, index: CourseIndex, todo: ReadonlySet<string>): string {
	const concepts = ids.map((id) => index.byId.get(id)!);
	const units = [...new Set(concepts.map((c) => c.unitId))];
	if (units.length === 1) {
		const unit = course.units.find((u) => u.id === units[0]);
		const whole = course.concepts.filter((c) => c.unitId === units[0] && todo.has(c.id)).every((c) => ids.includes(c.id));
		if (unit && whole) return unit.title;
	}
	if (concepts.length <= 2) return concepts.map((c) => c.title).join(", then ");
	return `${concepts[0]!.title}, ${concepts[1]!.title} and ${concepts.length - 2} more`;
}

/**
 * Lay the goal's unlearned concepts over the days that remain.
 *
 * Deterministic and instant, so it can be rebuilt whenever a day is missed
 * or the estimates change. Concepts are taken prerequisites-first and
 * packed into sessions of about the learner's daily budget; the sessions
 * are spread evenly over the study days; free days in between become short
 * reviews of what came before. With enough runway the last days are held
 * back for a practice exam and a final review.
 */
export function buildPlan(
	course: Pick<Course, "concepts" | "units" | "evidence">,
	goal: Pick<Goal, "unitIds" | "date" | "plan">,
	today: string,
	prefs: PlanPrefs = goal.plan?.prefs ?? DEFAULT_PLAN_PREFS,
	now: Date = new Date(),
): Plan {
	const index = indexCourse(course);
	const mastery = masteryOf(course, index);
	const scope = goalScope(course, goal, index);
	const kept = (goal.plan?.sessions ?? []).filter((s) => s.status === "done");
	const mk = (date: string, n: number) => `ps_${date.replaceAll("-", "")}_${n}`;

	const weekdays = prefs.weekdays.length > 0 ? prefs.weekdays : DEFAULT_PLAN_PREFS.weekdays;
	const minutesPerDay = Math.max(10, Math.round(prefs.minutesPerDay));
	const taken = new Set(kept.map((s) => s.date));
	let days: string[] = [];
	for (let d = today; d < goal.date; d = addDays(d, 1)) {
		if (weekdays.includes(weekdayOf(d)) && !taken.has(d)) days.push(d);
	}
	// Nothing before the exam fits the chosen weekdays: use today anyway.
	if (days.length === 0 && today <= goal.date && !taken.has(today)) days = [today];

	const solid = (id: string) => mastery.get(id)!.state === "solid";
	const todo = [...scope.assumed, ...scope.core].filter((id) => !solid(id)).sort((a, b) => index.rank.get(a)! - index.rank.get(b)!);
	const todoSet = new Set(todo);
	const cost = (id: string) => (mastery.get(id)!.state === "shaky" ? MINUTES_SHAKY : MINUTES_NEW);
	const total = todo.reduce((sum, id) => sum + cost(id), 0);

	const sessions: PlanSession[] = [...kept];
	if (days.length === 0) return { createdAt: now.toISOString(), prefs: { minutesPerDay, weekdays }, sessions };

	// Hold back the last days for practice and a final review when there is room.
	const reserve = total === 0 ? 0 : days.length >= 6 ? 2 : days.length >= 4 ? 1 : 0;
	const learnDays = days.slice(0, days.length - reserve);
	const reserved = days.slice(days.length - reserve);

	let needed: number | undefined;
	if (todo.length > 0) {
		const count = Math.min(learnDays.length, Math.max(1, Math.ceil(total / minutesPerDay)));
		const budget = total / count;
		if (budget > minutesPerDay * 1.25) needed = Math.ceil(budget / 5) * 5;
		// Pack prerequisites-first into `count` sessions of about `budget` minutes.
		const packs: string[][] = [];
		let current: string[] = [], spent = 0;
		for (const id of todo) {
			if (current.length > 0 && spent + cost(id) / 2 > budget && packs.length < count - 1) {
				packs.push(current);
				current = [];
				spent = 0;
			}
			current.push(id);
			spent += cost(id);
		}
		if (current.length > 0) packs.push(current);
		const used = new Set<number>();
		packs.forEach((ids, i) => {
			const at = Math.min(learnDays.length - 1, Math.floor((i * learnDays.length) / packs.length));
			used.add(at);
			sessions.push({
				id: mk(learnDays[at]!, i),
				date: learnDays[at]!,
				kind: "learn",
				title: sessionTitle(ids, course, index, todoSet),
				conceptIds: ids,
				minutes: Math.max(10, Math.round(ids.reduce((s, id) => s + cost(id), 0) / 5) * 5),
				status: "upcoming",
			});
		});
		// Free days between sessions: a short recall of what came before,
		// most recent material first — but only after two quiet days, so a
		// light plan stays light instead of filling every gap.
		let lastBusy = -3;
		learnDays.forEach((date, i) => {
			if (used.has(i)) { lastBusy = i; return; }
			if (i - lastBusy < 3 || used.has(i + 1)) return;
			const before = sessions.filter((s) => s.kind === "learn" && s.status === "upcoming" && s.date < date).sort((a, b) => b.date.localeCompare(a.date));
			const ids = before.slice(0, 2).flatMap((s) => s.conceptIds);
			if (ids.length === 0) return;
			lastBusy = i;
			sessions.push({ id: mk(date, 90), date, kind: "review", title: "Review", conceptIds: ids, minutes: MINUTES_REVIEW, status: "upcoming" });
		});
	}
	if (reserved.length === 2) {
		sessions.push({ id: mk(reserved[0]!, 91), date: reserved[0]!, kind: "practice", title: "Practice exam", conceptIds: scope.core, minutes: Math.max(MINUTES_PRACTICE, minutesPerDay), status: "upcoming" });
	}
	if (reserved.length >= 1) {
		const date = reserved.at(-1)!;
		sessions.push({ id: mk(date, 92), date, kind: "review", title: "Final review", conceptIds: scope.core, minutes: Math.min(minutesPerDay, 30), status: "upcoming" });
	}
	// Everything already solid: keep the knowledge warm until the day.
	if (todo.length === 0 && scope.core.length > 0) {
		const step = Math.max(1, Math.round(days.length / Math.min(3, days.length)));
		for (let i = 0; i < days.length; i += step) {
			const last = i + step >= days.length;
			sessions.push({ id: mk(days[i]!, 93), date: days[i]!, kind: last ? "practice" : "review", title: last ? "Practice exam" : "Review", conceptIds: scope.core, minutes: last ? MINUTES_PRACTICE : MINUTES_REVIEW, status: "upcoming" });
		}
	}
	sessions.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
	return { createdAt: now.toISOString(), prefs: { minutesPerDay, weekdays }, sessions, ...(needed ? { neededMinutesPerDay: needed } : {}) };
}

/** Upcoming sessions whose day has passed — the signal to rebuild the plan. */
export function overdueSessions(plan: Plan | undefined, today: string): PlanSession[] {
	return (plan?.sessions ?? []).filter((s) => s.status === "upcoming" && s.date < today);
}

/** The session to do now: today's, else the next upcoming one. */
export function currentSession(plan: Plan | undefined, today: string): PlanSession | undefined {
	const upcoming = (plan?.sessions ?? []).filter((s) => s.status === "upcoming").sort((a, b) => a.date.localeCompare(b.date));
	return upcoming.find((s) => s.date === today) ?? upcoming.find((s) => s.date > today) ?? upcoming[0];
}

// ─── evidence from a teaching session ────────────────────────────────────────

/** The slice of a chat record the fold reads (native message shapes). */
export interface SessionMessage {
	id?: string;
	role?: string;
	stopReason?: string;
	content?: unknown;
	toolCallId?: string;
	toolName?: string;
	isError?: boolean;
	details?: unknown;
	timestamp?: number;
}

const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Read a teaching session's graded checks as evidence. A check names the
 * lesson-plan node it is about; the session is told to use concept ids as
 * node ids, and a node whose TITLE matches a concept counts too.
 */
export function evidenceFromChat(
	chatId: string,
	messages: readonly SessionMessage[],
	concepts: readonly Pick<CourseConcept, "id" | "title">[],
	planNodes: readonly { id: string; title: string }[] = [],
): Evidence[] {
	const ids = new Set(concepts.map((c) => c.id));
	const byTitle = new Map(concepts.map((c) => [normalize(c.title), c.id]));
	const nodeTitle = new Map(planNodes.map((n) => [n.id, n.title]));
	const conceptFor = (nodeId: string): string | undefined => {
		if (ids.has(nodeId)) return nodeId;
		const title = nodeTitle.get(nodeId);
		return (title && byTitle.get(normalize(title))) ?? byTitle.get(normalize(nodeId.replaceAll("-", " ").replaceAll("_", " ")));
	};
	const calls = new Map<string, string>();
	const out: Evidence[] = [];
	for (const m of messages) {
		if (m.role === "assistant" && Array.isArray(m.content)) {
			for (const block of m.content as { type?: string; id?: string; name?: string; arguments?: { nodeId?: unknown } }[]) {
				if (block.type !== "toolCall" || block.name !== "quiz" || typeof block.id !== "string") continue;
				const nodeId = block.arguments?.nodeId;
				if (typeof nodeId === "string") calls.set(block.id, nodeId);
			}
		} else if (m.role === "toolResult" && m.toolName === "quiz" && !m.isError && typeof m.toolCallId === "string") {
			const details = m.details as { correct?: unknown; dismissed?: unknown; answeredAt?: unknown } | null | undefined;
			const nodeId = calls.get(m.toolCallId);
			if (!details || details.dismissed || typeof details.correct !== "boolean" || !nodeId) continue;
			const conceptId = conceptFor(nodeId);
			if (!conceptId) continue;
			out.push({
				id: `chat:${chatId}:${m.toolCallId}`,
				conceptId,
				correct: details.correct,
				at: typeof details.answeredAt === "string" ? details.answeredAt : new Date(m.timestamp ?? 0).toISOString(),
				source: "session",
				chatId,
			});
		}
	}
	return out;
}

// ─── a session's seeded opening ──────────────────────────────────────────────

/** A course session's chat is created with its context already in the
 *  record: a context marker, and the learner assessment as a concluded
 *  probe. Those seeded messages carry this id prefix, so the chat view can
 *  tell them from a conversation the learner has actually begun. */
export const COURSE_SEED_PREFIX = "seed_";

/** Has the learner's conversation begun? Seeded course context does not count. */
export function conversationBegun(messages: readonly { role: string; id?: string }[]): boolean {
	return messages.some((m) => m.role === "user" || (m.role === "assistant" && !(m.id ?? "").startsWith(COURSE_SEED_PREFIX)));
}

// ─── views ───────────────────────────────────────────────────────────────────

export function summarizeCourse(course: Course, today: string): CourseSummary {
	const index = indexCourse(course);
	const mastery = masteryOf(course, index);
	const all = course.concepts.map((c) => c.id);
	const { progress, solid } = progressOf(all, mastery);
	const goal = nextGoal(course.goals, today);
	const knowledge = knowledgeOf(course, goal ? goalScope(course, goal, index).core : all, index);
	return {
		id: course.id,
		title: course.title,
		updatedAt: course.updatedAt,
		status: course.build.status,
		conceptCount: course.concepts.length,
		solidCount: solid,
		progress,
		knowledge: knowledge.value ?? 0,
		measured: knowledge.value !== null,
		...(goal ? { nextGoal: { id: goal.id, title: goal.title, date: goal.date, daysLeft: daysBetween(today, goal.date) } } : {}),
	};
}

/** The record as the browser sees it: answer keys stay on the server
 *  until a question is answered. */
export function publicCourse(course: Course): Course {
	return {
		...course,
		goals: course.goals.map((g) => {
			if (!g.diagnostic) return g;
			const answered = new Set(g.diagnostic.answers.map((a) => a.questionId));
			return {
				...g,
				diagnostic: {
					...g.diagnostic,
					questions: g.diagnostic.questions.map((q) => (answered.has(q.id) ? q : { ...q, correctIndex: -1, explanation: "" })),
				},
			};
		}),
	};
}
