/**
 * course-markdown — course text on screen follows the record. The Markdown
 * renderer keeps a paragraph whose source span is unchanged, so a text that
 * replaces another of the same length in the same place has to be rendered
 * afresh (components/course/parts.tsx `Md`).
 */
import React, { act } from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { DiagnosticRun } from "../components/course/diagnostic.tsx";
import { Md } from "../components/course/parts.tsx";
import type { CourseView } from "../components/course/api.ts";
import { masteryOf, type Course, type CourseConcept, type DiagnosticQuestion, type Goal } from "../src/core/course.ts";

(globalThis as Record<string, unknown>).React = React;
const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, CustomEvent: dom.window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true });

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

test("a text replaced by another of the same length shows the new one", async () => {
	await mounted(async (host, render) => {
		await render(<Md>first answer here</Md>);
		assert.equal(host.textContent, "first answer here");
		await render(<Md>other answer here</Md>);
		assert.equal(host.textContent, "other answer here");
	});
});

// The two options, 23 characters each, that shared slot B in a real run.
const ENERGY = String.raw`$\Delta K_{trans} = Nd$`;
const CROSS = String.raw`$\langle 6,-3,1\rangle$`;

const questions: DiagnosticQuestion[] = [
	{ id: "q_energy", conceptId: "energy", question: "Which equation is the energy principle?", options: ["one", ENERGY, "three", "four"], correctIndex: 3, explanation: "" },
	{ id: "q_cross", conceptId: "cross", question: "What is the cross product?", options: ["five", CROSS, "seven", "eight"], correctIndex: 1, explanation: "" },
];

function view(next: string, answered: string[] = []): CourseView {
	const goal: Goal = {
		id: "goal_1", title: "Midterm 3", kind: "midterm", date: "2026-12-01", unitIds: ["unit"], createdAt: "2026-11-01T00:00:00.000Z",
		diagnostic: {
			status: "ready", questions, startedAt: "2026-11-01T00:00:00.000Z",
			answers: answered.map((conceptId) => ({ questionId: `q_${conceptId}`, conceptId, choice: null, correct: false, at: "2026-11-24T05:00:00.000Z" })),
		},
	};
	const course: Course = {
		id: "course_test", version: 1, title: "Mechanics", createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z",
		sources: [], units: [{ id: "unit", title: "Unit" }],
		evidence: answered.map((conceptId) => ({ id: `e_${conceptId}`, conceptId, correct: false, at: "2026-11-24T05:00:00.000Z", source: "diagnostic", goalId: "goal_1" })),
		concepts: ["energy", "cross"].map((id): CourseConcept => ({ id, unitId: "unit", title: id, summary: "", kind: "idea", prereqs: [], refs: [] })),
		goals: [goal], suggestions: [], build: { status: "ready", done: 0, total: 0, found: [] },
	};
	return { ...course, today: "2026-11-24", mastery: Object.fromEntries(masteryOf(course)), nextQuestion: { goal_1: next } };
}

test("the diagnostic shows each question's own options", async () => {
	const optionB = (host: HTMLElement) => host.querySelector('[data-testid="diagnostic-option-1"] annotation')?.textContent;
	const run = (course: CourseView) => <DiagnosticRun course={course} goal={course.goals[0]!} adopt={() => {}} onClose={() => {}} onPlan={() => {}} />;
	await mounted(async (host, render) => {
		await render(run(view("q_energy")));
		assert.equal(optionB(host), ENERGY.slice(1, -1));
		await render(run(view("q_cross")));
		assert.match(host.querySelector('[data-testid="diagnostic-question"]')!.textContent!, /cross product/);
		assert.equal(optionB(host), CROSS.slice(1, -1), "slot B must not keep the previous question's option");
	});
});

test("the diagnostic's bar is how far through the quiz it is; the estimate is said in words", async () => {
	const run = (course: CourseView) => <DiagnosticRun course={course} goal={course.goals[0]!} adopt={() => {}} onClose={() => {}} onPlan={() => {}} />;
	const bar = (host: HTMLElement) => host.querySelector('[role="progressbar"]')!;
	await mounted(async (host, render) => {
		await render(run(view("q_energy")));
		assert.equal(host.querySelector('[data-testid="diagnostic-count"]')!.textContent, "Question 1 of at most 2");
		assert.equal(bar(host).getAttribute("aria-valuenow"), "50");
		assert.equal(host.querySelector('[data-testid="diagnostic-meter"]')!.textContent, "", "no estimate before the first answer");

		await render(run(view("q_cross", ["energy"])));
		assert.equal(host.querySelector('[data-testid="diagnostic-count"]')!.textContent, "Question 2 of at most 2");
		assert.equal(bar(host).getAttribute("aria-valuenow"), "100", "the last question fills the bar, whatever the estimate");
		assert.match(host.querySelector('[data-testid="diagnostic-meter"]')!.textContent!, /^Estimate so far: you know about \d+% of Midterm 3\.$/);
	});
});
