"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { addDays, type GoalKind, type SuggestedGoal } from "@/src/core";
import { courseApi, type CourseView } from "./api";
import { ErrorNote, LinkButton, PrimaryButton, Tex, dayMonth, useAction } from "./parts";

const KIND_FROM_TITLE: [RegExp, GoalKind][] = [
	[/midterm/i, "midterm"],
	[/final/i, "final"],
	[/quiz/i, "quiz"],
	[/assignment|homework|problem set/i, "assignment"],
	[/test|exam/i, "test"],
];

const FIELD = "sy-focus h-11 w-full rounded-lg border border-border bg-background px-3 font-sans text-base placeholder:text-muted-foreground/70";

/**
 * "What are you studying for, and when?" — the name, the day, and the
 * units it covers. Assessments found in the material (a syllabus lists
 * them) are offered as one-click starting points.
 */
export function GoalForm({ course, onCreated, onCancel }: { course: CourseView; onCreated: (course: CourseView, goalId: string) => void; onCancel?: () => void }) {
	const [title, setTitle] = useState("");
	const [date, setDate] = useState("");
	const [units, setUnits] = useState<Set<string>>(new Set());
	const [note, setNote] = useState<string | undefined>();
	const action = useAction();
	const usable = course.suggestions.filter((s) => !s.date || s.date >= course.today);

	const use = (s: SuggestedGoal) => {
		setTitle(s.title);
		setDate(s.date ?? "");
		setUnits(new Set(s.unitIds));
		setNote(s.note);
	};
	const toggle = (id: string) => setUnits((prev) => {
		const next = new Set(prev);
		if (next.has(id)) next.delete(id); else next.add(id);
		return next;
	});
	const allSelected = units.size === course.units.length;
	const ready = title.trim().length > 0 && date.length > 0 && units.size > 0;

	const submit = () => void action.run(async () => {
		const kind = KIND_FROM_TITLE.find(([re]) => re.test(title))?.[1] ?? "test";
		const { course: next, goalId } = await courseApi.createGoal(course.id, { title: title.trim(), kind, date, unitIds: [...units], ...(note ? { note } : {}) });
		onCreated(next, goalId);
	});

	return (
		<form
			className="max-w-[40rem]"
			data-testid="goal-form"
			onSubmit={(e) => { e.preventDefault(); if (ready) submit(); }}
		>
			<h2 className="font-title text-[28px] leading-tight">What are you studying for?</h2>

			{usable.length > 0 && (
				<div className="mt-5">
					<p className="font-sans text-sm text-muted-foreground">Found in your material:</p>
					<ul className="mt-2 flex flex-wrap gap-2">
						{usable.map((s) => (
							<li key={`${s.title}:${s.date ?? ""}`}>
								<button
									type="button"
									onClick={() => use(s)}
									className={cn("sy-focus rounded-full border border-border px-3.5 py-1.5 font-sans text-sm transition-colors hover:bg-accent", title === s.title && "border-foreground")}
								>
									{s.title}{s.date ? <span className="text-muted-foreground">, {dayMonth(s.date)}</span> : null}
								</button>
							</li>
						))}
					</ul>
				</div>
			)}

			<div className="mt-6 grid grid-cols-[1fr_11.5rem] gap-3">
				<label className="block">
					<span className="font-sans text-sm text-muted-foreground">What</span>
					<input className={cn(FIELD, "mt-1.5")} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Midterm 1" maxLength={120} data-testid="goal-title" />
				</label>
				<label className="block">
					<span className="font-sans text-sm text-muted-foreground">When</span>
					<input className={cn(FIELD, "mt-1.5")} type="date" value={date} min={course.today} max={addDays(course.today, 730)} onChange={(e) => setDate(e.target.value)} data-testid="goal-date" />
				</label>
			</div>

			<fieldset className="mt-6">
				<legend className="flex w-full items-baseline justify-between">
					<span className="font-sans text-sm text-muted-foreground">What it covers</span>
					<LinkButton onClick={() => setUnits(allSelected ? new Set() : new Set(course.units.map((u) => u.id)))}>
						{allSelected ? "Clear" : "Everything"}
					</LinkButton>
				</legend>
				<ul className="mt-2 border-t border-border">
					{course.units.map((unit) => {
						const count = course.concepts.filter((c) => c.unitId === unit.id).length;
						const on = units.has(unit.id);
						return (
							<li key={unit.id} className="border-b border-border">
								<label className="flex cursor-pointer items-baseline gap-3 py-2.5 font-sans text-base">
									<input type="checkbox" checked={on} onChange={() => toggle(unit.id)} className="sy-focus size-4 translate-y-0.5 accent-[color:var(--foreground)]" data-testid={`goal-unit-${unit.id}`} />
									<span className="flex-1"><span className={cn(on && "sy-hl-half")}><Tex>{unit.title}</Tex></span></span>
									<span className="text-sm text-muted-foreground">{count} {count === 1 ? "concept" : "concepts"}</span>
								</label>
							</li>
						);
					})}
				</ul>
				{note && <p className="mt-2 font-sans text-sm text-muted-foreground">Your material says: “{note}”</p>}
			</fieldset>

			<div className="mt-7 flex items-center gap-4">
				<PrimaryButton type="submit" disabled={!ready || action.busy} data-testid="goal-submit">{action.busy ? "Saving…" : "Set this goal"}</PrimaryButton>
				{onCancel && <LinkButton onClick={onCancel}>Cancel</LinkButton>}
			</div>
			<ErrorNote error={action.error} className="mt-3" />
		</form>
	);
}
