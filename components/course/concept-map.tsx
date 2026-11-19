"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { progressOf, type CourseIndex, type Mastery } from "@/src/core";
import type { CourseView } from "./api";
import { Hl, Tex } from "./parts";

const LANE = 224;
const GAP = 48;
const ROW = 30;
const HEAD = 74;

interface Placed {
	x: number;
	y: number;
}

/**
 * The course as a map: one lane per unit, in teaching order; each concept a
 * line of text marked the way the learner holds it. Pointing at a concept
 * draws what it rests on and what it leads to, and lets the rest recede.
 */
export function ConceptMap({
	course, index, mastery, visible, assumed, today, selected, onSelect,
}: {
	course: CourseView;
	index: CourseIndex;
	mastery: Map<string, Mastery>;
	/** The concepts to show (a goal's own small map, or everything). */
	visible: ReadonlySet<string>;
	/** Shown, but outside the goal's units. */
	assumed: ReadonlySet<string>;
	/** In the session to do now. */
	today: ReadonlySet<string>;
	selected: string | null;
	onSelect: (id: string | null) => void;
}) {
	const [hovered, setHovered] = useState<string | null>(null);

	const { lanes, at, width, height } = useMemo(() => {
		const lanes = course.units
			.map((unit) => ({ unit, ids: index.order.filter((id) => visible.has(id) && index.byId.get(id)!.unitId === unit.id) }))
			.filter((lane) => lane.ids.length > 0);
		const at = new Map<string, Placed>();
		lanes.forEach((lane, i) => lane.ids.forEach((id, j) => at.set(id, { x: i * (LANE + GAP), y: HEAD + j * ROW + ROW / 2 })));
		const rows = Math.max(1, ...lanes.map((lane) => lane.ids.length));
		return { lanes, at, width: lanes.length * LANE + Math.max(0, lanes.length - 1) * GAP, height: HEAD + rows * ROW + 8 };
	}, [course.units, index, visible]);

	const focus = hovered ?? selected;
	const { near, links } = useMemo(() => {
		if (!focus || !at.has(focus)) return { near: null, links: [] as { from: string; to: string }[] };
		const near = new Set<string>([focus]);
		const links: { from: string; to: string }[] = [];
		for (const p of index.byId.get(focus)?.prereqs ?? []) if (at.has(p)) { near.add(p); links.push({ from: p, to: focus }); }
		for (const d of index.dependents.get(focus) ?? []) if (at.has(d)) { near.add(d); links.push({ from: focus, to: d }); }
		return { near, links };
	}, [focus, index, at]);

	const path = (from: Placed, to: Placed): string => {
		if (from.x === to.x) {
			// Same lane: a shallow arc in the left margin.
			const x = from.x - 9, bulge = Math.min(20, 8 + Math.abs(to.y - from.y) / 8);
			return `M ${x} ${from.y} C ${x - bulge} ${from.y}, ${x - bulge} ${to.y}, ${x} ${to.y}`;
		}
		const forward = to.x > from.x;
		const x1 = forward ? from.x + LANE - 16 : from.x - 9;
		const x2 = forward ? to.x - 9 : to.x + LANE - 16;
		const bend = Math.max(24, Math.abs(x2 - x1) * 0.45) * (forward ? 1 : -1);
		return `M ${x1} ${from.y} C ${x1 + bend} ${from.y}, ${x2 - bend} ${to.y}, ${x2} ${to.y}`;
	};

	if (lanes.length === 0) return <p className="font-ui text-sm text-muted-foreground">Nothing to show here yet.</p>;

	return (
		<div className="-mx-10 overflow-x-auto px-10 pb-4" data-testid="concept-map">
			<div className="relative" style={{ width, height }} onMouseLeave={() => setHovered(null)}>
				<svg className="pointer-events-none absolute inset-0 overflow-visible" width={width} height={height} aria-hidden="true">
					{links.map((link) => (
						<path key={`${link.from}>${link.to}`} d={path(at.get(link.from)!, at.get(link.to)!)} fill="none" stroke="var(--foreground)" strokeOpacity={0.55} strokeWidth={1.25} />
					))}
				</svg>

				{lanes.map((lane, i) => {
					const { solid, total } = progressOf(lane.ids, mastery);
					return (
						<section key={lane.unit.id} className="absolute top-0" style={{ left: i * (LANE + GAP), width: LANE }} aria-label={lane.unit.title}>
							<header className="flex flex-col justify-end pr-4" style={{ height: HEAD - 16 }}>
								<h3 className="line-clamp-2 font-ui text-[13.5px] font-semibold leading-snug" title={lane.unit.title}><Tex>{lane.unit.title}</Tex></h3>
								<p className="font-ui text-xs text-muted-foreground">{solid} of {total}</p>
							</header>
							<ul className="mt-3.5">
								{lane.ids.map((id) => {
									const concept = index.byId.get(id)!;
									const state = mastery.get(id)?.state ?? "untested";
									return (
										<li key={id} style={{ height: ROW }} className="flex items-center">
											<button
												type="button"
												data-testid={`concept-${id}`}
												aria-pressed={selected === id}
												onMouseEnter={() => setHovered(id)}
												onFocus={() => setHovered(id)}
												onBlur={() => setHovered(null)}
												onClick={() => onSelect(selected === id ? null : id)}
												title={concept.title.replaceAll("$", "")}
												className={cn(
													"sy-focus flex max-w-full items-center gap-1.5 rounded-sm py-0.5 pr-1 text-left font-ui text-[14.5px] leading-tight transition-opacity duration-150",
													near && !near.has(id) && "opacity-30",
													assumed.has(id) && "italic",
													selected === id && "font-semibold",
												)}
											>
												{today.has(id) && <span className="size-1.5 shrink-0 rounded-full bg-foreground" aria-label="In the next session" />}
												<span className="truncate"><Hl state={state}><Tex>{concept.title}</Tex></Hl></span>
											</button>
										</li>
									);
								})}
							</ul>
						</section>
					);
				})}
			</div>
		</div>
	);
}

/** What the marks on the map mean. */
export function MapLegend({ className }: { className?: string }) {
	return (
		<p className={cn("flex items-center gap-x-4 font-ui text-xs text-muted-foreground", className)}>
			<span className="sy-hl">solid</span>
			<span className="sy-hl-half text-foreground">shaky</span>
			<span className="text-foreground">not yet</span>
			<span>untested</span>
		</p>
	);
}
