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
	calendarPrompt,
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
	planOutline,
	progressOf,
	publicCourse,
	sessionPace,
	slugify,
	stepOf,
	studiedMinutes,
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

test("a plan that cannot fit keeps to the learner's time and says what it gave up", () => {
	const c = course();
	const g = goal(["unit-spaces", "unit-maps"], "2026-11-21");
	const plan = buildPlan(c, g, "2026-11-19", { minutesPerDay: 20, weekdays: [0, 1, 2, 3, 4, 5, 6] });
	const learn = plan.sessions.filter((s) => s.kind === "learn");
	const taught = learn.flatMap((s) => s.conceptIds);
	assert.ok(learn.every((s) => s.minutes <= 20), "no session is longer than the day's time");
	assert.ok((plan.neededMinutesPerDay ?? 0) > 20, "what all of it would take is still said");
	const scope = goalScope(c, g);
	assert.deepEqual([...taught, ...plan.left!].sort(), [...scope.core, ...scope.assumed].sort(), "every concept is either taught or named as left out");
	// What the goal only rests on goes first; its own material is cut last.
	for (const id of scope.assumed) assert.ok(plan.left!.includes(id), `${id} is earlier material`);
	assert.ok(taught.length > 0 && taught.every((id) => scope.core.includes(id)));
	assert.equal(plan.pace, 0.6, "and gets a quicker pass before any of it is dropped");
	// Of the goal's own, the concepts the most is built on are the ones kept.
	const index = indexCourse(c);
	const builtOn = (id: string) => scope.core.filter((other) => index.byId.get(other)!.prereqs.includes(id)).length;
	assert.ok(Math.min(...taught.map(builtOn)) >= Math.max(...plan.left!.filter((id) => scope.core.includes(id)).map(builtOn)) - 1);
});

test("with a little more time only the earlier material is left out, at the usual pace", () => {
	const c = course();
	const g = goal(["unit-spaces", "unit-maps"], "2026-11-21");
	// Seven concepts of its own at 20 minutes: 140 minutes over two days.
	const plan = buildPlan(c, g, "2026-11-19", { minutesPerDay: 70, weekdays: [0, 1, 2, 3, 4, 5, 6] });
	const scope = goalScope(c, g);
	assert.deepEqual(plan.left, scope.assumed);
	assert.equal(plan.pace, undefined);
	assert.deepEqual(plan.sessions.filter((s) => s.kind === "learn").flatMap((s) => s.conceptIds).sort(), [...scope.core].sort());
});

test("a day can have its own time, or be a day off", () => {
	const g = goal(["unit-spaces"], "2026-11-24");
	const prefs = { minutesPerDay: 40, weekdays: [0, 1, 2, 3, 4, 5, 6], days: { "2026-11-20": 0, "2026-11-21": 120, "2026-11-01": 90 } };
	const plan = buildPlan(course(), g, "2026-11-19", prefs);
	assert.ok(!plan.sessions.some((s) => s.date === "2026-11-20"), "nothing on the day off");
	const long = plan.sessions.find((s) => s.date === "2026-11-21")!;
	const short = plan.sessions.find((s) => s.date === "2026-11-19")!;
	assert.ok(long.conceptIds.length > short.conceptIds.length, "the long day carries more");
	assert.deepEqual(plan.prefs.days, { "2026-11-20": 0, "2026-11-21": 120 }, "a day already past is dropped from the settings");
});

test("the learner can leave concepts out, drop the earlier material, and drop the practice exam", () => {
	const c = course();
	const g = goal(["unit-spaces"], "2026-11-29");
	const taught = (prefs: Parameters<typeof buildPlan>[3]) => buildPlan(c, g, "2026-11-19", prefs).sessions.filter((s) => s.kind === "learn").flatMap((s) => s.conceptIds);
	const base = { minutesPerDay: 45, weekdays: [0, 1, 2, 3, 4, 5, 6] };
	assert.ok(taught(base).includes("vectors"));
	assert.ok(!taught({ ...base, skip: ["span"] }).includes("span"));
	assert.deepEqual(taught({ ...base, prerequisites: false }).sort(), [...goalScope(c, g).core].sort());
	const titles = (prefs: Parameters<typeof buildPlan>[3]) => buildPlan(c, g, "2026-11-19", prefs).sessions.map((s) => s.title);
	assert.ok(titles(base).includes("Practice exam"));
	assert.ok(!titles({ ...base, practice: false }).includes("Practice exam") && titles({ ...base, practice: false }).includes("Final review"));
});

test("rebuilding keeps the chat of a session already begun", () => {
	const c = course();
	const g = goal(["unit-spaces"], "2026-11-29");
	const first = buildPlan(c, g, "2026-11-19");
	first.sessions[0]!.chatId = "chat_1";
	const second = buildPlan(c, { ...g, plan: first }, "2026-11-19", { minutesPerDay: 90, weekdays: [0, 1, 2, 3, 4, 5, 6] });
	assert.equal(second.sessions.find((s) => s.date === first.sessions[0]!.date)?.chatId, "chat_1");
	assert.equal(second.sessions.filter((s) => s.chatId).length, 1);
});

test("the plan by unit: when each is covered and how much of it is held", () => {
	const c = course([ev("span", true), ev("basis", true, "2026-11-10T10:01:00.000Z")]);
	const g = goal(["unit-spaces"], "2026-11-29");
	g.plan = buildPlan(c, g, "2026-11-19");
	const outline = planOutline(c, g);
	const spaces = outline.find((u) => u.unitId === "unit-spaces")!;
	assert.equal(spaces.role, "core");
	assert.equal(spaces.concepts, 4);
	assert.equal(spaces.solid, 2);
	assert.ok(spaces.progress > 0.5 && spaces.progress < 1);
	const dates = g.plan.sessions.filter((s) => s.kind === "learn" && s.conceptIds.some((id) => ["linear-independence", "dimension"].includes(id))).map((s) => s.date);
	assert.equal(spaces.from, dates[0]);
	assert.equal(spaces.to, dates.at(-1));
	assert.equal(spaces.upcoming, 2, "the two that are not solid yet");
	assert.ok(g.plan.sessions.some((s) => s.id === spaces.sessionId));
	// Earlier material shows only while the plan spends time on it.
	const vectors = outline.find((u) => u.unitId === "unit-vectors");
	assert.equal(vectors?.role, "earlier");
	assert.equal(planOutline(c, { ...g, plan: buildPlan(c, g, "2026-11-19", { minutesPerDay: 45, weekdays: [0, 1, 2, 3, 4, 5, 6], prerequisites: false }) }).some((u) => u.unitId === "unit-vectors"), false);
	// A unit the plan had no time for says so.
	const tight = goal(["unit-spaces", "unit-maps"], "2026-11-21");
	tight.plan = buildPlan(course(), tight, "2026-11-19", { minutesPerDay: 20, weekdays: [0, 1, 2, 3, 4, 5, 6] });
	const maps = planOutline(course(), tight).find((u) => u.unitId === "unit-maps")!;
	assert.ok(maps.left > 0);
});

test("the calendar prompt lists the sessions still to do, with full dates", () => {
	const c = course();
	const g = goal(["unit-spaces"], "2026-11-29");
	g.plan = buildPlan(c, g, "2026-11-19");
	g.plan.sessions[0]!.status = "done";
	const prompt = calendarPrompt(c, g, "2026-11-19");
	const upcoming = g.plan.sessions.filter((s) => s.status === "upcoming");
	const lines = prompt.split("\n").filter((line) => /^\d+\. /.test(line));
	assert.equal(lines.length, upcoming.length, "one line per session, the finished one left out");
	assert.match(lines[0]!, new RegExp(`^1\\. ${upcoming[0]!.date} \\((Sun|Mon|Tue|Wed|Thu|Fri|Sat)\\) \\| \\d+ (min|h)`));
	assert.ok(lines.some((line) => line.includes("Midterm 1: Practice exam")));
	assert.match(prompt, /The exam: 2026-11-29 \(Sun\) \| Midterm 1 \(Linear Algebra\)/);
	assert.match(prompt, /Don't move, shorten or delete anything/);
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

test("time studied counts the work, not the breaks", () => {
	const at = (minute: number) => Date.UTC(2026, 10, 24, 14, 0) + minute * 60_000;
	assert.equal(studiedMinutes([], at(30)), 0);
	assert.equal(studiedMinutes([at(0), at(3), at(7), at(12)], at(14)), 14, "steady back-and-forth counts in full");
	// A forty-minute gap is a break: only the first eight minutes of it count.
	assert.equal(studiedMinutes([at(0), at(5), at(45), at(50)], at(52)), 5 + 8 + 5 + 2);
	assert.equal(studiedMinutes([at(0)], at(600)), 8, "a chat left open is not hours of study");
	assert.equal(studiedMinutes([at(5), at(0), at(90)], at(10)), 10, "order does not matter, and nothing from the future counts");
});

test("a session's pace is read against the time its plan gave it", () => {
	const session = { minutes: 120, conceptIds: ["a", "b", "c", "d", "e", "f"] }; // 20 minutes a concept
	assert.equal(sessionPace(session, 0, 12).standing, "on pace", "part-way through the first concept is not behind");
	assert.deepEqual(
		(({ standing, lead, leftPerConcept }) => ({ standing, lead, leftPerConcept }))(sessionPace(session, 2, 40)),
		{ standing: "on pace", lead: 0, leftPerConcept: 20 },
	);
	const behind = sessionPace(session, 1, 55);
	assert.equal(behind.standing, "behind");
	assert.equal(behind.lead, -35);
	assert.equal(behind.leftPerConcept, 13, "65 minutes left for five concepts");
	assert.equal(sessionPace(session, 3, 40).standing, "ahead");
	assert.equal(sessionPace(session, 4, 125).standing, "over time");
	assert.equal(sessionPace(session, 4, 125).leftPerConcept, 0);
	assert.equal(sessionPace(session, 6, 90).standing, "done");
	assert.equal(sessionPace(session, 9, 90).checked, 6, "never more than the session holds");
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
	const mean = all.reduce((sum, id) => sum + mastery.get(id)!.likely, 0) / all.length;
	assert.ok(Math.abs(knowledgeOf(c, all).value! - mean) < 1e-12);
});

test("an untested concept is read against how the diagnostic went around it", () => {
	const at = (n: number) => `2026-11-10T10:0${n}:00.000Z`;
	// Unit "spaces": three of its four concepts asked. "kernel" sits in another unit.
	const aced = masteryOf(course([ev("span", true, at(0)), ev("linear-independence", true, at(1)), ev("basis", true, at(2))]));
	const missed = masteryOf(course([ev("span", false, at(0)), ev("linear-independence", false, at(1)), ev("basis", false, at(2))]));
	assert.ok(aced.get("linear-map")!.likely > 0.6, "someone who gets everything right probably knows the rest");
	assert.ok(missed.get("linear-map")!.likely < 0.15, "someone who knows none of it probably does not");
	// The evidence-only estimate, and so the state, does not move.
	assert.equal(aced.get("linear-map")!.p, 0.3);
	assert.equal(aced.get("linear-map")!.state, "untested");
	assert.equal(missed.get("linear-map")!.state, "untested");
	// The concept's own unit weighs more than the rest of the course.
	const mixed = masteryOf(course([ev("vectors", true, at(0)), ev("linear-combination", true, at(1)), ev("linear-map", false, at(2)), ev("kernel", false, at(3))]));
	assert.ok(mixed.get("rank-nullity")!.likely < 0.2, "its own unit went badly");
	assert.ok(mixed.get("rank-nullity")!.likely < mixed.get("dimension")!.likely, "a unit with no answers takes the course's rate");
});

test("a concept's own answer is not counted twice, and a right answer still reads as known", () => {
	const one = masteryOf(course([ev("basis", true)])).get("basis")!;
	assert.equal(one.likely, one.p, "its own answer is left out of its own rate");
	// One hit among misses: likely a real one, since "I don't know" was on offer.
	const at = (n: number) => `2026-11-10T10:0${n}:00.000Z`;
	const lone = masteryOf(course([ev("span", false, at(0)), ev("linear-independence", false, at(1)), ev("dimension", true, at(2))])).get("dimension")!;
	assert.ok(lone.likely > 0.5 && lone.likely < lone.p);
});

test("teaching one concept says nothing about the ones beside it", () => {
	const diagnostic = [ev("span", false, "2026-11-10T10:00:00.000Z"), ev("linear-independence", false, "2026-11-10T10:01:00.000Z")];
	const before = masteryOf(course(diagnostic));
	const taught = masteryOf(course([
		...diagnostic,
		ev("span", true, "2026-11-12T09:00:00.000Z", "session"),
		ev("span", true, "2026-11-13T09:00:00.000Z", "session"),
	]));
	assert.ok(taught.get("span")!.likely > 0.8, "what was taught and checked twice is held");
	assert.equal(taught.get("dimension")!.likely, before.get("dimension")!.likely, "the untaught concept beside it is not");
});

// ─── the meter against learners whose knowledge is known ─────────────────────

/** A course of `units` units of `size` concepts, each resting on up to two earlier ones. */
function syntheticCourse(units: number, size: number, random: () => number): Course {
	const concepts: CourseConcept[] = [];
	for (let u = 0; u < units; u++) {
		for (let k = 0; k < size; k++) {
			const earlier = concepts.slice(Math.max(0, concepts.length - size * 2));
			const prereqs = earlier.length === 0 ? [] : [...new Set([0, 1].map(() => earlier[Math.floor(random() * earlier.length)]!.id))];
			concepts.push(concept(`c-${u}-${k}`, `u-${u}`, prereqs));
		}
	}
	return { ...course(), units: Array.from({ length: units }, (_, u) => ({ id: `u-${u}`, title: `Unit ${u}` })), concepts };
}

/** Run a whole diagnostic for a learner who knows exactly `known`; return the meter and the truth. */
function diagnose(base: Course, known: ReadonlySet<string>, random: () => number): { meter: number; truth: number } {
	const ids = base.concepts.map((c) => c.id);
	const g = goal(base.units.map((u) => u.id), "2026-12-20", {
		diagnostic: { status: "ready", startedAt: "2026-11-10T00:00:00.000Z", answers: [], questions: ids.map((id) => ({ id: `q_${id}`, conceptId: id, question: "?", options: ["a", "b", "c", "d"], correctIndex: 0, explanation: "" })) },
	});
	const c: Course = { ...base, evidence: [], goals: [g] };
	for (let n = 0; ; n++) {
		const id = nextDiagnosticConcept(c, g);
		if (!id) break;
		// A slip one time in ten; a guess at what is not known lands now and then.
		const correct = known.has(id) ? random() < 0.9 : random() < 0.075;
		const at = new Date(Date.UTC(2026, 10, 10, 10, 0, n)).toISOString();
		g.diagnostic!.answers.push({ questionId: `q_${id}`, conceptId: id, choice: 0, correct, at });
		c.evidence.push({ id: `e${n}`, conceptId: id, correct, at, source: "diagnostic", goalId: g.id });
	}
	return { meter: knowledgeOf(c, ids).value!, truth: ids.filter((id) => known.has(id)).length / ids.length };
}

test("the meter after a diagnostic is close to what the learner actually knows", () => {
	let seed = 20261124;
	const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
	const base = syntheticCourse(8, 8, random);
	const ids = base.concepts.map((c) => c.id);
	const average = (runs: { meter: number; truth: number }[], f: (r: { meter: number; truth: number }) => number) => runs.reduce((sum, r) => sum + f(r), 0) / runs.length;
	const repeat = (known: () => ReadonlySet<string>) => Array.from({ length: 12 }, () => diagnose(base, known(), random));

	const none = repeat(() => new Set());
	const all = repeat(() => new Set(ids));
	assert.ok(average(none, (r) => r.meter) < 0.08, `knowing nothing reads near zero (${average(none, (r) => r.meter).toFixed(3)})`);
	assert.ok(average(all, (r) => r.meter) > 0.85, `knowing everything reads near full (${average(all, (r) => r.meter).toFixed(3)})`);

	// Part-way through the course, with a few holes: the common case.
	const partway = Array.from({ length: 40 }, () => {
		const reached = Math.floor(random() * 9) * 8;
		return diagnose(base, new Set(ids.filter((_, i) => i < reached && random() > 0.1)), random);
	});
	const error = average(partway, (r) => Math.abs(r.meter - r.truth));
	const bias = average(partway, (r) => r.meter - r.truth);
	assert.ok(error < 0.1, `mean error under ten points (${error.toFixed(3)})`);
	assert.ok(Math.abs(bias) < 0.06, `no lean either way (${bias.toFixed(3)})`);
});

test("a long session is named after its unit, numbered when the unit runs over several", () => {
	const c = course();
	c.units = [{ id: "unit-a", title: "Determinants" }, { id: "unit-b", title: "Eigenvalues" }];
	c.concepts = [
		...Array.from({ length: 8 }, (_, i) => concept(`a${i}`, "unit-a", i > 0 ? [`a${i - 1}`] : [])),
		...Array.from({ length: 4 }, (_, i) => concept(`b${i}`, "unit-b", i > 0 ? [`b${i - 1}`] : ["a7"])),
	];
	const g = goal(["unit-a", "unit-b"], "2026-12-20");
	// 20 minutes a concept, 80 a day: four concepts to a session.
	const plan = buildPlan(c, g, "2026-11-19", { minutesPerDay: 80, weekdays: [0, 1, 2, 3, 4, 5, 6] }, new Date("2026-11-19T09:00:00Z"));
	assert.deepEqual(plan.sessions.filter((s) => s.kind === "learn").map((s) => s.title), ["Determinants, part 1", "Determinants, part 2", "Eigenvalues"]);
	// One or two concepts are simply named.
	const short = buildPlan(c, g, "2026-11-19", { minutesPerDay: 40, weekdays: [0, 1, 2, 3, 4, 5, 6] }, new Date("2026-11-19T09:00:00Z"));
	assert.equal(short.sessions.find((s) => s.kind === "learn")!.title, "a0, then a1");
});

test("a course's next step follows the flow: goal, diagnostic, plan, then the session due", () => {
	const today = "2026-11-19";
	assert.deepEqual(stepOf({ ...course(), build: { status: "mapping", done: 0, total: 3, found: [] } }, today), { kind: "building" });
	assert.deepEqual(stepOf({ ...course(), concepts: [] }, today), { kind: "material", failed: false });
	assert.deepEqual(stepOf(course(), today), { kind: "goal" });

	const fresh = goal(["unit-spaces"], "2026-12-01");
	assert.deepEqual(stepOf(course([], [fresh]), today), { kind: "diagnostic", goalId: fresh.id, state: "new" });
	const waiting: Diagnostic = { status: "ready", questions: [], answers: [] };
	assert.deepEqual(stepOf(course([], [{ ...fresh, diagnostic: waiting }]), today), { kind: "diagnostic", goalId: fresh.id, state: "ready" });
	const taken: Diagnostic = { status: "done", questions: [], answers: [] };
	assert.deepEqual(stepOf(course([], [{ ...fresh, diagnostic: taken }]), today), { kind: "plan", goalId: fresh.id });

	const c = course([], [{ ...fresh, diagnostic: taken }]);
	const plan = buildPlan(c, c.goals[0]!, today, { minutesPerDay: 45, weekdays: [0, 1, 2, 3, 4, 5, 6] }, new Date("2026-11-19T09:00:00Z"));
	c.goals[0]!.plan = plan;
	const first = plan.sessions[0]!;
	assert.deepEqual(stepOf(c, today), {
		kind: "session", goalId: fresh.id, sessionId: first.id, title: first.title, date: first.date,
		minutes: first.minutes, concepts: first.conceptIds.length, started: false, sessionKind: first.kind,
	});
	// A day later the first session is overdue; once everything is done there is nothing left.
	assert.deepEqual(stepOf(c, addDays(first.date, 1)), { kind: "overdue", goalId: fresh.id, count: 1 });
	for (const s of plan.sessions) s.status = "done";
	assert.deepEqual(stepOf(c, today), { kind: "done", goalId: fresh.id });
});

test("a course summary carries its next step and the sessions that have a chat", () => {
	const g = goal(["unit-spaces"], "2026-12-01");
	const c = course([], [g]);
	c.goals[0]!.plan = buildPlan(c, g, "2026-11-19", { minutesPerDay: 45, weekdays: [0, 1, 2, 3, 4, 5, 6] }, new Date("2026-11-19T09:00:00Z"));
	const first = c.goals[0]!.plan.sessions[0]!;
	first.chatId = "chat_1";
	const summary = summarizeCourse(c, "2026-11-19");
	assert.equal(summary.step.kind, "session");
	assert.ok(summary.step.kind === "session" && summary.step.started, "the due session already has a chat");
	assert.deepEqual(summary.sessions, [{ chatId: "chat_1", sessionId: first.id, goalId: g.id, title: first.title, done: false }]);
});
