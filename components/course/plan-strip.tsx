"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { addDays, daysBetween, type Goal, type PlanSession } from "@/src/core";
import { dayNumber, longDay, monthName, weekdayShort } from "./parts";

const DAY = 46;

/** A date circled by hand — how an exam is marked on a wall calendar. */
function PenCircle() {
	return (
		<svg viewBox="0 0 48 48" className="pointer-events-none absolute -inset-1.5 size-[calc(100%+0.75rem)]" aria-hidden="true">
			<path d="M26 5.5 C37.5 5 44 13.5 43 24.5 C42 36 33 43.5 22 42.5 C11 41.5 4.5 33 5.5 22 C6.5 11.5 14.5 5.5 28.5 7" fill="none" stroke="var(--lh-accent)" strokeWidth="2" strokeLinecap="round" />
		</svg>
	);
}

/**
 * The plan as a row of days, today to the exam. A day with a session
 * carries a dot; a finished one is highlighted; the exam's date is circled.
 * Picking a day shows its session above.
 */
export function DayStrip({ goal, today, selected, onSelect }: {
	goal: Goal;
	today: string;
	selected: string | null;
	onSelect: (sessionId: string) => void;
}) {
	const sessions = goal.plan?.sessions ?? [];
	const first = sessions.reduce((min, s) => (s.date < min ? s.date : min), today <= goal.date ? today : goal.date);
	const count = Math.min(400, Math.max(1, daysBetween(first, goal.date) + 1));
	const days = Array.from({ length: count }, (_, i) => addDays(first, i));
	const byDay = new Map<string, PlanSession>();
	// One mark per day: prefer the session still to do.
	for (const s of sessions) if (!byDay.has(s.date) || s.status === "upcoming") byDay.set(s.date, s);

	const scroller = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (scroller.current) scroller.current.scrollLeft = Math.max(0, daysBetween(first, today) - 2) * DAY;
	}, [first, today]);

	return (
		<div ref={scroller} className="-mx-1 overflow-x-auto px-1 pb-1" data-testid="plan-strip">
			<ol className="flex" style={{ width: days.length * DAY }}>
				{days.map((day, i) => {
					const exam = day === goal.date;
					const isToday = day === today;
					const session = byDay.get(day);
					const done = session?.status === "done";
					const missed = !!session && !done && day < today;
					const active = !!session && selected === session.id;
					const label = `${longDay(day)}${exam ? `, ${goal.title}` : session ? `, ${session.title}${done ? ", done" : missed ? ", missed" : ""}` : ""}`;
					const body = (
						<>
							<span className="block h-4 font-ui text-[11px] leading-4 text-muted-foreground">
								{i === 0 || dayNumber(day) === 1 ? monthName(day).slice(0, 3) : weekdayShort(day).slice(0, 1)}
							</span>
							<span className={cn(
								"relative mx-auto mt-1 flex size-8 items-center justify-center rounded-full font-ui text-[15px] tabular-nums transition-colors",
								isToday && "bg-foreground font-semibold text-background",
								!isToday && day < today && "text-muted-foreground",
								active && !isToday && "ring-1 ring-foreground",
							)}>
								<span className={cn(done && !isToday && "sy-hl")}>{dayNumber(day)}</span>
								{exam && <PenCircle />}
							</span>
							<span className="mx-auto mt-1.5 block h-1.5">
								{session && !done && <span className={cn("mx-auto block size-1.5 rounded-full", missed || session.kind === "review" ? "border border-muted-foreground" : "bg-foreground")} />}
							</span>
						</>
					);
					return (
						<li key={day} style={{ width: DAY }} className="shrink-0 text-center">
							{session ? (
								<button type="button" onClick={() => onSelect(session.id)} aria-pressed={active} aria-label={label} title={session.title} data-testid={`plan-day-${day}`} className="sy-focus w-full rounded-lg py-1.5 hover:bg-accent/70">
									{body}
								</button>
							) : (
								<div className="py-1.5" aria-label={label} title={exam ? goal.title : undefined}>{body}</div>
							)}
						</li>
					);
				})}
			</ol>
		</div>
	);
}
