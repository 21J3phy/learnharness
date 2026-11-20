"use client";

import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import katex from "katex";
import { MoreHorizontalIcon } from "lucide-react";
import { SidebarToggle } from "@/components/sidebar";
import { cn } from "@/lib/utils";
import { daysBetween, type Knowledge, type MasteryState } from "@/src/core";

// ─── dates ───────────────────────────────────────────────────────────────────
// A fixed locale keeps the server-rendered and hydrated text identical.

const at = (day: string) => new Date(`${day}T00:00:00Z`);
const fmt = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...options });
const WEEKDAY = fmt({ weekday: "short" });
const WEEKDAY_LONG = fmt({ weekday: "long" });
const DAY_MONTH = fmt({ day: "numeric", month: "short" });
const MONTH = fmt({ month: "long" });

export const weekdayShort = (day: string) => WEEKDAY.format(at(day));
export const dayMonth = (day: string) => DAY_MONTH.format(at(day));
export const monthName = (day: string) => MONTH.format(at(day));
export const dayNumber = (day: string) => at(day).getUTCDate();
/** "Tuesday 1 Dec" */
export const longDay = (day: string) => `${WEEKDAY_LONG.format(at(day))} ${dayMonth(day)}`;

/** How far away a day is, in words: "today", "tomorrow", "in 12 days", "3 days ago". */
export function away(today: string, day: string): string {
	return awayDays(daysBetween(today, day));
}

export function awayDays(n: number): string {
	if (n === 0) return "today";
	if (n === 1) return "tomorrow";
	if (n === -1) return "yesterday";
	return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

/** A length of study time: "50 min", "2 h", "2 h 40 min". */
export function duration(minutes: number): string {
	if (minutes < 60) return `${minutes} min`;
	const h = Math.floor(minutes / 60), m = minutes % 60;
	return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

// ─── the highlighter ─────────────────────────────────────────────────────────

/** Inline text marked the way the learner holds it: a full stroke when
 *  solid, half a stroke when shaky, bare otherwise. */
export function Hl({ state, children, className }: { state: MasteryState; children: ReactNode; className?: string }) {
	return (
		<span className={cn(state === "solid" && "sy-hl", state === "shaky" && "sy-hl-half", state === "untested" && "text-muted-foreground", className)}>
			{children}
		</span>
	);
}

/** One pass of the pen along a ruled line: how much of something is held. */
export function Stroke({ value, label, className }: { value: number; label: string; className?: string }) {
	const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
	return (
		<div className={cn("sy-stroke", className)} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={label}>
			{percent > 0 && <span style={{ width: `calc(${percent}% + 3px)` }} />}
		</div>
	);
}

// ─── page frame ──────────────────────────────────────────────────────────────

/** The course screens' frame: the window-drag strip, the sidebar toggle,
 *  an optional right-side slot, and one scrolling column. */
export function PageFrame({ children, aside, className }: { children: ReactNode; aside?: ReactNode; className?: string }) {
	return (
		<div className="relative h-dvh">
			<div className="lh-drag absolute inset-x-0 top-0 h-13" aria-hidden="true" />
			<div className={cn("absolute inset-0 overflow-y-auto", className)}>{children}</div>
			<header className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-2 px-3 py-2">
				<div className="pointer-events-auto"><SidebarToggle /></div>
				{aside && <div className="pointer-events-auto lh-no-drag">{aside}</div>}
			</header>
		</div>
	);
}

// ─── buttons ─────────────────────────────────────────────────────────────────

const BUTTON = "sy-focus inline-flex items-center justify-center gap-2 rounded-lg font-ui font-semibold transition-colors disabled:pointer-events-none disabled:opacity-45";

/** The one emphatic action on a screen. */
export function PrimaryButton({ className, ...props }: React.ComponentProps<"button">) {
	return <button type="button" {...props} className={cn(BUTTON, "h-11 bg-primary px-5 text-base text-primary-foreground hover:bg-primary/88", className)} />;
}

export function QuietButton({ className, ...props }: React.ComponentProps<"button">) {
	return <button type="button" {...props} className={cn(BUTTON, "h-9 border border-border px-3.5 text-sm font-medium text-foreground hover:bg-accent", className)} />;
}

/** A text-weight action that sits inside prose. */
export function LinkButton({ className, ...props }: React.ComponentProps<"button">) {
	return <button type="button" {...props} className={cn("sy-focus rounded-sm font-ui text-sm text-muted-foreground underline decoration-border underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground", className)} />;
}

// ─── async actions ───────────────────────────────────────────────────────────

/** Run one action at a time, exposing its busy flag and its failure. */
export function useAction() {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<unknown>(null);
	const running = useRef(false);
	const run = useCallback(async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
		if (running.current) return undefined;
		running.current = true;
		setBusy(true);
		setError(null);
		try {
			return await work();
		} catch (e) {
			setError(e);
			return undefined;
		} finally {
			running.current = false;
			setBusy(false);
		}
	}, []);
	return { busy, error, run, clear: useCallback(() => setError(null), []) };
}

export function ErrorNote({ error, className }: { error: unknown; className?: string }) {
	if (!error) return null;
	return (
		<p role="alert" className={cn("font-ui text-sm text-error", className)}>
			{error instanceof Error ? error.message : "Something went wrong. Try again."}
		</p>
	);
}

// ─── inline mathematics ──────────────────────────────────────────────────────

const mathCache = new Map<string, string>();
function renderMath(source: string): string {
	let html = mathCache.get(source);
	if (html === undefined) {
		try {
			html = katex.renderToString(source, { throwOnError: false, output: "html", strict: "ignore" });
		} catch {
			html = "";
		}
		mathCache.set(source, html);
	}
	return html;
}

/** A short line of text that may carry inline LaTeX ($…$): concept and
 *  unit titles come straight from the learner's material. */
export const Tex = memo(function Tex({ children }: { children: string }) {
	if (!children.includes("$")) {
		// Material often writes a plain "R^n": set the exponent as one.
		if (!/[A-Za-z]\^[A-Za-z0-9]/.test(children)) return <>{children}</>;
		return (
			<>
				{children.split(/(\^[A-Za-z0-9]+)/).map((part, i) => (part.startsWith("^") && i > 0 ? <sup key={i}>{part.slice(1)}</sup> : <span key={i}>{part}</span>))}
			</>
		);
	}
	return (
		<>
			{children.split(/(\$[^$]+\$)/).map((part, i) => {
				if (part.length > 2 && part.startsWith("$") && part.endsWith("$")) {
					const html = renderMath(part.slice(1, -1));
					if (html) return <span key={i} dangerouslySetInnerHTML={{ __html: html }} />;
				}
				return <span key={i}>{part}</span>;
			})}
		</>
	);
});

// ─── the knowledge meter ─────────────────────────────────────────────────────

/** The estimate's history as a quiet line: how the meter has moved as
 *  answers came in. */
function Trace({ knowledge, className }: { knowledge: Knowledge; className?: string }) {
	const points = knowledge.history;
	if (points.length < 2) return null;
	const W = 132, H = 34, PAD = 3;
	const x = (i: number) => PAD + (i / (points.length - 1)) * (W - PAD * 2);
	const y = (v: number) => H - PAD - v * (H - PAD * 2);
	const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");
	const last = points.at(-1)!;
	return (
		<svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className={className} role="img" aria-label={`The estimate over your last ${points.length} answers`}>
			<path d={d} fill="none" stroke="var(--muted-foreground)" strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round" />
			<circle cx={x(points.length - 1)} cy={y(last.value)} r="2.5" fill="var(--foreground)" />
		</svg>
	);
}

/**
 * The knowledge meter: how much of something the learner is estimated to
 * hold. Set first by the diagnostic, then moved by every graded answer.
 */
export function Meter({ knowledge, of, size = "large", className }: {
	knowledge: Knowledge;
	/** What is being measured, for the label ("Midterm 1"). */
	of: string;
	size?: "large" | "small";
	className?: string;
}) {
	const measured = knowledge.value !== null;
	const percent = Math.round((knowledge.value ?? 0) * 100);
	return (
		<div className={className} data-testid="knowledge-meter" data-value={measured ? percent : ""}>
			<div className="flex items-end justify-between gap-6">
				<p className="flex items-baseline gap-2.5">
					<span className={cn("font-title leading-none tabular-nums", size === "large" ? "text-[68px]" : "text-[36px]", !measured && "text-muted-foreground/50")}>
						{measured ? percent : "–"}<span className={cn(size === "large" ? "text-[34px]" : "text-[20px]")}>%</span>
					</span>
					<span className="font-ui text-sm text-muted-foreground">{measured ? `of ${of} known` : "not measured yet"}</span>
				</p>
				{size === "large" && <Trace knowledge={knowledge} className="mb-1 shrink-0" />}
			</div>
			<Stroke value={knowledge.value ?? 0} label={`${of}: ${measured ? `${percent}% known` : "not measured yet"}`} className="mt-3" />
			{size === "large" && measured && (
				<p className="mt-2 font-ui text-sm text-muted-foreground">
					From {knowledge.answers} {knowledge.answers === 1 ? "answer" : "answers"}. Every question you answer sharpens it.
				</p>
			)}
		</div>
	);
}

// ─── the "more" menu ─────────────────────────────────────────────────────────

export interface MenuItem {
	label: string;
	onSelect: () => void;
	/** Asks for a second click before running. */
	confirm?: string;
	danger?: boolean;
	disabled?: boolean;
}

/** The secondary actions of a screen, kept out of sight behind one button. */
export function MoreMenu({ items, label = "More" }: { items: MenuItem[]; label?: string }) {
	const [open, setOpen] = useState(false);
	const [arming, setArming] = useState<string | null>(null);
	const root = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!open) { setArming(null); return; }
		const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
		const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey, true);
		return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey, true); };
	}, [open]);
	return (
		<div ref={root} className="relative">
			<button type="button" aria-label={label} aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="more-menu" className="sy-focus flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
				<MoreHorizontalIcon className="size-4" />
			</button>
			{open && (
				<ul role="menu" className="absolute right-0 top-10 z-30 min-w-56 rounded-xl border border-border bg-background p-1.5 shadow-[0_12px_32px_-16px_rgba(0,0,0,0.35)]">
					{items.map((item) => (
						<li key={item.label} role="none">
							<button
								type="button"
								role="menuitem"
								disabled={item.disabled}
								onClick={() => {
									if (item.confirm && arming !== item.label) { setArming(item.label); return; }
									setOpen(false);
									item.onSelect();
								}}
								className={cn("sy-focus w-full rounded-lg px-3 py-2 text-left font-ui text-sm transition-colors hover:bg-accent disabled:opacity-45", (item.danger && arming === item.label) && "text-error")}
							>
								{arming === item.label ? item.confirm : item.label}
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
