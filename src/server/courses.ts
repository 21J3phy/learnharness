/**
 * The course service (this fork's layer): everything between the routes
 * under app/api/courses and the store/agents.
 *
 *   material in  → addSources  → build (read parts → organize → the map)
 *   a goal       → createGoal  → startDiagnostic → answerDiagnostic → plan
 *   a plan day   → startSession (a LearnHarness teaching chat, opened with
 *                  the course context and the learner's diagnosed level)
 *   chats back   → syncCourse (graded checks become evidence on the map)
 *
 * Model work is user-initiated here, so engines are built with the "user"
 * purpose (subscription connections need no background-use consent).
 */

import type { Usage } from "@earendil-works/pi-ai";
import { piEngineForSpec, type PiEngine } from "../agent/models.ts";
import { convertPdf } from "../agent/subagents/pdf-ops.ts";
import {
	organizeCourse,
	readPart,
	writeQuestions,
	type FoundAssessment,
	type FoundConcept,
	type OrganizeInput,
	type QuestionInput,
} from "../agent/subagents/course-agents.ts";
import {
	COURSE_SEED_PREFIX,
	DEFAULT_PLAN_PREFS,
	buildPlan,
	currentSession,
	dayOf,
	daysBetween,
	diagnosticCandidates,
	evidenceFromChat,
	goalScope,
	indexCourse,
	isDay,
	knowledgeOf,
	masteryOf,
	nextDiagnosticConcept,
	overdueSessions,
	publicCourse,
	slugify,
	summarizeCourse,
	uniqueSlug,
	GOAL_KINDS,
	type Course,
	type CourseConcept,
	type CourseSource,
	type CourseSummary,
	type CourseUnit,
	type DiagnosticQuestion,
	type Evidence,
	type Goal,
	type GoalKind,
	type Mastery,
	type PlanPrefs,
	type PlanSession,
	type SuggestedGoal,
} from "../core/course.ts";
import { PROBE_DONE_ACK_TEXT, buildProbeHandoffSteer } from "../core/contracts.ts";
import { newMessageId, type LhMarkerMessage, type LhMessage } from "../core/native-messages.ts";
import { ModelsNotConfiguredError, ProviderKeyMissingError, PROVIDER_KEY_MISSING_CODE, type ModelSlotName } from "../core/settings.ts";
import { resolveSlot } from "../core/settings-resolution.ts";
import { courseStore, type SourcePage } from "../store/courses.ts";
import { deliverJobResult } from "./jobs.ts";
import { providerKeyPresent } from "./keys.ts";
import { stores } from "./stores.ts";

// ─── limits ──────────────────────────────────────────────────────────────────

export { MAX_COURSE_FILE_BYTES } from "../../lib/course-limits.ts";
const MAX_PDF_PAGES = 2000;
/** About 12k tokens of material per model call. */
const PART_CHARS = 48_000;
const MAX_PARTS = 60;
/** A whole course stays readable as one map at about this many concepts. */
const TARGET_CONCEPTS = 240;
/** A source this short is treated as an outline (a syllabus) and shown to
 *  the organizer verbatim. */
const OUTLINE_CHARS = 24_000;
const READ_CONCURRENCY = 3;
const QUESTION_BATCH = 5;
const MAX_DIAGNOSTIC_CONCEPTS = 48;
/** Material quoted into a teaching session's opening context. */
const SESSION_EXCERPT_CHARS = 14_000;

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
const SOURCE_EXTENSIONS = /\.(?:pdf|txt|md|markdown|rst|org|adoc|tex)$/i;

export class CourseError extends Error {
	constructor(message: string, readonly status: number = 400, readonly code?: string) {
		super(message);
		this.name = "CourseError";
	}
}

const today = () => dayOf(new Date());

// ─── engines ─────────────────────────────────────────────────────────────────

function engineFor(slot: ModelSlotName): PiEngine {
	const spec = resolveSlot(stores.settingsStore.readSettings()?.models?.[slot]);
	if (!spec) throw new ModelsNotConfiguredError([slot]);
	if (!providerKeyPresent(spec.provider)) throw new ProviderKeyMissingError(spec.provider, [slot]);
	return piEngineForSpec(spec, false, undefined, () => stores.settingsStore.readSettings()?.models?.[slot]?.cacheRetention);
}

/** A refusal the UI can act on (open model setup), or a plain message. */
function failureOf(error: unknown): { error: string; code?: "models_not_configured" | typeof PROVIDER_KEY_MISSING_CODE } {
	if (error instanceof ModelsNotConfiguredError) return { error: "Choose your models first, then try again.", code: "models_not_configured" };
	if (error instanceof ProviderKeyMissingError) return { error: error.envelope.error, code: PROVIDER_KEY_MISSING_CODE };
	return { error: error instanceof Error && error.message ? error.message : "Something went wrong." };
}

/** Run `work` over `items`, at most `width` at a time, keeping order. */
async function pool<T, R>(items: readonly T[], width: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
	const out = new Array<R>(items.length);
	let next = 0;
	await Promise.all(Array.from({ length: Math.min(width, items.length) }, async () => {
		for (;;) {
			const i = next++;
			if (i >= items.length) return;
			out[i] = await work(items[i]!, i);
		}
	}));
	return out;
}

// ─── running work (process-local, survives Next's per-route module copies) ───

interface CourseRuns {
	builds: Map<string, AbortController>;
	diagnostics: Map<string, AbortController>;
}
const runs = (): CourseRuns => {
	const g = globalThis as { __lhCourseRuns?: CourseRuns };
	return (g.__lhCourseRuns ??= { builds: new Map(), diagnostics: new Map() });
};

/** Work that was running when the server stopped cannot resume by itself:
 *  say so instead of spinning forever. */
function settleInterrupted(course: Course): Course {
	const building = ["reading", "mapping", "organizing"].includes(course.build.status) && !runs().builds.has(course.id);
	const stuck = course.goals.filter((g) => g.diagnostic?.status === "writing" && !runs().diagnostics.has(`${course.id}:${g.id}`));
	if (!building && stuck.length === 0) return course;
	return courseStore.update(course.id, (c) => {
		if (building) c.build = { ...c.build, status: c.concepts.length > 0 ? "ready" : "failed", error: "Building the map was interrupted. Try again." };
		for (const g of c.goals) {
			if (g.diagnostic?.status === "writing" && !runs().diagnostics.has(`${c.id}:${g.id}`)) {
				g.diagnostic = { ...g.diagnostic, status: "failed", error: "Writing the diagnostic was interrupted. Try again." };
			}
		}
	}, { touch: false, silent: true }) ?? course;
}

// ─── reading ─────────────────────────────────────────────────────────────────

export function listCourses(): CourseSummary[] {
	const day = today();
	return courseStore.list().map((c) => summarizeCourse(settleInterrupted(c), day));
}

/** The record as the browser sees it, with the diagnostic's next question
 *  resolved and answer keys withheld. */
export interface CourseView extends Course {
	today: string;
	mastery: Record<string, Mastery>;
	/** goalId → the question to show next (absent = none / finished). */
	nextQuestion: Record<string, string>;
}

function viewOf(course: Course): CourseView {
	const index = indexCourse(course);
	const nextQuestion: Record<string, string> = {};
	for (const goal of course.goals) {
		const d = goal.diagnostic;
		if (!d || (d.status !== "ready" && d.status !== "in-progress")) continue;
		const conceptId = nextDiagnosticConcept(course, goal, index);
		const question = conceptId && d.questions.find((q) => q.conceptId === conceptId);
		if (question) nextQuestion[goal.id] = question.id;
	}
	return { ...publicCourse(course), today: today(), mastery: Object.fromEntries(masteryOf(course, index)), nextQuestion };
}

export function getCourse(id: string): CourseView | null {
	const stored = courseStore.get(id);
	if (!stored) return null;
	return viewOf(syncCourse(settleInterrupted(stored)));
}

function mustGet(id: string): Course {
	const course = courseStore.get(id);
	if (!course) throw new CourseError("That course no longer exists.", 404, "not_found");
	return course;
}

function mustGoal(course: Course, goalId: string): Goal {
	const goal = course.goals.find((g) => g.id === goalId);
	if (!goal) throw new CourseError("That goal no longer exists.", 404, "not_found");
	return goal;
}

// ─── courses ─────────────────────────────────────────────────────────────────

export function createCourse(title: string): CourseView {
	return viewOf(courseStore.create(title));
}

export function renameCourse(id: string, title: string): CourseView {
	const clean = title.trim().slice(0, 140);
	if (!clean) throw new CourseError("A course needs a name.");
	const course = courseStore.update(id, (c) => { c.title = clean; });
	if (!course) throw new CourseError("That course no longer exists.", 404, "not_found");
	return viewOf(course);
}

export function deleteCourse(id: string): boolean {
	runs().builds.get(id)?.abort();
	for (const [key, controller] of runs().diagnostics) if (key.startsWith(`${id}:`)) controller.abort();
	return courseStore.remove(id);
}

// ─── material ────────────────────────────────────────────────────────────────

/** Split plain text into pages of about a part's size, on paragraph breaks. */
function paginate(text: string): SourcePage[] {
	const pages: SourcePage[] = [];
	let current = "";
	for (const paragraph of text.split(/\n{2,}/)) {
		if (current.length + paragraph.length > PART_CHARS / 4 && current) {
			pages.push({ number: pages.length + 1, text: current });
			current = "";
		}
		current += (current ? "\n\n" : "") + paragraph;
	}
	if (current.trim()) pages.push({ number: pages.length + 1, text: current });
	return pages;
}

async function convert(name: string, bytes: Uint8Array): Promise<{ kind: "pdf" | "text"; pages: SourcePage[]; notice?: string }> {
	if (!SOURCE_EXTENSIONS.test(name)) throw new CourseError(`"${name}" isn't a supported file. Use a PDF, Markdown or text file.`);
	if (!PDF_MAGIC.every((byte, i) => bytes[i] === byte)) {
		if (bytes.subarray(0, 8192).includes(0)) throw new CourseError(`"${name}" isn't a text file.`);
		const pages = paginate(new TextDecoder().decode(bytes));
		if (pages.length === 0) throw new CourseError(`"${name}" is empty.`);
		return { kind: "text", pages };
	}
	const pdf = await convertPdf(bytes, MAX_PDF_PAGES);
	if (pdf.kind === "unreadable") throw new CourseError(`"${name}" could not be opened as a PDF.`);
	if (pdf.kind === "too-long") throw new CourseError(`"${name}" is too long. The limit is ${MAX_PDF_PAGES.toLocaleString("en-US")} pages.`);
	const pages = pdf.pages.flatMap((p) => (p.kind === "text" ? [{ number: p.number, text: p.markdown }] : []));
	if (pages.length === 0) {
		throw new CourseError(`"${name}" has no selectable text — it looks like a scan. Scanned pages can't be read yet; use a PDF whose text you can highlight.`);
	}
	const skipped = pdf.pages.filter((p) => p.kind === "image-only").length;
	return { kind: "pdf", pages, ...(skipped > 0 ? { notice: `${skipped} scanned ${skipped === 1 ? "page was" : "pages were"} skipped.` } : {}) };
}

/** Take the dropped files, store their text, and start (re)building the
 *  map. Returns as soon as the files are stored; the build runs on. */
export async function addSources(courseId: string, files: readonly { name: string; bytes: Uint8Array }[]): Promise<CourseView> {
	mustGet(courseId);
	if (runs().builds.has(courseId)) throw new CourseError("The map is still being built. Add more files when it finishes.", 409, "busy");
	// Refuse before any work when the models are not set up.
	try { engineFor("cheap"); engineFor("strong"); } catch (error) {
		const failure = failureOf(error);
		throw new CourseError(failure.error, 503, failure.code);
	}
	const converted: ({ file: { name: string } } & Awaited<ReturnType<typeof convert>>)[] = [];
	for (const file of files) converted.push({ file, ...(await convert(file.name, file.bytes)) });
	const course = courseStore.update(courseId, (c) => {
		for (const item of converted) {
			const id = `src_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 6)}`;
			courseStore.writeSource(c.id, id, item.pages);
			c.sources.push({
				id,
				name: item.file.name,
				kind: item.kind,
				pages: item.pages.length,
				chars: item.pages.reduce((sum, p) => sum + p.text.length, 0),
				addedAt: new Date().toISOString(),
				...(item.notice ? { notice: item.notice } : {}),
			});
		}
	});
	if (!course) throw new CourseError("That course no longer exists.", 404, "not_found");
	startBuild(courseId);
	return viewOf(courseStore.get(courseId) ?? course);
}

export function rebuildCourse(courseId: string): CourseView {
	const course = mustGet(courseId);
	if (course.sources.length === 0) throw new CourseError("Add a textbook or syllabus first.");
	if (runs().builds.has(courseId)) throw new CourseError("The map is already being built.", 409, "busy");
	startBuild(courseId);
	return viewOf(courseStore.get(courseId) ?? course);
}

interface Part {
	source: CourseSource;
	text: string;
}

function partsOf(course: Course): Part[] {
	const totalChars = course.sources.reduce((sum, s) => sum + s.chars, 0);
	const size = Math.max(PART_CHARS, Math.ceil(totalChars / MAX_PARTS));
	const parts: Part[] = [];
	for (const source of course.sources) {
		let text = "";
		for (const page of courseStore.readSource(course.id, source.id)) {
			const block = `--- Page ${page.number} ---\n\n${page.text}`;
			if (text && text.length + block.length > size) { parts.push({ source, text }); text = ""; }
			text += (text ? "\n\n" : "") + block;
		}
		if (text) parts.push({ source, text });
	}
	return parts;
}

function startBuild(courseId: string): void {
	const controller = new AbortController();
	runs().builds.set(courseId, controller);
	courseStore.update(courseId, (c) => {
		c.build = { status: "reading", done: 0, total: 0, found: [], startedAt: new Date().toISOString() };
	});
	void build(courseId, controller.signal)
		.catch((error) => {
			if (controller.signal.aborted) return;
			console.error(`[course ${courseId}] build failed:`, error);
			const failure = failureOf(error);
			courseStore.update(courseId, (c) => {
				c.build = { ...c.build, status: c.concepts.length > 0 ? "ready" : "failed", error: failure.error, ...(failure.code ? { code: failure.code } : {}) };
			});
		})
		.finally(() => {
			if (runs().builds.get(courseId) === controller) runs().builds.delete(courseId);
		});
}

const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function build(courseId: string, signal: AbortSignal): Promise<void> {
	const course = mustGet(courseId);
	const parts = partsOf(course);
	const perPart = Math.max(4, Math.min(14, Math.round(TARGET_CONCEPTS / Math.max(1, parts.length))));
	const reader = engineFor("cheap");
	const organizer = engineFor("strong");
	const usage = (_: Usage) => undefined;
	courseStore.update(courseId, (c) => { c.build = { ...c.build, status: "mapping", total: parts.length }; });

	// 1. Read every part.
	interface Found extends FoundConcept { source: CourseSource }
	const found: Found[][] = [];
	const assessments: FoundAssessment[] = [];
	const titleHints: string[] = [];
	await pool(parts, READ_CONCURRENCY, async (part, i) => {
		const findings = await readPart({
			engine: reader, partText: part.text, sourceName: part.source.name,
			part: i + 1, parts: parts.length, maxConcepts: perPart, today: today(), signal, onUsage: usage,
		});
		signal.throwIfAborted();
		found[i] = findings.concepts.map((c) => ({ ...c, source: part.source }));
		assessments.push(...findings.assessments);
		if (findings.courseTitle) titleHints.push(findings.courseTitle);
		courseStore.update(courseId, (c) => {
			c.build = { ...c.build, done: c.build.done + 1, found: [...c.build.found, ...findings.concepts.map((x) => x.title)].slice(-400) };
		}, { touch: false });
	});
	const all = found.flat();
	if (all.length === 0) throw new CourseError("No concepts were found in this material. Is it the right file?");

	// 2. Organize: units, merged duplicates, prerequisite links.
	courseStore.update(courseId, (c) => { c.build = { ...c.build, status: "organizing" }; });
	const where = (c: Found) => `${c.pageFrom ? `p. ${c.pageFrom}${c.pageTo && c.pageTo !== c.pageFrom ? `–${c.pageTo}` : ""} of ` : ""}"${c.source.name}"`;
	const inputs: OrganizeInput[] = all.map((c, i) => ({ n: i + 1, title: c.title, summary: c.summary, kind: c.kind, where: where(c), requires: c.requires }));
	const outlines = course.sources
		.filter((s) => s.chars <= OUTLINE_CHARS)
		.map((s) => ({ name: s.name, text: courseStore.readSource(courseId, s.id).map((p) => p.text).join("\n\n") }));
	const shape = await organizeCourse({
		engine: organizer, concepts: inputs, assessments, titleHints,
		sourceNames: course.sources.map((s) => s.name), outlines, today: today(), signal, onUsage: usage,
	});
	signal.throwIfAborted();

	// 3. Turn the organizer's numbers into the stored map. Ids are slugs of
	// the titles, so a rebuild keeps the id of every concept whose name
	// survives — and with it the learner's evidence on that concept.
	const keepOf = new Map<number, number>();
	for (const merge of shape.merges) for (const drop of merge.drop) if (drop !== merge.keep) keepOf.set(drop, merge.keep);
	const resolve = (n: number): number => {
		for (let hops = 0; keepOf.has(n) && hops < 8; hops++) n = keepOf.get(n)!;
		return n;
	};
	const units: CourseUnit[] = [];
	const concepts: CourseConcept[] = [];
	const idOf = new Map<number, string>();
	const unitIds = new Set<string>(), conceptIds = new Set<string>();
	for (const unit of shape.units) {
		const numbers = [...new Set(unit.concepts.map(resolve))].filter((n) => !idOf.has(n) && all[n - 1]);
		if (numbers.length === 0) continue;
		const unitId = uniqueSlug(`unit-${slugify(unit.title)}`, unitIds);
		units.push({ id: unitId, title: unit.title, ...(unit.summary ? { summary: unit.summary } : {}) });
		for (const n of numbers) {
			const c = all[n - 1]!;
			const id = uniqueSlug(slugify(c.title), conceptIds);
			idOf.set(n, id);
			concepts.push({ id, unitId, title: c.title, summary: c.summary, kind: c.kind, prereqs: [], refs: [] });
		}
	}
	const byId = new Map(concepts.map((c) => [c.id, c]));
	const byTitle = new Map(concepts.map((c) => [normalize(c.title), c.id]));
	// Page references: the kept entry's, plus those of everything merged into it.
	all.forEach((c, i) => {
		const id = idOf.get(resolve(i + 1));
		if (!id || !c.pageFrom) return;
		const refs = byId.get(id)!.refs;
		const ref = { sourceId: c.source.id, from: c.pageFrom, to: Math.max(c.pageFrom, c.pageTo ?? c.pageFrom) };
		if (!refs.some((r) => r.sourceId === ref.sourceId && r.from === ref.from)) refs.push(ref);
	});
	const linked = new Set<string>();
	for (const link of shape.prerequisites) {
		const id = idOf.get(resolve(link.concept));
		if (!id) continue;
		linked.add(id);
		const prereqs = link.requires.map((n) => idOf.get(resolve(n))).filter((p): p is string => !!p && p !== id);
		byId.get(id)!.prereqs = [...new Set(prereqs)];
	}
	// The organizer said nothing about a concept: fall back to its finder's links.
	all.forEach((c, i) => {
		const id = idOf.get(resolve(i + 1));
		if (!id || linked.has(id) || byId.get(id)!.prereqs.length > 0) return;
		byId.get(id)!.prereqs = [...new Set(c.requires.map((t) => byTitle.get(normalize(t))).filter((p): p is string => !!p && p !== id))];
	});
	// An assessment with neither a date nor coverage gives a goal nothing to start from.
	const suggestions: SuggestedGoal[] = shape.assessments.filter((a) => a.date || a.units.length > 0).map((a) => ({
		title: a.title,
		kind: a.kind,
		...(a.date ? { date: a.date } : {}),
		unitIds: a.units.map((position) => shape.units[position - 1]).flatMap((u) => {
			const unit = u && units.find((x) => x.title === u.title);
			return unit ? [unit.id] : [];
		}),
		...(a.note ? { note: a.note } : {}),
	}));

	courseStore.update(courseId, (c) => {
		const firstBuild = c.concepts.length === 0;
		c.units = units;
		c.concepts = concepts;
		// A goal keeps the units that still exist.
		const kept = new Set(units.map((u) => u.id));
		for (const g of c.goals) g.unitIds = g.unitIds.filter((u) => kept.has(u));
		const have = new Set(c.goals.map((g) => normalize(g.title)));
		c.suggestions = suggestions.filter((s) => !have.has(normalize(s.title)));
		if (firstBuild && shape.title) c.title = shape.title;
		c.build = { status: "ready", done: parts.length, total: parts.length, found: [] };
	});
}

// ─── goals ───────────────────────────────────────────────────────────────────

export interface GoalInput {
	title?: unknown;
	kind?: unknown;
	date?: unknown;
	unitIds?: unknown;
	note?: unknown;
}

function cleanGoal(course: Course, input: GoalInput, base?: Goal): Pick<Goal, "title" | "kind" | "date" | "unitIds" | "note"> {
	const title = typeof input.title === "string" ? input.title.trim().slice(0, 120) : base?.title ?? "";
	if (!title) throw new CourseError("Give the goal a name, like “Midterm 1”.");
	const date = input.date === undefined ? base?.date : input.date;
	if (!isDay(date)) throw new CourseError("Pick the date of the exam.");
	const known = new Set(course.units.map((u) => u.id));
	const unitIds = Array.isArray(input.unitIds)
		? [...new Set(input.unitIds.filter((u): u is string => typeof u === "string" && known.has(u)))]
		: base?.unitIds ?? [];
	if (unitIds.length === 0) throw new CourseError("Choose at least one unit the exam covers.");
	const kind = (GOAL_KINDS as readonly unknown[]).includes(input.kind) ? (input.kind as GoalKind) : base?.kind ?? "test";
	const note = typeof input.note === "string" ? input.note.trim().slice(0, 300) : base?.note;
	return { title, kind, date, unitIds, ...(note ? { note } : {}) };
}

export function createGoal(courseId: string, input: GoalInput): { course: CourseView; goalId: string } {
	const fields = cleanGoal(mustGet(courseId), input);
	const goalId = `goal_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 6)}`;
	const course = courseStore.update(courseId, (c) => {
		c.goals.push({ id: goalId, ...fields, createdAt: new Date().toISOString() });
		const taken = normalize(fields.title);
		c.suggestions = c.suggestions.filter((s) => normalize(s.title) !== taken);
	})!;
	return { course: viewOf(course), goalId };
}

export function updateGoal(courseId: string, goalId: string, input: GoalInput): CourseView {
	const before = mustGet(courseId);
	const fields = cleanGoal(before, input, mustGoal(before, goalId));
	const course = courseStore.update(courseId, (c) => {
		const goal = c.goals.find((g) => g.id === goalId)!;
		Object.assign(goal, fields);
		// A moved date or changed coverage needs a new plan.
		if (goal.plan) goal.plan = buildPlan(c, goal, today(), goal.plan.prefs);
	})!;
	return viewOf(course);
}

export function deleteGoal(courseId: string, goalId: string): CourseView {
	runs().diagnostics.get(`${courseId}:${goalId}`)?.abort();
	const course = courseStore.update(courseId, (c) => { c.goals = c.goals.filter((g) => g.id !== goalId); });
	if (!course) throw new CourseError("That course no longer exists.", 404, "not_found");
	return viewOf(course);
}

// ─── the diagnostic ──────────────────────────────────────────────────────────

/** A passage of the material on a concept, for the question writer's notation. */
function excerptFor(course: Course, concept: CourseConcept, limit: number, cache: Map<string, SourcePage[]>): string {
	const ref = concept.refs[0];
	if (!ref) return "";
	if (!cache.has(ref.sourceId)) cache.set(ref.sourceId, courseStore.readSource(course.id, ref.sourceId));
	const pages = cache.get(ref.sourceId)!.filter((p) => p.number >= ref.from && p.number <= ref.to);
	const text = pages.map((p) => p.text).join("\n\n");
	if (text.length <= limit) return text;
	// Start at the concept's name when the page mentions it.
	const at = text.toLowerCase().indexOf(concept.title.toLowerCase());
	const start = at > 0 ? Math.max(0, Math.min(at - 200, text.length - limit)) : 0;
	return text.slice(start, start + limit);
}

/** Deterministic shuffle (a model tends to put the right answer first). */
function shuffled(question: { conceptId: string; question: string; options: string[]; correctIndex: number; explanation: string }, id: string): DiagnosticQuestion {
	let seed = 0;
	for (const ch of id + question.question) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
	const order = question.options.map((_, i) => i);
	for (let i = order.length - 1; i > 0; i--) {
		seed = (seed * 1664525 + 1013904223) >>> 0;
		const j = seed % (i + 1);
		[order[i], order[j]] = [order[j]!, order[i]!];
	}
	return {
		id,
		conceptId: question.conceptId,
		question: question.question,
		options: order.map((i) => question.options[i]!),
		correctIndex: order.indexOf(question.correctIndex),
		explanation: question.explanation,
	};
}

/** Start (or restart) a goal's diagnostic: the questions are written in the
 *  background and appear on the record as each batch lands. */
export function startDiagnostic(courseId: string, goalId: string): CourseView {
	const course = mustGet(courseId);
	const goal = mustGoal(course, goalId);
	const key = `${courseId}:${goalId}`;
	if (runs().diagnostics.has(key)) return viewOf(course);
	let engine: PiEngine;
	try { engine = engineFor("strong"); } catch (error) {
		const failure = failureOf(error);
		throw new CourseError(failure.error, 503, failure.code);
	}
	const index = indexCourse(course);
	let candidates = diagnosticCandidates(course, goal, index);
	if (candidates.length === 0) throw new CourseError("This goal covers no concepts yet.");
	if (candidates.length > MAX_DIAGNOSTIC_CONCEPTS) {
		const step = candidates.length / MAX_DIAGNOSTIC_CONCEPTS;
		candidates = Array.from({ length: MAX_DIAGNOSTIC_CONCEPTS }, (_, i) => candidates[Math.floor(i * step)]!);
	}
	const controller = new AbortController();
	runs().diagnostics.set(key, controller);
	const stored = courseStore.update(courseId, (c) => {
		c.goals.find((g) => g.id === goalId)!.diagnostic = { status: "writing", questions: [], answers: [], startedAt: new Date().toISOString() };
	})!;

	const unitTitle = new Map(course.units.map((u) => [u.id, u.title]));
	const cache = new Map<string, SourcePage[]>();
	const inputs: QuestionInput[] = candidates.map((id) => {
		const c = index.byId.get(id)!;
		return { id, title: c.title, summary: c.summary, unit: unitTitle.get(c.unitId) ?? "", excerpt: excerptFor(course, c, 1400, cache) };
	});
	const batches: QuestionInput[][] = [];
	for (let i = 0; i < inputs.length; i += QUESTION_BATCH) batches.push(inputs.slice(i, i + QUESTION_BATCH));
	const run = async () => {
		let failed = 0;
		await pool(batches, READ_CONCURRENCY, async (batch) => {
			try {
				const written = await writeQuestions({ engine, courseTitle: course.title, concepts: batch, signal: controller.signal });
				courseStore.update(courseId, (c) => {
					const d = c.goals.find((g) => g.id === goalId)?.diagnostic;
					if (!d || d.status !== "writing") return;
					d.questions.push(...written.map((q) => shuffled(q, `q_${slugify(q.conceptId)}_${crypto.randomUUID().slice(0, 6)}`)));
				}, { touch: false });
			} catch (error) {
				if (controller.signal.aborted) return;
				failed++;
				console.error(`[course ${courseId}] diagnostic batch failed:`, error);
				// One refused batch means the rest will be refused too.
				if (error instanceof ModelsNotConfiguredError || error instanceof ProviderKeyMissingError) throw error;
			}
		});
		courseStore.update(courseId, (c) => {
			const d = c.goals.find((g) => g.id === goalId)?.diagnostic;
			if (!d || d.status !== "writing") return;
			if (d.questions.length === 0) Object.assign(d, { status: "failed", error: failed > 0 ? "The questions could not be written. Check your model connection and try again." : "No questions were written." });
			else d.status = "ready";
		});
	};
	void run()
		.catch((error) => {
			if (controller.signal.aborted) return;
			const failure = failureOf(error);
			courseStore.update(courseId, (c) => {
				const d = c.goals.find((g) => g.id === goalId)?.diagnostic;
				if (d) Object.assign(d, { status: "failed", error: failure.error });
			});
		})
		.finally(() => {
			if (runs().diagnostics.get(key) === controller) runs().diagnostics.delete(key);
		});
	return viewOf(stored);
}

export interface DiagnosticAnswerResult {
	correct: boolean;
	correctIndex: number;
	explanation: string;
	done: boolean;
	course: CourseView;
}

/** Record one answer (`choice` null = "I don't know"). The answer becomes
 *  evidence at once, so the next question is chosen with it in hand. */
export function answerDiagnostic(courseId: string, goalId: string, questionId: string, choice: number | null): DiagnosticAnswerResult {
	const before = mustGet(courseId);
	const diagnostic = mustGoal(before, goalId).diagnostic;
	const question = diagnostic?.questions.find((q) => q.id === questionId);
	if (!diagnostic || !question) throw new CourseError("That question is no longer part of this diagnostic.", 404, "not_found");
	if (diagnostic.status !== "ready" && diagnostic.status !== "in-progress") throw new CourseError("This diagnostic isn't open.", 409, "closed");
	if (diagnostic.answers.some((a) => a.questionId === questionId)) throw new CourseError("That question was already answered.", 409, "answered");
	if (choice !== null && (!Number.isInteger(choice) || choice < 0 || choice >= question.options.length)) throw new CourseError("Pick one of the options.");
	const correct = choice === question.correctIndex;
	const at = new Date().toISOString();
	let done = false;
	const course = courseStore.update(courseId, (c) => {
		const goal = c.goals.find((g) => g.id === goalId)!;
		const d = goal.diagnostic!;
		d.answers.push({ questionId, conceptId: question.conceptId, choice, correct, at });
		d.status = "in-progress";
		c.evidence.push({ id: `diag:${goalId}:${questionId}`, conceptId: question.conceptId, correct, at, source: "diagnostic", goalId });
		if (nextDiagnosticConcept(c, goal) === null) {
			done = true;
			d.status = "done";
			d.completedAt = at;
		}
	})!;
	return { correct, correctIndex: question.correctIndex, explanation: question.explanation, done, course: viewOf(course) };
}

/** Stop early: what has been answered so far stands. */
export function finishDiagnostic(courseId: string, goalId: string): CourseView {
	const course = courseStore.update(courseId, (c) => {
		const d = c.goals.find((g) => g.id === goalId)?.diagnostic;
		if (d && (d.status === "ready" || d.status === "in-progress")) Object.assign(d, { status: "done", completedAt: new Date().toISOString() });
	});
	if (!course) throw new CourseError("That course no longer exists.", 404, "not_found");
	return viewOf(course);
}

// ─── the plan ────────────────────────────────────────────────────────────────

function cleanPrefs(input: unknown, base: PlanPrefs): PlanPrefs {
	const raw = (input ?? {}) as { minutesPerDay?: unknown; weekdays?: unknown };
	const minutes = typeof raw.minutesPerDay === "number" && Number.isFinite(raw.minutesPerDay) ? Math.min(480, Math.max(10, Math.round(raw.minutesPerDay))) : base.minutesPerDay;
	const weekdays = Array.isArray(raw.weekdays) ? [...new Set(raw.weekdays.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : base.weekdays;
	return { minutesPerDay: minutes, weekdays: weekdays.length > 0 ? weekdays : base.weekdays };
}

export function planGoal(courseId: string, goalId: string, prefs?: unknown): CourseView {
	mustGoal(mustGet(courseId), goalId);
	const course = courseStore.update(courseId, (c) => {
		const goal = c.goals.find((g) => g.id === goalId)!;
		goal.plan = buildPlan(c, goal, today(), cleanPrefs(prefs, goal.plan?.prefs ?? DEFAULT_PLAN_PREFS));
	})!;
	return viewOf(course);
}

// ─── teaching sessions ───────────────────────────────────────────────────────

const percent = (p: number) => `${Math.round(p * 100)}%`;

function readOf(concept: CourseConcept, mastery: Mastery, evidence: readonly Evidence[]): string {
	const direct = evidence.filter((e) => e.conceptId === concept.id).sort((a, b) => a.at.localeCompare(b.at));
	const last = direct.at(-1);
	const observed = last
		? `${last.source === "diagnostic" ? "In the diagnostic" : last.source === "session" ? "In an earlier session" : "Marked by the learner"} (${last.at.slice(0, 10)}) he ${last.correct ? "answered a question on this correctly" : "missed a question on this"}${direct.length > 1 ? ` — ${direct.filter((e) => e.correct).length} of ${direct.length} right overall` : ""}.`
		: mastery.inferred > 0
			? "Not asked directly; the estimate is inferred from his answers on neighbouring concepts."
			: "Not tested yet.";
	const stance = mastery.state === "solid"
		? "Treat as held: build on it without re-teaching, and confirm in passing."
		: mastery.state === "shaky"
			? "Partly there: find where it runs out and repair that, rather than starting over."
			: "Treat as new: teach it from what he holds.";
	return `${observed} Estimated ${percent(mastery.p)} held. ${stance}`;
}

interface SessionSeed {
	messages: LhMessage[];
	/** The learner's opening message, when the session needs one to start. */
	prompt?: string;
	kind?: "practice";
}

function seedSession(course: Course, goal: Goal, session: PlanSession, engine: PiEngine): SessionSeed {
	const index = indexCourse(course);
	const mastery = masteryOf(course, index);
	const day = today();
	const daysLeft = daysBetween(day, goal.date);
	const when = daysLeft <= 0 ? "today" : daysLeft === 1 ? "tomorrow" : `in ${daysLeft} days`;
	const targets = session.conceptIds.map((id) => index.byId.get(id)).filter((c): c is CourseConcept => !!c);
	const targetIds = new Set(targets.map((c) => c.id));
	const prereqs = [...new Set(targets.flatMap((c) => c.prereqs))].filter((id) => !targetIds.has(id)).map((id) => index.byId.get(id)!).filter(Boolean);
	const line = (c: CourseConcept) => `- [${c.id}] ${c.title}: ${c.summary}`;
	const head = [
		`[Session context] — this session was opened from the learner's study plan for the course "${course.title}".`,
		"",
		`Goal: ${goal.title}, ${when} (${goal.date}). Today is ${day}.`,
		`This session: ${session.title} — about ${session.minutes} minutes.`,
	];

	if (session.kind === "practice") {
		const content = [
			...head,
			"",
			"This is a practice exam. Pose exam-style problems across the concepts below, at the level and in the notation of the course, mixing them the way an exam would. Favour the concepts marked weakest.",
			"The concept ids are for your reference only — leave the problem tool's target field empty.",
			"",
			"Concepts the exam covers (id — title: summary — current estimate):",
			...targets.map((c) => `${line(c)} — ${mastery.get(c.id)!.state}, ${percent(mastery.get(c.id)!.p)}`),
		].join("\n");
		return {
			kind: "practice",
			messages: [marker(content, targets)],
			prompt: `Give me a practice exam for ${goal.title}.`,
		};
	}

	const cache = new Map<string, SourcePage[]>();
	const per = Math.max(900, Math.floor(SESSION_EXCERPT_CHARS / Math.max(1, targets.length)));
	const sourceName = new Map(course.sources.map((s) => [s.id, s.name]));
	const material = targets.flatMap((c) => {
		const excerpt = excerptFor(course, c, per, cache);
		const ref = c.refs[0];
		return excerpt && ref
			? [`<material concept="${c.id}" source="${sourceName.get(ref.sourceId) ?? "material"}" pages="${ref.from}${ref.to !== ref.from ? `-${ref.to}` : ""}">`, excerpt, "</material>", ""]
			: [];
	});
	const review = session.kind === "review";
	const content = [
		...head,
		"",
		review
			? "This is a REVIEW session. He has already studied these concepts. Do not re-teach them from the start: run retrieval practice — one check per concept, hardest first — and teach only where an answer exposes a gap."
			: "Teach exactly the concepts below, in an order that respects their dependencies. The rest of the course is covered by other sessions of his plan — do not wander into it.",
		"",
		`Concepts for this session (id — title: summary):`,
		...targets.map(line),
		...(prereqs.length > 0 ? ["", "What these rest on (not this session's subject; repair one only if it turns out to be missing):", ...prereqs.map((c) => `${line(c)} — ${mastery.get(c.id)!.state}, ${percent(mastery.get(c.id)!.p)}`)] : []),
		"",
		"How to run it:",
		"- His level on each concept is already known from his diagnostic and earlier sessions — it is recorded in the assessment below. Do not probe again; plan from it.",
		"- In plan_init, give each node that teaches one of the concepts above that concept's id as its node id (e.g. the node for [" + (targets[0]?.id ?? "concept-id") + "] has the id " + (targets[0]?.id ?? "concept-id") + "). His progress in the course is tracked through the checks you tag with those ids. Add other nodes freely.",
		"- Teach from his own material: use its definitions and notation. Excerpts follow.",
		"- He opened this session to study, and its scope is already agreed. Author the plan, show it in a sentence or two, and begin teaching the first concept in the same turn — do not stop to ask whether the plan is acceptable.",
		...(material.length > 0 ? ["", ...material] : []),
	].join("\n");

	const strands = [...targets, ...prereqs.filter((c) => mastery.get(c.id)!.state !== "solid")].map((c) => ({
		strand: c.title,
		assessment: readOf(c, mastery.get(c.id)!, course.evidence),
	}));
	const solidPrereqs = prereqs.filter((c) => mastery.get(c.id)!.state === "solid").map((c) => c.title);
	const summary = [
		`Goal: ${goal.title} ${when}. This session covers ${targets.length} ${targets.length === 1 ? "concept" : "concepts"} of his plan.`,
		solidPrereqs.length > 0 ? `Held and safe to build on: ${solidPrereqs.join(", ")}.` : "",
		goal.diagnostic?.completedAt ? `From his diagnostic of ${goal.diagnostic.completedAt.slice(0, 10)} and the sessions since.` : "No diagnostic was taken for this goal — treat untested concepts as new and watch the first checks closely.",
	].filter(Boolean).join(" ");

	const callId = `call_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`;
	const now = Date.now();
	const assessment = {
		id: `${COURSE_SEED_PREFIX}${newMessageId()}`,
		role: "assistant",
		content: [{ type: "toolCall", id: callId, name: "probe_done", arguments: { assessment: { strands, summary } } }],
		api: engine.model.api,
		provider: engine.model.provider,
		model: engine.model.id,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "toolUse",
		timestamp: now,
	} as unknown as LhMessage;
	const result = {
		id: `${COURSE_SEED_PREFIX}${newMessageId()}`,
		role: "toolResult",
		toolCallId: callId,
		toolName: "probe_done",
		content: [{ type: "text", text: PROBE_DONE_ACK_TEXT }],
		details: { ok: true },
		isError: false,
		timestamp: now,
	} as unknown as LhMessage;
	// No opening message from the learner: startSession hands the concluded
	// assessment to the teacher through the wake pipeline.
	return { messages: [marker(content, targets), assessment, result] };
}

/** The session's opening context: model-facing text plus the transcript
 *  card's payload (the same marker a map pick writes). */
function marker(content: string, concepts: readonly CourseConcept[]): LhMarkerMessage {
	return {
		id: newMessageId(),
		role: "custom",
		customType: "graph-context",
		content,
		display: true,
		details: { propositions: concepts.map((c) => ({ id: c.id, name: c.title, statement: c.summary })), chains: [] },
		timestamp: Date.now(),
	};
}

/** Open (or reopen) a plan session as a teaching chat. */
export function startSession(courseId: string, goalId: string, sessionId: string): { chatId: string; prompt?: string } {
	const course = mustGet(courseId);
	const goal = mustGoal(course, goalId);
	const session = goal.plan?.sessions.find((s) => s.id === sessionId);
	if (!session) throw new CourseError("That session is no longer in the plan.", 404, "not_found");
	if (session.chatId && stores.chatStore.getChat(session.chatId)) return { chatId: session.chatId };

	// A session is a model conversation: refuse before creating anything
	// when no model can run it.
	const strong = stores.settingsStore.readSettings()?.models?.strong;
	let engine: PiEngine;
	try { engine = engineFor("strong"); } catch (error) {
		const failure = failureOf(error);
		throw new CourseError(failure.error, 503, failure.code);
	}
	const seed = seedSession(course, goal, session, engine);
	const chat = stores.chatStore.createChat(session.title, seed.kind);
	if (strong?.model) {
		stores.chatStore.saveSettings(chat.id, { model: { provider: strong.model.provider, id: strong.model.id }, thinkingLevel: strong.thinkingLevel });
	}
	stores.chatStore.saveMessages(chat.id, seed.messages);
	courseStore.update(courseId, (c) => {
		const s = c.goals.find((g) => g.id === goalId)?.plan?.sessions.find((x) => x.id === sessionId);
		if (s) s.chatId = chat.id;
	});
	// The seeded record ends on a concluded assessment — the same seam a
	// finished probe leaves. Hand off exactly as the probe does: the wake
	// pipeline starts the teacher's first turn, server-side, so the chat
	// view only has to attach to it.
	if (!seed.prompt) void deliverJobResult(buildProbeHandoffSteer(chat.id)).catch((error) => console.error(`[course ${courseId}] session handoff failed:`, error));
	return { chatId: chat.id, ...(seed.prompt ? { prompt: seed.prompt } : {}) };
}

/** Study chosen concepts now, outside the plan's schedule: an extra
 *  session dated today, opened at once. */
export function studyConcepts(courseId: string, goalId: string, conceptIds: unknown): { chatId: string; prompt?: string } {
	const before = mustGet(courseId);
	mustGoal(before, goalId);
	const known = new Set(before.concepts.map((c) => c.id));
	const ids = Array.isArray(conceptIds) ? [...new Set(conceptIds.filter((id): id is string => typeof id === "string" && known.has(id)))].slice(0, 12) : [];
	if (ids.length === 0) throw new CourseError("Choose a concept to study.");
	const titles = ids.map((id) => before.concepts.find((c) => c.id === id)!.title);
	const sessionId = `ps_extra_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 6)}`;
	courseStore.update(courseId, (c) => {
		const goal = c.goals.find((g) => g.id === goalId)!;
		goal.plan ??= { createdAt: new Date().toISOString(), prefs: DEFAULT_PLAN_PREFS, sessions: [] };
		goal.plan.sessions.push({
			id: sessionId, date: today(), kind: "learn", status: "upcoming", conceptIds: ids, minutes: 20 * ids.length,
			title: titles.length <= 2 ? titles.join(", then ") : `${titles[0]}, ${titles[1]} and ${titles.length - 2} more`,
		});
	});
	return startSession(courseId, goalId, sessionId);
}

/** Fold the graded checks of every linked chat into the course, and close
 *  the sessions whose concepts have all been checked. Idempotent. */
export function syncCourse(course: Course): Course {
	const linked = course.goals.flatMap((g) => (g.plan?.sessions ?? []).filter((s) => s.chatId).map((s) => ({ goal: g, session: s })));
	if (linked.length === 0) return course;
	const known = new Set(course.evidence.map((e) => e.id));
	const fresh: Evidence[] = [];
	const finished: { goalId: string; sessionId: string }[] = [];
	for (const { goal, session } of linked) {
		const chat = stores.chatStore.getChat(session.chatId!);
		if (!chat) continue;
		const evidence = evidenceFromChat(chat.id, chat.messages, course.concepts, chat.tree?.nodes ?? []).map((e) => ({ ...e, goalId: goal.id }));
		fresh.push(...evidence.filter((e) => !known.has(e.id)));
		if (session.status === "upcoming" && session.kind === "learn") {
			const checked = new Set(evidence.map((e) => e.conceptId));
			if (session.conceptIds.length > 0 && session.conceptIds.every((id) => checked.has(id))) finished.push({ goalId: goal.id, sessionId: session.id });
		}
	}
	if (fresh.length === 0 && finished.length === 0) return course;
	return courseStore.update(course.id, (c) => {
		c.evidence.push(...fresh);
		for (const f of finished) {
			const s = c.goals.find((g) => g.id === f.goalId)?.plan?.sessions.find((x) => x.id === f.sessionId);
			if (s && s.status === "upcoming") Object.assign(s, { status: "done", completedAt: new Date().toISOString() });
		}
	}, { silent: true }) ?? course;
}

/** The learner says the session is done. Concepts the session never
 *  checked get a light "covered" mark, so the map moves but a later check
 *  can still correct it. */
export function completeSession(courseId: string, goalId: string, sessionId: string): CourseView {
	const synced = syncCourse(mustGet(courseId));
	mustGoal(synced, goalId);
	const course = courseStore.update(courseId, (c) => {
		const session = c.goals.find((g) => g.id === goalId)?.plan?.sessions.find((s) => s.id === sessionId);
		if (!session || session.status === "done") return;
		const at = new Date().toISOString();
		if (session.kind !== "practice") {
			const checked = new Set(c.evidence.filter((e) => e.chatId && e.chatId === session.chatId).map((e) => e.conceptId));
			for (const id of session.conceptIds) {
				if (!checked.has(id)) c.evidence.push({ id: `done:${session.id}:${id}`, conceptId: id, correct: true, at, source: "manual", goalId });
			}
		}
		Object.assign(session, { status: "done", completedAt: at });
	})!;
	return viewOf(course);
}

/** Which course session a chat belongs to — the chat header's way home. */
export interface ChatCourseLink {
	courseId: string;
	courseTitle: string;
	goalId: string;
	goalTitle: string;
	goalDate: string;
	daysLeft: number;
	sessionId: string;
	sessionTitle: string;
	sessionStatus: PlanSession["status"];
	/** Checked concepts / concepts in the session. */
	checked: number;
	total: number;
	/** The goal's knowledge meter, 0–1 (null = not measured yet). */
	knowledge: number | null;
}

export function courseLinkForChat(chatId: string): ChatCourseLink | null {
	for (const stored of courseStore.list()) {
		for (const g of stored.goals) {
			if (!g.plan?.sessions.some((s) => s.chatId === chatId)) continue;
			const course = syncCourse(stored);
			const goal = course.goals.find((x) => x.id === g.id)!;
			const session = goal.plan!.sessions.find((s) => s.chatId === chatId)!;
			const checked = new Set(course.evidence.filter((e) => e.chatId === chatId).map((e) => e.conceptId));
			return {
				courseId: course.id,
				courseTitle: course.title,
				goalId: goal.id,
				goalTitle: goal.title,
				goalDate: goal.date,
				daysLeft: daysBetween(today(), goal.date),
				sessionId: session.id,
				sessionTitle: session.title,
				sessionStatus: session.status,
				checked: session.conceptIds.filter((id) => checked.has(id)).length,
				total: session.conceptIds.length,
				knowledge: knowledgeOf(course, goalScope(course, goal).core).value,
			};
		}
	}
	return null;
}

export { currentSession, overdueSessions, goalScope };

// ─── HTTP ────────────────────────────────────────────────────────────────────

/** Run a route body; a CourseError becomes its JSON refusal. */
export async function courseHttp(work: () => unknown | Promise<unknown>): Promise<Response> {
	try {
		return Response.json(await work());
	} catch (error) {
		if (error instanceof CourseError) {
			return Response.json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, { status: error.status });
		}
		console.error("[courses] request failed:", error);
		return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
	}
}
