/**
 * The course-building agents (this fork's layer): three single-submit
 * agents over the shared runSubmitAgent seam.
 *
 *   readPart        one part of the material → the concepts it teaches
 *                   (and, from a syllabus, the assessments it announces)
 *   organizeCourse  every found concept → units, merged duplicates,
 *                   prerequisite links, assessments mapped onto units
 *   writeQuestions  a handful of concepts → one diagnostic question each
 *
 * Engines are injected (the agent layer never reads settings); the server
 * composition in src/server/courses.ts resolves them from the model slots.
 */

import { Type } from "typebox";
import type { Usage } from "@earendil-works/pi-ai";
import type { PiEngine } from "../models.ts";
import { runSubmitAgent } from "./submit-agent.ts";
import { CONCEPT_KINDS, GOAL_KINDS, isDay, type ConceptKind, type GoalKind } from "../../core/course.ts";

type OnUsage = (usage: Usage) => void;

const kindOf = (value: unknown): ConceptKind => (CONCEPT_KINDS as readonly unknown[]).includes(value) ? (value as ConceptKind) : "idea";
const goalKindOf = (value: unknown): GoalKind => (GOAL_KINDS as readonly unknown[]).includes(value) ? (value as GoalKind) : "other";
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const int = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? Math.round(value) : undefined);

// ─── readPart ────────────────────────────────────────────────────────────────

export interface FoundConcept {
	title: string;
	summary: string;
	kind: ConceptKind;
	pageFrom?: number;
	pageTo?: number;
	/** Titles of the concepts this one directly depends on. */
	requires: string[];
}

export interface FoundAssessment {
	title: string;
	kind: GoalKind;
	date?: string;
	/** What it covers, in the material's own words. */
	coverage: string;
}

export interface PartFindings {
	courseTitle: string;
	concepts: FoundConcept[];
	assessments: FoundAssessment[];
}

const partSchema = Type.Object({
	courseTitle: Type.Optional(Type.String({ description: "The course or book title, only if this part states it (a title page, a syllabus header). Otherwise empty." })),
	concepts: Type.Array(
		Type.Object({
			title: Type.String({ description: "Short noun phrase, as the material names it: 'Linear independence', 'Rank–nullity theorem'." }),
			summary: Type.String({ description: "One or two precise sentences saying what it is. LaTeX in $...$." }),
			kind: Type.String({ description: "definition | theorem | technique | idea" }),
			pageFrom: Type.Optional(Type.Number({ description: "First page (from the '--- Page N ---' markers) where it is taught." })),
			pageTo: Type.Optional(Type.Number({ description: "Last page where it is taught." })),
			requires: Type.Array(Type.String(), { description: "Titles of the concepts it DIRECTLY builds on — from this part or from earlier in the subject. Empty for starting points." }),
		}),
		{ description: "The concepts this part teaches, in the order it teaches them. Empty when the part teaches nothing (front matter, an index, exercise lists)." },
	),
	assessments: Type.Array(
		Type.Object({
			title: Type.String({ description: "As named: 'Midterm 1', 'Final exam', 'Quiz 3'." }),
			kind: Type.String({ description: "midterm | final | test | quiz | assignment | other" }),
			date: Type.Optional(Type.String({ description: "YYYY-MM-DD if the material states a date; otherwise omit." })),
			coverage: Type.String({ description: "What it covers, in the material's words ('Chapters 1–3', 'everything through eigenvalues'). Empty if unstated." }),
		}),
		{ description: "Exams, tests and quizzes this part announces (syllabi and schedules do). Usually empty for textbook pages." },
	),
});

const READ_PART_SYSTEM = `You are building a study map from a student's own course material. You are given ONE part of that material. List what a student has to learn from it.

What counts as a concept: one learnable idea at about the size of a textbook subsection — a definition, a theorem, a technique, or a key idea. "Linear independence", "Row reduction to echelon form" and "The rank–nullity theorem" are concepts. A whole chapter is too big. A single worked example, exercise, remark or historical note is too small.

Rules:
- Name each concept the way the material names it, and keep the material's notation in the summary.
- Summaries state the content itself ("A set of vectors is linearly independent when the only linear combination giving the zero vector has all coefficients zero."), never what the text does ("This section introduces…").
- Give the page range from the "--- Page N ---" markers when they are present.
- "requires" lists only DIRECT dependencies, by title. Do not list things that are merely earlier.
- Skip anything that teaches nothing: covers, prefaces, tables of contents, indexes, bibliographies, bare exercise lists. An empty list is the right answer for such a part.
- If the part is a syllabus, course outline or schedule rather than teaching text: each topic it lists is a concept (summarize from what you know of the subject, at the level the course implies), and every exam, test or quiz it announces is an assessment.

Call submit_part exactly once.`;

export async function readPart(opts: {
	engine: PiEngine;
	partText: string;
	sourceName: string;
	part: number;
	parts: number;
	maxConcepts: number;
	today: string;
	signal?: AbortSignal;
	onUsage?: OnUsage;
}): Promise<PartFindings> {
	return runSubmitAgent<PartFindings>({
		role: "extractor",
		engine: opts.engine,
		toolName: "submit_part",
		toolDescription: "Submit what this part of the material teaches.",
		parameters: partSchema,
		fill: (input) => ({
			courseTitle: text(input.courseTitle),
			concepts: (Array.isArray(input.concepts) ? input.concepts : [])
				.map((c: Record<string, unknown>): FoundConcept => ({
					title: text(c.title).slice(0, 120),
					summary: text(c.summary).slice(0, 600),
					kind: kindOf(c.kind),
					pageFrom: int(c.pageFrom),
					pageTo: int(c.pageTo) ?? int(c.pageFrom),
					requires: (Array.isArray(c.requires) ? c.requires : []).map(text).filter(Boolean).slice(0, 6),
				}))
				.filter((c: FoundConcept) => c.title.length > 0)
				.slice(0, opts.maxConcepts + 4),
			assessments: (Array.isArray(input.assessments) ? input.assessments : [])
				.map((a: Record<string, unknown>): FoundAssessment => ({
					title: text(a.title).slice(0, 120),
					kind: goalKindOf(a.kind),
					...(isDay(a.date) ? { date: a.date } : {}),
					coverage: text(a.coverage).slice(0, 300),
				}))
				.filter((a: FoundAssessment) => a.title.length > 0)
				.slice(0, 24),
		}),
		systemPrompt: READ_PART_SYSTEM,
		prompt: [
			`Material: "${opts.sourceName}" — part ${opts.part} of ${opts.parts}.`,
			`Today is ${opts.today} (use it only to resolve dates that omit the year).`,
			`List at most ${opts.maxConcepts} concepts — the ones that matter most if there are more.`,
			"",
			"<part>",
			opts.partText,
			"</part>",
		].join("\n"),
		signal: opts.signal,
		onStep: (usage) => opts.onUsage?.(usage),
		neverSubmitted: "The model did not return this part's concepts.",
	});
}

// ─── organizeCourse ──────────────────────────────────────────────────────────

/** One found concept as the organizer sees it. `n` is its number. */
export interface OrganizeInput {
	n: number;
	title: string;
	summary: string;
	kind: ConceptKind;
	where: string;
	requires: string[];
}

export interface CourseShape {
	title: string;
	units: { title: string; summary: string; concepts: number[] }[];
	merges: { keep: number; drop: number[] }[];
	prerequisites: { concept: number; requires: number[] }[];
	assessments: { title: string; kind: GoalKind; date?: string; units: number[]; note: string }[];
}

const shapeSchema = Type.Object({
	title: Type.String({ description: "The course title, as the material gives it (else a plain descriptive one)." }),
	merges: Type.Array(
		Type.Object({
			keep: Type.Number({ description: "The concept number to keep." }),
			drop: Type.Array(Type.Number(), { description: "Concept numbers that are the same concept as `keep`." }),
		}),
		{ description: "Duplicates: the same concept found in more than one part. Empty when there are none." },
	),
	units: Type.Array(
		Type.Object({
			title: Type.String({ description: "The unit's name — the chapter or syllabus topic it corresponds to." }),
			summary: Type.String({ description: "One sentence on what the unit is about." }),
			concepts: Type.Array(Type.Number(), { description: "Concept numbers in this unit, in the order they should be learned." }),
		}),
		{ minItems: 1, description: "The course's units, in teaching order. Every kept concept belongs to exactly one unit." },
	),
	prerequisites: Type.Array(
		Type.Object({
			concept: Type.Number(),
			requires: Type.Array(Type.Number(), { description: "Concept numbers it directly builds on." }),
		}),
		{ description: "Direct prerequisite links only. Omit concepts with none." },
	),
	assessments: Type.Array(
		Type.Object({
			title: Type.String(),
			kind: Type.String({ description: "midterm | final | test | quiz | assignment | other" }),
			date: Type.Optional(Type.String({ description: "YYYY-MM-DD, only if the material gave one." })),
			units: Type.Array(Type.Number(), { description: "Positions (starting at 1) of the units it covers, in your `units` list." }),
			note: Type.String({ description: "The coverage as the material words it, or empty." }),
		}),
		{ description: "Only the assessments listed in the input. Empty when the input lists none." },
	),
});

const ORGANIZE_SYSTEM = `You organize the concepts found in a student's course material into one course map. The map is what the student will study from, so its structure has to be the course's real structure.

You receive every concept found, numbered, with where it was found and what its finder thought it depends on.

Do four things:
1. Merge duplicates. The same concept is often found in more than one part (a syllabus topic and its textbook section, or a concept spanning a part boundary). Keep the entry with the better summary and page reference.
2. Group the kept concepts into units, in teaching order. Follow the material's own structure: a textbook's chapters, a syllabus's weeks or topics. When a syllabus and a textbook are both present, the syllabus decides which units exist and their order. Order the concepts inside each unit the way they should be learned. Leave out entries that are not really concepts to learn.
3. Link prerequisites. For each concept, the concepts it DIRECTLY builds on — what a student must already hold for this one to make sense. Keep it sparse and honest: usually one to three links, none for starting points. Never link a concept to something merely earlier, and do not add a link that another link already implies. A prerequisite must come earlier in the course order than the concept that needs it.
4. Map each listed assessment onto the units it covers. If the material does not say what an assessment covers, list no units for it.

Call submit_course exactly once.`;

export async function organizeCourse(opts: {
	engine: PiEngine;
	concepts: OrganizeInput[];
	assessments: FoundAssessment[];
	titleHints: string[];
	sourceNames: string[];
	/** Short outline-like sources (a syllabus), verbatim. */
	outlines: { name: string; text: string }[];
	today: string;
	signal?: AbortSignal;
	onUsage?: OnUsage;
}): Promise<CourseShape> {
	const numbers = new Set(opts.concepts.map((c) => c.n));
	const lines = opts.concepts.map((c) =>
		`#${c.n} | ${c.title} (${c.kind}) | ${c.where} | requires: ${c.requires.join("; ") || "—"} | ${c.summary}`,
	);
	const prompt = [
		`Sources: ${opts.sourceNames.map((n) => `"${n}"`).join(", ")}.`,
		opts.titleHints.length > 0 ? `Titles seen in the material: ${[...new Set(opts.titleHints)].slice(0, 5).map((t) => `"${t}"`).join(", ")}.` : "",
		`Today is ${opts.today}.`,
		"",
		...opts.outlines.flatMap((o) => [`<outline source="${o.name}">`, o.text, "</outline>", ""]),
		"<concepts>",
		...lines,
		"</concepts>",
		"",
		"<assessments>",
		...(opts.assessments.length > 0
			? opts.assessments.map((a) => `- ${a.title} (${a.kind})${a.date ? ` on ${a.date}` : ""}${a.coverage ? ` — covers: ${a.coverage}` : ""}`)
			: ["(none found)"]),
		"</assessments>",
	].filter((line, i, all) => !(line === "" && all[i - 1] === "")).join("\n");

	const list = (value: unknown): number[] => (Array.isArray(value) ? value.map(int).filter((n): n is number => n !== undefined) : []);
	return runSubmitAgent<CourseShape>({
		role: "teacher",
		engine: opts.engine,
		toolName: "submit_course",
		toolDescription: "Submit the organized course map.",
		parameters: shapeSchema,
		fill: (input) => ({
			title: text(input.title).slice(0, 140),
			merges: (Array.isArray(input.merges) ? input.merges : []).map((m: Record<string, unknown>) => ({ keep: int(m.keep) ?? -1, drop: list(m.drop) })),
			units: (Array.isArray(input.units) ? input.units : []).map((u: Record<string, unknown>) => ({
				title: text(u.title).slice(0, 120) || "Unit",
				summary: text(u.summary).slice(0, 300),
				concepts: list(u.concepts),
			})),
			prerequisites: (Array.isArray(input.prerequisites) ? input.prerequisites : []).map((p: Record<string, unknown>) => ({ concept: int(p.concept) ?? -1, requires: list(p.requires) })),
			assessments: (Array.isArray(input.assessments) ? input.assessments : []).map((a: Record<string, unknown>) => ({
				title: text(a.title).slice(0, 120),
				kind: goalKindOf(a.kind),
				...(isDay(a.date) ? { date: a.date as string } : {}),
				units: list(a.units),
				note: text(a.note).slice(0, 300),
			})).filter((a: { title: string }) => a.title.length > 0),
		}),
		validate: (shape) => {
			const placed = shape.units.flatMap((u) => u.concepts);
			const unknown = placed.filter((n) => !numbers.has(n));
			if (unknown.length > 0) return `units reference concept numbers that do not exist: ${[...new Set(unknown)].slice(0, 12).join(", ")}. Use only the numbers given.`;
			if (placed.length === 0) return "No concept was placed in any unit — every kept concept belongs to exactly one unit.";
			const dropped = new Set(shape.merges.flatMap((m) => m.drop));
			const missing = opts.concepts.filter((c) => !dropped.has(c.n) && !placed.includes(c.n));
			// Leaving out a few non-concepts is allowed; losing a large share is a mistake.
			if (missing.length > Math.max(3, opts.concepts.length * 0.2)) {
				return `${missing.length} concepts are in no unit and not merged (e.g. ${missing.slice(0, 8).map((c) => `#${c.n}`).join(", ")}). Place every real concept in a unit.`;
			}
			return null;
		},
		systemPrompt: ORGANIZE_SYSTEM,
		prompt,
		signal: opts.signal,
		maxTurns: 5,
		onStep: (usage) => opts.onUsage?.(usage),
		neverSubmitted: "The model did not return the course map.",
	});
}

// ─── writeQuestions ──────────────────────────────────────────────────────────

export interface QuestionInput {
	id: string;
	title: string;
	summary: string;
	unit: string;
	/** A passage of the learner's material on the concept, for its notation. */
	excerpt: string;
}

export interface WrittenQuestion {
	conceptId: string;
	question: string;
	options: string[];
	correctIndex: number;
	explanation: string;
}

const questionsSchema = Type.Object({
	questions: Type.Array(
		Type.Object({
			conceptId: Type.String({ description: "The id of the concept the question tests, copied exactly." }),
			question: Type.String({ description: "The question. Markdown; LaTeX in $...$ (display math in $$...$$)." }),
			options: Type.Array(Type.String(), { minItems: 4, maxItems: 4, description: "Exactly four options, one correct. Same formatting rules." }),
			correctIndex: Type.Number({ description: "Index (0–3) of the correct option." }),
			explanation: Type.String({ description: "One or two sentences on why the correct option is right." }),
		}),
		{ description: "One question per concept given." },
	),
});

const QUESTIONS_SYSTEM = `You write the diagnostic a student takes before studying for an exam. Its only job is to find out, quickly and honestly, which concepts the student already understands. It does not teach.

Write one multiple-choice question for each concept you are given.

A good diagnostic question:
- Tests whether the idea is understood, by having the student USE it — predict, compute something small, decide whether a statement holds, pick the right object. Never asks for a memorized definition word for word, and never asks trivia about the textbook.
- Can be answered in under a minute, mostly in the head. Small numbers, small matrices.
- Stands alone: defines any symbol it uses and never refers to "the text" or to another question.
- Has exactly four options and exactly one correct. Each wrong option is the answer a specific, common misunderstanding produces — so a wrong choice is informative. No "all of the above", no "none of the above", no joke options.
- Does not give the answer away: options are similar in length and form, and the question does not reuse the concept's summary sentence.
- Sits at the level of the course's own exam, in the material's notation.

Write mathematics in LaTeX: inline as $...$, displayed as $$...$$. Matrices use \\begin{pmatrix}…\\end{pmatrix}.

Call submit_questions exactly once.`;

export async function writeQuestions(opts: {
	engine: PiEngine;
	courseTitle: string;
	concepts: QuestionInput[];
	signal?: AbortSignal;
	onUsage?: OnUsage;
}): Promise<WrittenQuestion[]> {
	const ids = new Set(opts.concepts.map((c) => c.id));
	const result = await runSubmitAgent<{ questions: WrittenQuestion[] }>({
		role: "teacher",
		engine: opts.engine,
		toolName: "submit_questions",
		toolDescription: "Submit one diagnostic question per concept.",
		parameters: questionsSchema,
		fill: (input) => ({
			questions: (Array.isArray(input.questions) ? input.questions : [])
				.map((q: Record<string, unknown>): WrittenQuestion => ({
					conceptId: text(q.conceptId),
					question: text(q.question),
					options: (Array.isArray(q.options) ? q.options : []).map(text),
					correctIndex: int(q.correctIndex) ?? -1,
					explanation: text(q.explanation),
				})),
		}),
		validate: ({ questions }) => {
			const problems: string[] = [];
			for (const q of questions) {
				if (!ids.has(q.conceptId)) problems.push(`unknown conceptId "${q.conceptId}" — copy an id exactly`);
				else if (q.options.length !== 4 || q.options.some((o) => !o)) problems.push(`${q.conceptId}: needs exactly four non-empty options`);
				else if (q.correctIndex < 0 || q.correctIndex > 3) problems.push(`${q.conceptId}: correctIndex must be 0–3`);
				else if (new Set(q.options).size !== 4) problems.push(`${q.conceptId}: options must be distinct`);
				else if (!q.question) problems.push(`${q.conceptId}: empty question`);
			}
			const covered = new Set(questions.map((q) => q.conceptId));
			const missing = [...ids].filter((id) => !covered.has(id));
			if (missing.length > 0) problems.push(`no question for: ${missing.join(", ")}`);
			return problems.length > 0 ? problems.slice(0, 8).join("; ") : null;
		},
		systemPrompt: QUESTIONS_SYSTEM,
		prompt: [
			`Course: ${opts.courseTitle}`,
			"",
			...opts.concepts.flatMap((c) => [
				`<concept id="${c.id}" unit="${c.unit}">`,
				`${c.title}: ${c.summary}`,
				...(c.excerpt ? ["From the student's material:", c.excerpt] : []),
				"</concept>",
				"",
			]),
		].join("\n"),
		signal: opts.signal,
		maxTurns: 4,
		onStep: (usage) => opts.onUsage?.(usage),
		neverSubmitted: "The model did not return the questions.",
	});
	// One question per concept, in the order the concepts were given.
	const first = new Map<string, WrittenQuestion>();
	for (const q of result.questions) if (!first.has(q.conceptId)) first.set(q.conceptId, q);
	return opts.concepts.flatMap((c) => (first.has(c.id) ? [first.get(c.id)!] : []));
}
