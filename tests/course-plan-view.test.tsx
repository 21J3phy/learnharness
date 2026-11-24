/**
 * course-plan-view — the plan read back on the course page: its units with
 * their days and progress, what it gave up, the calendar prompt, and the
 * conversation that changes it (components/course/plan-view.tsx).
 */
import React, { act } from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { PlanView, planNote } from "../components/course/plan-view.tsx";
import type { CourseView } from "../components/course/api.ts";
import { buildPlan, goalScope, indexCourse, masteryOf, type Course, type CourseConcept, type Goal, type PlanPrefs } from "../src/core/course.ts";

(globalThis as Record<string, unknown>).React = React;
const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, CustomEvent: dom.window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true });

const TODAY = "2026-11-24";
const concept = (id: string, unitId: string, prereqs: string[] = []): CourseConcept => ({ id, unitId, title: id, summary: "", kind: "idea", prereqs, refs: [] });

function view(prefs: PlanPrefs, chat: Goal["planChat"] = []): CourseView {
	const goal: Goal = { id: "goal_1", title: "Midterm 3", kind: "midterm", date: "2026-11-30", unitIds: ["u2", "u3"], createdAt: "2026-11-01T00:00:00.000Z", ...(chat!.length > 0 ? { planChat: chat } : {}) };
	const course: Course = {
		id: "course_test", version: 1, title: "Mechanics", createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z",
		sources: [], suggestions: [], build: { status: "ready", done: 0, total: 0, found: [] },
		units: [{ id: "u1", title: "Energy" }, { id: "u2", title: "Collisions" }, { id: "u3", title: "Torque" }],
		concepts: [
			concept("work", "u1"), concept("energy", "u1", ["work"]),
			concept("elastic", "u2", ["energy"]), concept("inelastic", "u2", ["elastic"]), concept("impulse", "u2", ["energy"]),
			concept("torque", "u3", ["impulse"]), concept("lever-arm", "u3", ["torque"]), concept("equilibrium", "u3", ["lever-arm"]),
		],
		evidence: [{ id: "e1", conceptId: "elastic", correct: true, at: "2026-11-23T10:00:00.000Z", source: "diagnostic" }],
		goals: [goal],
	};
	goal.plan = buildPlan(course, goal, TODAY, prefs, new Date("2026-11-24T08:00:00Z"));
	return { ...course, today: TODAY, mastery: Object.fromEntries(masteryOf(course)), nextQuestion: {} };
}

async function mounted(run: (host: HTMLElement, render: (node: React.ReactNode) => Promise<void>) => Promise<void>) {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	try {
		await run(host, (node) => act(async () => root.render(node)));
	} finally {
		await act(async () => root.unmount());
		host.remove();
	}
}

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const shown = (course: CourseView, handlers: Partial<React.ComponentProps<typeof PlanView>> = {}) => {
	const index = indexCourse(course);
	return <PlanView course={course} goal={course.goals[0]!} index={index} mastery={masteryOf(course, index)} adopt={() => {}} onPick={() => {}} onChanged={() => {}} onNeedsModels={() => {}} {...handlers} />;
};

test("each unit shows its days and how much of it is known", async () => {
	const course = view({ minutesPerDay: 60, weekdays: EVERY_DAY });
	const picked: string[] = [];
	await mounted(async (host, render) => {
		await render(shown(course, { onPick: (id) => picked.push(id) }));
		const row = (unit: string) => host.querySelector(`[data-testid="plan-unit-${unit}"]`)!;
		const cells = (unit: string) => Array.from(row(unit).querySelectorAll("td")).map((td) => td.textContent);
		assert.equal(cells("u2")[0], "Collisions");
		assert.match(cells("u2")[1]!, /Nov/, "a day of the plan");
		assert.equal(cells("u2")[2], "1 of 3", "one concept answered right");
		assert.equal(cells("u3")[2], "0 of 3");
		assert.match(cells("u1")[1]!, /Nov/, "earlier material the plan found room for");
		assert.equal(host.querySelector('[data-testid="plan-note"]'), null, "nothing was given up, so nothing is said");
		await act(async () => row("u3").querySelector("button")!.dispatchEvent(new dom.window.Event("click", { bubbles: true })));
		assert.ok(course.goals[0]!.plan!.sessions.some((s) => s.id === picked[0]), "picking a unit shows one of its sessions");
	});
});

test("a plan short of time says what it gave up, in the learner's terms", async () => {
	const course = view({ minutesPerDay: 15, weekdays: EVERY_DAY });
	const goal = course.goals[0]!;
	const note = planNote(goal.plan!, goal, new Set(goalScope(course, goal).core))!;
	assert.match(note, /^15 min a day doesn't stretch to everything before Nov 30, so this plan keeps to your time and puts what Midterm 3 covers first\./);
	assert.match(note, /2 earlier concepts it builds on are left out\./);
	assert.match(note, /would take about \d+ min a day\.$/);
	await mounted(async (host, render) => {
		await render(shown(course));
		assert.equal(host.querySelector('[data-testid="plan-note"]')!.textContent, note);
		assert.equal(host.querySelector('[data-testid="plan-unit-u1"]'), null, "an earlier unit the plan spends no time on is not listed");
	});
});

test("the calendar prompt is copied whole", async () => {
	const course = view({ minutesPerDay: 60, weekdays: EVERY_DAY });
	let copied = "";
	Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async (text: string) => { copied = text; } } } });
	await mounted(async (host, render) => {
		await render(shown(course));
		const button = host.querySelector('[data-testid="plan-copy"]')!;
		assert.equal(button.textContent, "Copy a prompt for your calendar");
		await act(async () => button.dispatchEvent(new dom.window.Event("click", { bubbles: true })));
		assert.match(copied, /^Please add my study plan for Midterm 3 \(Mechanics\) to my calendar\./);
		assert.match(copied, /\n1\. 2026-11-24 \(Tue\) \| /);
		assert.equal(button.textContent, "Copied. Paste it to your assistant");
	});
});

test("a message about the plan is sent, and the answer and the changed plan come back", async () => {
	const before = view({ minutesPerDay: 60, weekdays: EVERY_DAY });
	const after = view({ minutesPerDay: 60, weekdays: EVERY_DAY, days: { "2026-11-26": 0 } }, [
		{ role: "user", text: "I can't study on Thursday", at: "2026-11-24T09:00:00.000Z" },
		{ role: "assistant", text: "Thursday 26 Nov is now a day off.", at: "2026-11-24T09:00:05.000Z", changed: true },
	]);
	const originalFetch = globalThis.fetch;
	const requests: { url: string; body: unknown }[] = [];
	globalThis.fetch = async (input, init) => {
		requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
		return Response.json(after);
	};
	try {
		let current = before;
		let changed = 0;
		await mounted(async (host, render) => {
			const draw = () => render(shown(current, { adopt: (next) => { current = next; }, onChanged: () => { changed++; } }));
			await draw();
			assert.equal(host.querySelectorAll('[data-testid="plan-chat"] li').length, 0);
			// A starter fills the box; sending is the learner's own step.
			const starter = Array.from(host.querySelectorAll('[data-testid="plan-chat"] button')).find((b) => b.textContent === "I can't study on Thursday")!;
			await act(async () => starter.dispatchEvent(new dom.window.Event("click", { bubbles: true })));
			assert.equal(requests.length, 0);
			await act(async () => host.querySelector('[data-testid="plan-chat"] form')!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
			assert.deepEqual(requests, [{ url: "/api/courses/course_test/goals/goal_1/plan/chat", body: { message: "I can't study on Thursday" } }]);
			assert.equal(changed, 1, "the page is told the plan changed");
			await draw();
			const turns = Array.from(host.querySelectorAll('[data-testid="plan-chat"] li')).map((li) => [li.getAttribute("data-role"), li.textContent]);
			assert.deepEqual(turns, [["user", "I can't study on Thursday"], ["assistant", "Thursday 26 Nov is now a day off.Plan updated"]]);
			assert.ok(!current.goals[0]!.plan!.sessions.some((s) => s.date === "2026-11-26"), "nothing lands on the day off");
			assert.ok(!Array.from(host.querySelectorAll('[data-testid="plan-units"] td')).some((td) => /^Thu Nov 26/.test(td.textContent ?? "")));
		});
	} finally {
		globalThis.fetch = originalFetch;
	}
});
