"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { calendarPrompt, goalScope, planOutline, type CourseIndex, type Goal, type Mastery, type Plan, type UnitOutline } from "@/src/core";
import { courseApi, needsModels, type CourseView } from "./api";
import { ErrorNote, LinkButton, Md, Tex, dayMonth, duration, useAction, weekdayShort } from "./parts";

/** The days a unit is on: "Tue 24 Nov", or "24 – 26 Nov". */
function when(unit: UnitOutline): string {
	if (!unit.from || !unit.to) return unit.left > 0 ? "left out" : unit.solid === unit.concepts ? "known already" : "not in the plan";
	return unit.from === unit.to ? `${weekdayShort(unit.from)} ${dayMonth(unit.from)}` : `${dayMonth(unit.from)} – ${dayMonth(unit.to)}`;
}

/** A length of time as one would say it: to the half hour once it is hours. */
const roughly = (minutes: number) => (minutes >= 120 ? Math.round(minutes / 30) * 30 : minutes);

/** What the plan gave up to keep to the learner's time, in a few sentences. */
export function planNote(plan: Plan, goal: Pick<Goal, "title" | "date">, core: ReadonlySet<string>): string | null {
	if (!plan.neededMinutesPerDay) return null;
	const left = plan.left ?? [];
	const own = left.filter((id) => core.has(id)).length;
	const earlier = left.length - own;
	const many = (n: number, one: string, more: string) => `${n} ${n === 1 ? one : more}`;
	const time = Object.keys(plan.prefs.days ?? {}).length > 0 ? "Your time" : `${duration(plan.prefs.minutesPerDay)} a day`;
	return [
		`${time} doesn't stretch to everything before ${dayMonth(goal.date)}, so this plan keeps to your time and puts what ${goal.title} covers first.`,
		plan.pace ? `Each concept gets a quicker pass: about ${Math.round(20 * plan.pace)} min instead of 20.` : "",
		earlier > 0 ? `${many(earlier, "earlier concept it builds on is", "earlier concepts it builds on are")} left out.` : "",
		own > 0 ? `${many(own, "of its own concepts is", "of its own concepts are")} left out${earlier > 0 ? " too" : ""}.` : "",
		`All of it at the usual pace would take about ${duration(roughly(plan.neededMinutesPerDay))} a day.`,
	].filter(Boolean).join(" ");
}

async function copyText(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		// No clipboard permission: fall back to a selection.
		const area = document.createElement("textarea");
		area.value = text;
		area.style.position = "fixed";
		area.style.opacity = "0";
		document.body.append(area);
		area.select();
		const done = document.execCommand("copy");
		area.remove();
		return done;
	}
}

const STARTERS = ["I can't study on Thursday", "What if I had 3 hours a day?", "What got left out, and why?"];

/**
 * The plan, read back: when each unit is covered and how much of it is
 * known, what the plan had to give up, a prompt that puts it on a calendar,
 * and a conversation that answers questions about it and changes it.
 */
export function PlanView({ course, goal, index, mastery, adopt, onPick, onChanged, onNeedsModels }: {
	course: CourseView;
	goal: Goal;
	index: CourseIndex;
	mastery: Map<string, Mastery>;
	adopt: (course: CourseView) => void;
	/** Show a session above (a unit's row was picked). */
	onPick: (sessionId: string) => void;
	/** The conversation changed the plan. */
	onChanged: () => void;
	onNeedsModels: () => void;
}) {
	const plan = goal.plan!;
	const units = useMemo(() => planOutline(course, goal, index, mastery), [course, goal, index, mastery]);
	const core = useMemo(() => new Set(goalScope(course, goal, index).core), [course, goal, index]);
	const note = planNote(plan, goal, core);
	const [copied, setCopied] = useState(false);
	const copy = () => void copyText(calendarPrompt(course, goal, course.today)).then((done) => {
		if (!done) return;
		setCopied(true);
		window.setTimeout(() => setCopied(false), 2400);
	});

	return (
		<section className="mt-12" aria-label="The plan" data-testid="plan-view">
			<div className="flex items-baseline justify-between gap-6">
				<h3 className="font-ui text-[15px] font-semibold">The plan</h3>
				<LinkButton onClick={copy} data-testid="plan-copy" title="Copies a prompt you can paste to an assistant that has your calendar. It adds each session and the exam.">
					{copied ? "Copied. Paste it to your assistant" : "Copy a prompt for your calendar"}
				</LinkButton>
			</div>
			{note && <p className="mt-2 max-w-[38rem] font-ui text-sm leading-relaxed text-muted-foreground" data-testid="plan-note">{note}</p>}

			<table className="mt-5 w-full border-collapse font-ui text-[15px]" data-testid="plan-units">
				<thead>
					<tr className="text-left text-xs text-muted-foreground">
						<th className="pb-2 font-normal">Unit</th>
						<th className="w-36 pb-2 font-normal">When</th>
						<th className="w-32 pb-2 text-right font-normal">Known</th>
					</tr>
				</thead>
				<tbody>
					{units.map((unit) => {
						const planned = !!unit.from;
						const finished = planned && unit.upcoming === 0;
						return (
							<tr
								key={unit.unitId}
								onClick={unit.sessionId ? () => onPick(unit.sessionId!) : undefined}
								className={cn("border-t border-border/70", unit.sessionId && "cursor-pointer hover:bg-accent/50")}
								data-testid={`plan-unit-${unit.unitId}`}
							>
								<td className="py-2.5 pr-4">
									{unit.sessionId ? (
										<button type="button" onClick={() => onPick(unit.sessionId!)} className={cn("sy-focus rounded-sm text-left", unit.role === "earlier" && "italic text-muted-foreground")}>
											<Tex>{unit.title}</Tex>
										</button>
									) : (
										<span className={cn(unit.role === "earlier" && "italic", !planned && "text-muted-foreground")}><Tex>{unit.title}</Tex></span>
									)}
								</td>
								<td className={cn("whitespace-nowrap py-2.5 pr-4 tabular-nums", !planned && "text-muted-foreground")}>
									<span className={cn(finished && "sy-hl")}>{when(unit)}</span>
									{planned && unit.left > 0 && <span className="block text-xs text-muted-foreground">{unit.left} left out</span>}
								</td>
								<td className="py-2.5 text-right">
									<span className="inline-flex items-center gap-2.5">
										<span className="relative block h-[3px] w-14 overflow-hidden rounded-full bg-border" aria-hidden="true">
											<span className="absolute inset-y-0 left-0 rounded-full bg-[color:var(--sy-hl)]" style={{ width: `${Math.round(unit.progress * 100)}%` }} />
										</span>
										<span className="w-12 whitespace-nowrap text-sm tabular-nums text-muted-foreground">{unit.solid} of {unit.concepts}</span>
									</span>
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>

			<PlanChat course={course} goal={goal} adopt={adopt} onChanged={onChanged} onNeedsModels={onNeedsModels} />
		</section>
	);
}

/** Ask about the plan, or tell it what to change. */
function PlanChat({ course, goal, adopt, onChanged, onNeedsModels }: {
	course: CourseView;
	goal: Goal;
	adopt: (course: CourseView) => void;
	onChanged: () => void;
	onNeedsModels: () => void;
}) {
	const messages = goal.planChat ?? [];
	const [text, setText] = useState("");
	const [sent, setSent] = useState<string | null>(null);
	const action = useAction();
	const list = useRef<HTMLOListElement>(null);
	const field = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (list.current) list.current.scrollTop = list.current.scrollHeight;
	}, [messages.length, sent]);

	const send = () => {
		const message = text.trim();
		if (!message || action.busy) return;
		setSent(message);
		setText("");
		void action.run(async () => {
			try {
				const next = await courseApi.planChat(course.id, goal.id, message);
				const reply = next.goals.find((g) => g.id === goal.id)?.planChat?.at(-1);
				adopt(next);
				if (reply?.changed) onChanged();
			} catch (error) {
				setText(message);
				if (needsModels(error)) onNeedsModels();
				throw error;
			} finally {
				setSent(null);
			}
		});
	};

	return (
		<div className="mt-8" data-testid="plan-chat">
			{(messages.length > 0 || sent) && (
				<ol ref={list} className="mb-5 max-h-[26rem] space-y-4 overflow-y-auto pr-1 pt-6 [mask-image:linear-gradient(to_bottom,transparent,black_1.5rem)]" aria-label="Conversation about the plan">
					{messages.map((m, i) => (
						<li key={`${m.at}:${i}`} data-role={m.role}>
							{m.role === "user" ? (
								<p className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-2xl bg-accent px-3.5 py-2 font-ui text-[15px] leading-snug">{m.text}</p>
							) : (
								<div className="max-w-[38rem]">
									<div className="text-[15.5px] leading-relaxed"><Md>{m.text}</Md></div>
									{m.changed && <p className="mt-1 font-ui text-xs text-muted-foreground"><span className="sy-hl-half">Plan updated</span></p>}
								</div>
							)}
						</li>
					))}
					{sent && (
						<>
							<li data-role="user"><p className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-2xl bg-accent px-3.5 py-2 font-ui text-[15px] leading-snug">{sent}</p></li>
							<li role="status" className="font-ui text-sm text-muted-foreground">Looking at the plan…</li>
						</>
					)}
				</ol>
			)}
			<form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-center gap-3 border-b border-border pb-2 transition-colors focus-within:border-foreground">
				<input
					ref={field}
					value={text}
					onChange={(e) => setText(e.target.value)}
					disabled={action.busy}
					maxLength={2000}
					placeholder="Ask about the plan, or tell it what to change"
					aria-label="Ask about the plan, or tell it what to change"
					data-testid="plan-chat-input"
					className="min-w-0 flex-1 bg-transparent font-ui text-base outline-none placeholder:text-muted-foreground/70 disabled:opacity-60"
				/>
				<button type="submit" disabled={action.busy || !text.trim()} data-testid="plan-chat-send" className="sy-focus rounded-sm font-ui text-sm font-medium text-foreground transition-opacity disabled:opacity-35">
					Send
				</button>
			</form>
			{messages.length === 0 && !sent && (
				<p className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
					{STARTERS.map((starter) => (
						<LinkButton key={starter} onClick={() => { setText(starter); field.current?.focus(); }}>{starter}</LinkButton>
					))}
				</p>
			)}
			<ErrorNote error={action.error} className="mt-3" />
		</div>
	);
}
