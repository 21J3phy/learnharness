"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { progressOf, type CourseIndex, type Mastery } from "@/src/core";
import type { CourseView } from "./api";
import { Hl, Stroke, Tex } from "./parts";

const ROW = 32;
const HEAD = 56;
const BODY_TOP = 2;
const BODY_BOTTOM = 22;
const GUTTER = 44;
/** Up to this many concepts, every unit starts open. */
const SMALL = 45;

interface Point {
	x: number;
	y: number;
}

/**
 * The course as a map, in two levels. Each unit is one line with how much
 * of it is held; opening a unit shows its concepts in teaching order, each
 * marked the way the learner holds it. Pointing at a concept draws what it
 * rests on and what it leads to — to the concept when its unit is open, to
 * the unit's line when it is not — and lets the rest recede.
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
	const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map());
	const frame = useRef<HTMLDivElement>(null);
	const [width, setWidth] = useState(1008);
	useEffect(() => {
		const el = frame.current;
		if (!el) return;
		const observer = new ResizeObserver(([entry]) => { if (entry) setWidth(Math.round(entry.contentRect.width)); });
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	const units = useMemo(() => course.units
		.map((unit) => ({ unit, ids: index.order.filter((id) => visible.has(id) && index.byId.get(id)!.unitId === unit.id) }))
		.filter((u) => u.ids.length > 0), [course.units, index, visible]);
	const small = units.reduce((n, u) => n + u.ids.length, 0) <= SMALL;

	// A long course opens where the learner is: the unit of the session that
	// is due, else the first unit not yet held.
	const lead = useMemo(() => {
		const due = units.find((u) => u.ids.some((id) => today.has(id)));
		return (due ?? units.find((u) => u.ids.some((id) => mastery.get(id)?.state !== "solid")) ?? units[0])?.unit.id;
	}, [units, today, mastery]);
	const isOpen = (unitId: string) => toggled.get(unitId) ?? (small || unitId === lead);

	// Following a link in the detail panel can land in a closed unit: open it.
	useEffect(() => {
		const unitId = selected && index.byId.get(selected)?.unitId;
		if (unitId) setToggled((prev) => (prev.get(unitId) ?? (small || unitId === lead) ? prev : new Map(prev).set(unitId, true)));
	}, [selected, index, small, lead]);

	const cols = width >= 880 ? 3 : width >= 540 ? 2 : 1;
	const colWidth = (width - (cols - 1) * GUTTER) / cols;

	const { rows, at, unitAt, height } = (() => {
		const at = new Map<string, Point>();
		const unitAt = new Map<string, Point>();
		const rows: { unitId: string; top: number; open: boolean; perCol: number }[] = [];
		let y = 0;
		for (const { unit, ids } of units) {
			const open = isOpen(unit.id);
			const perCol = Math.ceil(ids.length / cols);
			rows.push({ unitId: unit.id, top: y, open, perCol });
			unitAt.set(unit.id, { x: 0, y: y + HEAD / 2 });
			y += HEAD;
			if (open) {
				ids.forEach((id, j) => at.set(id, { x: Math.floor(j / perCol) * (colWidth + GUTTER), y: y + BODY_TOP + (j % perCol) * ROW + ROW / 2 }));
				y += BODY_TOP + perCol * ROW + BODY_BOTTOM;
			}
		}
		return { rows, at, unitAt, height: y };
	})();

	const focus = hovered ?? selected;
	const { near, nearUnits, links } = (() => {
		const none = { near: null as Set<string> | null, nearUnits: new Set<string>(), links: [] as { key: string; from: Point; to: Point }[] };
		if (!focus || !at.has(focus)) return none;
		const near = new Set<string>([focus]);
		const nearUnits = new Set<string>();
		const links: { key: string; from: Point; to: Point }[] = [];
		const here = at.get(focus)!;
		const reach = (id: string): Point | undefined => {
			if (!visible.has(id)) return undefined;
			near.add(id);
			if (at.has(id)) return at.get(id);
			const unitId = index.byId.get(id)!.unitId;
			nearUnits.add(unitId);
			return unitAt.get(unitId);
		};
		const seen = new Set<string>();
		const add = (id: string, back: boolean) => {
			const there = reach(id);
			if (!there) return;
			const key = `${back ? "<" : ">"}${there.x}:${there.y}`;
			if (seen.has(key)) return; // several concepts behind one closed unit share its line
			seen.add(key);
			links.push({ key, from: back ? there : here, to: back ? here : there });
		};
		for (const p of index.byId.get(focus)?.prereqs ?? []) add(p, true);
		for (const d of index.dependents.get(focus) ?? []) add(d, false);
		return { near, nearUnits, links };
	})();

	const path = (from: Point, to: Point): string => {
		const x1 = from.x - 10, x2 = to.x - 10;
		if (Math.abs(x1 - x2) < 1) {
			// Same column: a shallow arc in the left margin.
			const bulge = Math.min(22, 8 + Math.abs(to.y - from.y) / 8);
			return `M ${x1} ${from.y} C ${x1 - bulge} ${from.y}, ${x1 - bulge} ${to.y}, ${x1} ${to.y}`;
		}
		const mid = (x1 + x2) / 2;
		return `M ${x1} ${from.y} C ${mid} ${from.y}, ${mid} ${to.y}, ${x2} ${to.y}`;
	};

	if (units.length === 0) return <p className="font-ui text-sm text-muted-foreground">Nothing to show here yet.</p>;

	return (
		<div ref={frame} data-testid="concept-map">
			<div className="relative" style={{ height }} onMouseLeave={() => setHovered(null)}>
				<svg className="pointer-events-none absolute inset-0 z-10 overflow-visible" width={width} height={height} aria-hidden="true">
					{links.map((link) => (
						<path key={link.key} d={path(link.from, link.to)} fill="none" stroke="var(--foreground)" strokeOpacity={0.5} strokeWidth={1.25} />
					))}
				</svg>

				{units.map(({ unit, ids }, i) => {
					const row = rows[i]!;
					const { solid, total } = progressOf(ids, mastery);
					const outside = ids.every((id) => assumed.has(id));
					return (
						<section key={unit.id} className="absolute inset-x-0" style={{ top: row.top }} aria-label={unit.title}>
							<h3 style={{ height: HEAD }} className="border-t border-border">
								<button
									type="button"
									aria-expanded={row.open}
									data-testid={`unit-${unit.id}`}
									onClick={() => setToggled((prev) => new Map(prev).set(unit.id, !row.open))}
									className={cn("sy-focus group flex h-full w-full items-center gap-5 rounded-sm text-left transition-opacity duration-150", near && !nearUnits.has(unit.id) && !ids.some((id) => near.has(id) && at.has(id)) && "opacity-45")}
								>
									<span className={cn("min-w-0 flex-1 truncate font-ui text-[15.5px] font-semibold", outside && "font-normal italic")}><Tex>{unit.title}</Tex></span>
									<Stroke value={total > 0 ? solid / total : 0} label={`${unit.title}: ${solid} of ${total} held`} className="hidden w-40 shrink-0 sm:block" />
									<span className="w-16 shrink-0 text-right font-ui text-[13px] tabular-nums text-muted-foreground">{solid} of {total}</span>
									<ChevronDownIcon className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:text-foreground", row.open && "rotate-180")} aria-hidden="true" />
								</button>
							</h3>
							{row.open && (
								<ul className="relative" style={{ height: BODY_TOP + row.perCol * ROW + BODY_BOTTOM }}>
									{ids.map((id) => {
										const concept = index.byId.get(id)!;
										const state = mastery.get(id)?.state ?? "untested";
										const p = at.get(id)!;
										return (
											<li key={id} className="absolute flex items-center" style={{ left: p.x, top: p.y - row.top - HEAD - ROW / 2, width: colWidth, height: ROW }}>
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
													{today.has(id) && <span className="size-1.5 shrink-0 rounded-full bg-[color:var(--lh-accent)]" aria-label="In the next session" />}
													<span className="truncate"><Hl state={state}><Tex>{concept.title}</Tex></Hl></span>
												</button>
											</li>
										);
									})}
								</ul>
							)}
						</section>
					);
				})}
				<div className="absolute inset-x-0 border-t border-border" style={{ top: height }} aria-hidden="true" />
			</div>
		</div>
	);
}

/** What the marks on the map mean. */
export function MapLegend({ className, next = false }: { className?: string; /** Explain the dot on the due session's concepts. */ next?: boolean }) {
	return (
		<p className={cn("flex items-center gap-x-4 font-ui text-xs text-muted-foreground", className)}>
			{next && <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-[color:var(--lh-accent)]" aria-hidden="true" />next session</span>}
			<span className="sy-hl">solid</span>
			<span className="sy-hl-half text-foreground">shaky</span>
			<span className="text-foreground">not yet</span>
			<span>untested</span>
		</p>
	);
}
