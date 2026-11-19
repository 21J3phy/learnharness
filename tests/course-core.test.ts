/**
 * course-core — the pure logic under the course layer (src/core/course.ts):
 * the concept graph, mastery from evidence, the diagnostic's next-question
 * choice, the dated plan, and reading a teaching chat's checks as evidence.
 */
import assert from "node:assert";
import test from "node:test";
import {
	addDays,
	buildPlan,
	currentSession,
	daysBetween,
	diagnosticBudget,
	diagnosticCandidates,
	evidenceFromChat,
	goalScope,
	indexCourse,
	isDay,
	knowledgeOf,
	masteryOf,
	nextDiagnosticConcept,
	overdueSessions,
	progressOf,
	publicCourse,
	slugify,
	summarizeCourse,
	uniqueSlug,
	type Course,
	type CourseConcept,
	type Diagnostic,
	type Evidence,
	type Goal,
} from "../src/core/course.ts";

const concept = (id: string, unitId: string, prereqs: string[] = []): CourseConcept => ({
	id, unitId, title: id.replaceAll("-", " "), summary: `About ${id}.`, kind: "idea", prereqs, refs: [],
});

/** A small linear algebra course: three units, a chain with one branch. */
function course(evidence: Evidence[] = [], goals: Goal[] = []): Course {
	return {
		id: "course_test",
		version: 1,
		title: "Linear Algebra",
		createdAt: "2026-11-01T00:00:00.000Z",
		updatedAt: "2026-11-01T00:00:00.000Z",
		sources: [],
		units: [
			{ id: "unit-vectors", title: "Vectors" },
			{ id: "unit-spaces", title: "Vector spaces" },
			{ id: "unit-maps", title: "Linear maps" },
		],
		concepts: [
			concept("vectors", "unit-vectors"),
			concept("linear-combination", "unit-vectors", ["vectors"]),
			concept("span", "unit-spaces", ["linear-combination"]),
			concept("linear-independence", "unit-spaces", ["linear-combination"]),
			concept("basis", "unit-spaces", ["span", "linear-independence"]),
			concept("dimension", "unit-spaces", ["basis"]),
			concept("linear-map", "unit-maps", ["vectors"]),
			concept("kernel", "unit-maps", ["linear-map", "span"]),
			concept("rank-nullity", "unit-maps", ["kernel", "dimension"]),
		],
		evidence,
		goals,
		suggestions: [],
		build: { status: "ready", done: 1, total: 1, found: [] },
	};
}

const ev = (conceptId: string, correct: boolean, at = "2026-11-10T10:00:00.000Z", source: Evidence["source"] = "diagnostic"): Evidence => ({
	id: `e_${conceptId}_${at}`, conceptId, correct, at, source,
});

const goal = (unitIds: string[], date: string, extra: Partial<Goal> = {}): Goal => ({
	id: "goal_1", title: "Midterm 1", kind: "midterm", date, unitIds, createdAt: "2026-11-01T00:00:00.000Z", ...extra,
});

test("slugs are lesson-plan-safe and unique", () => {
	assert.equal(slugify("Rank–Nullity Theorem (finite case)"), "rank-nullity-theorem-finite-case");
	assert.equal(slugify("Élan vital"), "elan-vital");
	assert.equal(slugify("∑ ∫ ∂"), "concept");
	assert.match(slugify("x".repeat(200)), /^[a-z0-9]+([_-][a-z0-9]+)*$/);
	const taken = new Set<string>();
	assert.deepEqual([uniqueSlug("span", taken), uniqueSlug("span", taken), uniqueSlug("span", taken)], ["span", "span-2", "span-3"]);
});

test("days: validation and arithmetic stay on the calendar", () => {
	assert.ok(isDay("2026-11-19"));
	assert.ok(!isDay("2026-02-30"));
	assert.ok(!isDay("19/11/2026"));
	assert.equal(addDays("2026-12-30", 3), "2027-01-02");
	assert.equal(daysBetween("2026-11-19", "2026-12-01"), 12);
	assert.equal(daysBetween("2026-12-01", "2026-11-19"), -12);
});

test("the index orders prerequisites first, keeps unit order, and records backlinks", () => {
	const index = indexCourse(course());
	for (const c of course().concepts) {
		for (const p of c.prereqs) assert.ok(index.rank.get(p)! < index.rank.get(c.id)!, `${p} before ${c.id}`);
	}
	assert.deepEqual(index.order.slice(0, 2), ["vectors", "linear-combination"]);
	assert.deepEqual(index.dependents.get("linear-combination")!.sort(), ["linear-independence", "span"]);
});

test("the index ignores unknown prerequisites and breaks cycles instead of hanging", () => {
	const c = course();
	c.concepts[0]!.prereqs = ["dimension", "no-such-concept"]; // vectors ← dimension closes a cycle
	const index = indexCourse(c);
	assert.equal(index.order.length, c.concepts.length);
	assert.equal(new Set(index.order).size, c.concepts.length);
	assert.ok(!index.byId.get("vectors")!.prereqs.includes("no-such-concept"));
});

test("with no evidence every concept is untested", () => {
	const mastery = masteryOf(course());
	assert.ok([...mastery.values()].every((m) => m.state === "untested" && m.direct === 0));
	assert.deepEqual(progressOf(course().concepts.map((c) => c.id), mastery), { progress: 0, solid: 0, total: 9 });
});

test("a right answer lifts the concept and, more weakly, what it rests on", () => {
	const mastery = masteryOf(course([ev("basis", true)]));
	assert.equal(mastery.get("basis")!.state, "solid");
	assert.equal(mastery.get("span")!.state, "shaky", "one right answer above it is not proof of a prerequisite");
	assert.ok(mastery.get("span")!.p < mastery.get("basis")!.p);
	const twice = masteryOf(course([ev("basis", true), ev("kernel", true, "2026-11-10T10:01:00.000Z")]));
	assert.equal(twice.get("span")!.state, "solid", "a second supporting answer settles it");
	assert.ok(mastery.get("vectors")!.p > 0.3 && mastery.get("vectors")!.p < mastery.get("span")!.p, "fades with distance");
	assert.equal(mastery.get("dimension")!.state, "untested", "nothing is implied about what comes after");
});

test("a wrong answer drops the concept and what is built on it", () => {
	const mastery = masteryOf(course([ev("span", false)]));
	assert.equal(mastery.get("span")!.state, "new");
	assert.equal(mastery.get("basis")!.state, "new");
	assert.ok(mastery.get("basis")!.p < 0.3 && mastery.get("basis")!.p > mastery.get("span")!.p);
	assert.equal(mastery.get("linear-combination")!.state, "untested", "prerequisites are not blamed");
});

test("evidence folds in time order, whatever order it was stored in", () => {
	const early = ev("span", false, "2026-11-10T10:00:00.000Z");
	const late = ev("span", true, "2026-11-12T10:00:00.000Z", "session");
	const a = masteryOf(course([early, late])).get("span")!;
	const b = masteryOf(course([late, early])).get("span")!;
	assert.equal(a.p, b.p);
	assert.ok(a.p > 0.5, "the later right answer wins");
	assert.equal(a.lastAt, late.at);
});

test("a learner's own 'done' mark counts for less than a graded check", () => {
	const manual = masteryOf(course([ev("vectors", true, undefined, "manual")])).get("vectors")!;
	const graded = masteryOf(course([ev("vectors", true)])).get("vectors")!;
	assert.ok(manual.p < graded.p);
	assert.equal(manual.state, "shaky");
});

test("a goal's scope is its units' concepts plus the outside prerequisites they rest on", () => {
	const scope = goalScope(course(), { unitIds: ["unit-spaces"] });
	assert.deepEqual(scope.core, ["span", "linear-independence", "basis", "dimension"]);
	assert.deepEqual(scope.assumed, ["vectors", "linear-combination"]);
	assert.deepEqual(diagnosticCandidates(course(), { unitIds: ["unit-spaces"] }), ["linear-combination", "span", "linear-independence", "basis", "dimension"]);
});

function withDiagnostic(evidence: Evidence[], answered: string[], written?: string[]): { c: Course; g: Goal } {
	const base = course(evidence);
	const candidates = written ?? diagnosticCandidates(base, { unitIds: ["unit-spaces", "unit-maps"] });
	const diagnostic: Diagnostic = {
		status: "in-progress",
		questions: candidates.map((id) => ({ id: `q_${id}`, conceptId: id, question: "?", options: ["a", "b", "c", "d"], correctIndex: 0, explanation: "" })),
		answers: answered.map((id) => ({ questionId: `q_${id}`, conceptId: id, choice: 0, correct: true, at: "2026-11-10T10:00:00.000Z" })),
	};
	const g = goal(["unit-spaces", "unit-maps"], "2026-12-01", { diagnostic });
	return { c: { ...base, goals: [g] }, g };
}

test("the diagnostic opens in the middle of the graph, not at an end", () => {
	const { c, g } = withDiagnostic([], []);
	const first = nextDiagnosticConcept(c, g)!;
	const index = indexCourse(c);
	assert.ok(index.byId.get(first)!.prereqs.length > 0, "not a starting point");
	assert.ok(index.dependents.get(first)!.length > 0, "not an end point");
});

test("the diagnostic never repeats a question and only asks what has been written", () => {
	const { c, g } = withDiagnostic([], ["basis"], ["basis", "kernel"]);
	assert.equal(nextDiagnosticConcept(c, g), "kernel");
	const none = withDiagnostic([], ["basis", "kernel"], ["basis", "kernel"]);
	assert.equal(nextDiagnosticConcept(none.c, none.g), null);
});

test("the diagnostic stops once the answers settle every concept", () => {
	// Simulate a learner who knows everything: answer whatever is asked, correctly.
	let state = withDiagnostic([], []);
	const asked: string[] = [];
	for (let i = 0; i < 30; i++) {
		const next = nextDiagnosticConcept(state.c, state.g);
		if (!next) break;
		asked.push(next);
		state = withDiagnostic(asked.map((id, n) => ev(id, true, `2026-11-10T10:00:0${n}.000Z`)), asked);
	}
	const total = diagnosticCandidates(state.c, state.g).length;
	assert.ok(asked.length > 0 && asked.length < total, `asked ${asked.length} of ${total} — inference spares the rest`);
	assert.equal(new Set(asked).size, asked.length);
	const mastery = masteryOf(state.c);
	assert.ok(diagnosticCandidates(state.c, state.g).every((id) => mastery.get(id)!.state !== "new" && mastery.get(id)!.state !== "untested"));
});

test("the diagnostic respects its question budget", () => {
	assert.equal(diagnosticBudget(3), 3);
	assert.equal(diagnosticBudget(10), 8);
	assert.equal(diagnosticBudget(30), 23);
	assert.equal(diagnosticBudget(200), 30);
});

test("a plan covers every unlearned concept once, prerequisites first, before the exam", () => {
	const c = course();
	const g = goal(["unit-spaces", "unit-maps"], "2026-11-29");
	const plan = buildPlan(c, g, "2026-11-19", { minutesPerDay: 45, weekdays: [0, 1, 2, 3, 4, 5, 6] }, new Date("2026-11-19T09:00:00Z"));
	const learn = plan.sessions.filter((s) => s.kind === "learn");
	const taught = learn.flatMap((s) => s.conceptIds);
	const scope = goalScope(c, g);
	assert.deepEqual([...taught].sort(), [...scope.core, ...scope.assumed].sort(), "every concept, exactly once");
	const index = indexCourse(c);
	const position = new Map(taught.map((id, i) => [id, i]));
	for (const id of taught) for (const p of index.byId.get(id)!.prereqs) assert.ok(position.get(p)! < position.get(id)!, `${p} is taught before ${id}`);
	assert.ok(plan.sessions.every((s) => s.date >= "2026-11-19" && s.date < "2026-11-29"), "nothing on or after exam day");
	assert.deepEqual(learn.map((s) => s.date), [...learn.map((s) => s.date)].sort(), "sessions in date order");
	assert.equal(plan.neededMinutesPerDay, undefined);
});

test("with room to spare the last days are a practice exam and a final review", () => {
	const plan = buildPlan(course(), goal(["unit-spaces"], "2026-11-29"), "2026-11-19");
	const tail = plan.sessions.slice(-2);
	assert.deepEqual(tail.map((s) => [s.date, s.title]), [["2026-11-27", "Practice exam"], ["2026-11-28", "Final review"]]);
	assert.equal(tail[0]!.kind, "practice");
	const days = plan.sessions.map((s) => s.date);
	assert.equal(new Set(days).size, days.length, "one session per day");
});

test("solid concepts are left out of the plan", () => {
	const c = course([ev("dimension", true), ev("linear-independence", true, "2026-11-10T10:00:01.000Z")]);
	const plan = buildPlan(c, goal(["unit-spaces"], "2026-11-29"), "2026-11-19");
	const taught = plan.sessions.filter((s) => s.kind === "learn").flatMap((s) => s.conceptIds);
	assert.ok(!taught.includes("dimension") && !taught.includes("linear-independence"), "answered right: left out");
	assert.ok(taught.includes("basis") && taught.includes("span"), "only implied by one answer: still shaky, so they get a short revisit");
});

test("a plan that cannot fit says how much time it really needs", () => {
	const plan = buildPlan(course(), goal(["unit-spaces", "unit-maps"], "2026-11-21"), "2026-11-19", { minutesPerDay: 20, weekdays: [0, 1, 2, 3, 4, 5, 6] });
	assert.ok((plan.neededMinutesPerDay ?? 0) > 20);
	assert.equal(plan.sessions.filter((s) => s.kind === "learn").flatMap((s) => s.conceptIds).length, 9, "still covers everything");
});

test("a plan only uses the learner's study days", () => {
	// 2026-11-19 is a Thursday; study on Mondays and Wednesdays only.
	const plan = buildPlan(course(), goal(["unit-spaces"], "2026-12-10"), "2026-11-19", { minutesPerDay: 45, weekdays: [1, 3] });
	assert.ok(plan.sessions.length > 0);
	for (const s of plan.sessions) assert.ok([1, 3].includes(new Date(`${s.date}T00:00:00Z`).getUTCDay()), s.date);
});

test("rebuilding keeps finished sessions and replans the rest from today", () => {
	const c = course();
	const g = goal(["unit-spaces"], "2026-11-29");
	const first = buildPlan(c, g, "2026-11-19");
	first.sessions[0]!.status = "done";
	const done = first.sessions[0]!;
	const learned = done.conceptIds.map((id, n) => ev(id, true, `2026-11-19T10:00:0${n}.000Z`, "session"));
	const later = { ...c, evidence: learned };
	assert.equal(overdueSessions(first, "2026-11-22").length > 0, true);
	const second = buildPlan(later, { ...g, plan: first }, "2026-11-22");
	assert.ok(second.sessions.some((s) => s.id === done.id && s.status === "done"));
	const upcoming = second.sessions.filter((s) => s.status === "upcoming");
	assert.ok(upcoming.every((s) => s.date >= "2026-11-22"));
	assert.ok(!upcoming.filter((s) => s.kind === "learn").flatMap((s) => s.conceptIds).some((id) => done.conceptIds.includes(id)), "what was learned is not replanned");
	assert.equal(currentSession(second, "2026-11-22")?.status, "upcoming");
});

test("an exam that has passed leaves nothing to plan", () => {
	const plan = buildPlan(course(), goal(["unit-spaces"], "2026-11-01"), "2026-11-19");
	assert.deepEqual(plan.sessions, []);
});

test("a teaching chat's graded checks become evidence on the concepts they name", () => {
	const messages = [
		{ role: "assistant", content: [
			{ type: "toolCall", id: "call_1", name: "quiz", arguments: { nodeId: "span" } },
			{ type: "toolCall", id: "call_2", name: "quiz", arguments: { nodeId: "warm-up" } },
			{ type: "toolCall", id: "call_3", name: "quiz", arguments: { nodeId: "the-basis" } },
			{ type: "toolCall", id: "call_4", name: "quiz", arguments: { nodeId: "dimension" } },
			{ type: "toolCall", id: "call_5", name: "ask_user_question", arguments: {} },
		] },
		{ role: "toolResult", toolName: "quiz", toolCallId: "call_1", details: { kind: "quiz", correct: true, answeredAt: "2026-11-19T10:00:00.000Z" } },
		{ role: "toolResult", toolName: "quiz", toolCallId: "call_2", details: { kind: "quiz", correct: true, answeredAt: "2026-11-19T10:01:00.000Z" } },
		{ role: "toolResult", toolName: "quiz", toolCallId: "call_3", details: { kind: "quiz", correct: false, answeredAt: "2026-11-19T10:02:00.000Z" } },
		{ role: "toolResult", toolName: "quiz", toolCallId: "call_4", details: { kind: "quiz", dismissed: true, answeredAt: "2026-11-19T10:03:00.000Z" } },
	];
	const evidence = evidenceFromChat("chat_1", messages, course().concepts, [{ id: "the-basis", title: "Basis" }, { id: "warm-up", title: "Warm-up" }]);
	assert.deepEqual(evidence.map((e) => [e.conceptId, e.correct, e.id]), [
		["span", true, "chat:chat_1:call_1"],
		["basis", false, "chat:chat_1:call_3"],
	], "ids match directly, titles match by name; off-map and dismissed checks are skipped");
	assert.ok(evidence.every((e) => e.source === "session" && e.chatId === "chat_1"));
});

test("the browser never receives an unanswered question's key", () => {
	const { c } = withDiagnostic([], ["basis"]);
	const sent = publicCourse(c).goals[0]!.diagnostic!;
	const answered = sent.questions.find((q) => q.conceptId === "basis")!;
	const open = sent.questions.find((q) => q.conceptId === "kernel")!;
	assert.equal(answered.correctIndex, 0);
	assert.equal(open.correctIndex, -1);
	assert.equal(open.explanation, "");
	assert.equal(c.goals[0]!.diagnostic!.questions.find((q) => q.conceptId === "kernel")!.correctIndex, 0, "the stored record is untouched");
});

test("a course summary reports progress and the next goal", () => {
	const c = course([ev("rank-nullity", true)], [goal(["unit-spaces"], "2026-12-01"), { ...goal(["unit-maps"], "2026-11-01"), id: "goal_past" }]);
	const summary = summarizeCourse(c, "2026-11-19");
	assert.equal(summary.conceptCount, 9);
	assert.equal(summary.solidCount, 1, "only the concept answered right is solid");
	assert.ok(summary.progress > 0 && summary.progress <= 1);
	assert.deepEqual(summary.nextGoal, { id: "goal_1", title: "Midterm 1", date: "2026-12-01", daysLeft: 12 });
});

test("the knowledge meter is empty until an answer bears on the concepts", () => {
	const scope = goalScope(course(), { unitIds: ["unit-spaces"] }).core;
	assert.deepEqual(knowledgeOf(course(), scope), { value: null, answers: 0, measured: 0, total: 4, history: [] });
	// An answer on a concept that neither is in the set nor moves it does not count.
	const elsewhere = knowledgeOf(course([ev("rank-nullity", false)]), ["vectors"]);
	assert.equal(elsewhere.value, null);
});

test("the knowledge meter is set by the diagnostic and refined by every later answer", () => {
	const scope = goalScope(course(), { unitIds: ["unit-spaces"] }).core;
	const diagnostic = [ev("basis", true, "2026-11-10T10:00:00.000Z"), ev("dimension", false, "2026-11-10T10:01:00.000Z")];
	const first = knowledgeOf(course(diagnostic), scope);
	assert.equal(first.answers, 2);
	assert.equal(first.measured, 2);
	assert.equal(first.history.length, 2);
	assert.ok(first.history[0]!.value > 0.3, "the first right answer lifts the meter off its prior");
	assert.ok(first.history[1]!.value < first.history[0]!.value, "a miss pulls it back");
	assert.equal(first.value, first.history.at(-1)!.value);

	// A check in a later teaching session moves the same meter.
	const later = knowledgeOf(course([...diagnostic, ev("dimension", true, "2026-11-12T09:00:00.000Z", "session")]), scope);
	assert.equal(later.answers, 3);
	assert.ok(later.value! > first.value!);
	assert.deepEqual(later.history.slice(0, 2), first.history, "history is append-only");

	// An answer outside the set still counts when it moves the set through the graph.
	const outside = knowledgeOf(course([...diagnostic, ev("rank-nullity", true, "2026-11-13T09:00:00.000Z", "session")]), scope);
	assert.equal(outside.answers, 3);
	assert.ok(outside.value! > first.value!);
	assert.equal(outside.measured, 2, "but it measures no concept of the set directly");
});

test("the meter and the per-concept estimates agree", () => {
	const c = course([ev("span", true), ev("kernel", false, "2026-11-10T10:05:00.000Z")]);
	const all = c.concepts.map((x) => x.id);
	const mastery = masteryOf(c);
	const mean = all.reduce((sum, id) => sum + mastery.get(id)!.p, 0) / all.length;
	assert.ok(Math.abs(knowledgeOf(c, all).value! - mean) < 1e-12);
});
