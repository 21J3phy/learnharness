"use client";

import { XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CourseIndex, Evidence, Mastery } from "@/src/core";
import type { CourseView } from "./api";
import { ErrorNote, Hl, Md, QuietButton, Tex, dayMonth } from "./parts";

const STATE_LINE: Record<Mastery["state"], string> = {
	solid: "You hold this.",
	shaky: "Partly there.",
	new: "Not yet.",
	untested: "Not tested yet.",
};

const SOURCE_LABEL: Record<Evidence["source"], string> = { diagnostic: "Diagnostic", session: "Session check", manual: "Marked done" };

/** One concept, opened from the map: what it is, what it rests on, what it
 *  leads to, where the material teaches it, and what is known about the
 *  learner's hold on it. */
export function ConceptDetail({
	course, index, mastery, conceptId, onSelect, onClose, onStudy, studying, studyError,
}: {
	course: CourseView;
	index: CourseIndex;
	mastery: Map<string, Mastery>;
	conceptId: string;
	onSelect: (id: string) => void;
	onClose: () => void;
	/** Absent when there is no goal to study it under. */
	onStudy?: () => void;
	studying?: boolean;
	studyError?: unknown;
}) {
	const concept = index.byId.get(conceptId);
	if (!concept) return null;
	const m = mastery.get(conceptId);
	const unit = course.units.find((u) => u.id === concept.unitId);
	const sourceName = new Map(course.sources.map((s) => [s.id, s.name]));
	const decks = new Set(course.sources.filter((s) => s.kind === "slides").map((s) => s.id));
	const evidence = course.evidence.filter((e) => e.conceptId === conceptId).sort((a, b) => b.at.localeCompare(a.at));
	const link = (id: string) => {
		const c = index.byId.get(id);
		if (!c) return null;
		return (
			<li key={id}>
				<button type="button" onClick={() => onSelect(id)} className="sy-focus rounded-sm text-left font-ui text-[15px] leading-snug hover:underline hover:underline-offset-4">
					<Hl state={mastery.get(id)?.state ?? "untested"}><Tex>{c.title}</Tex></Hl>
				</button>
			</li>
		);
	};
	const dependents = index.dependents.get(conceptId) ?? [];

	return (
		<aside className="lh-no-drag absolute inset-y-0 right-0 z-30 flex w-[min(24rem,100%)] flex-col border-l border-border bg-background shadow-[-12px_0_32px_-24px_rgba(0,0,0,0.5)]" aria-label={concept.title} data-testid="concept-detail">
			<div className="flex items-start justify-between gap-3 px-6 pb-2 pt-14">
				<div>
					{unit && <p className="font-ui text-sm text-muted-foreground"><Tex>{unit.title}</Tex></p>}
					<h2 className="mt-1 font-title text-2xl leading-tight"><Tex>{concept.title}</Tex></h2>
				</div>
				<button type="button" onClick={onClose} aria-label="Close" className="sy-focus -mr-2 rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground">
					<XIcon className="size-4" />
				</button>
			</div>

			<div className="flex-1 space-y-7 overflow-y-auto px-6 pb-8 pt-3">
				<div className="text-[15px]"><Md>{concept.summary}</Md></div>

				<section>
					<p className="font-ui text-[15px]">
						<Hl state={m?.state ?? "untested"} className={cn(m?.state === "untested" && "text-foreground")}>{STATE_LINE[m?.state ?? "untested"]}</Hl>
						{m && m.state !== "untested" && <span className="text-muted-foreground"> Estimated {Math.round(m.p * 100)}%.</span>}
					</p>
					{evidence.length > 0 ? (
						<ul className="mt-2 space-y-1 font-ui text-sm text-muted-foreground">
							{evidence.slice(0, 6).map((e) => (
								<li key={e.id}>{e.correct ? "Right" : "Missed"}, {SOURCE_LABEL[e.source].toLowerCase()}, {dayMonth(e.at.slice(0, 10))}</li>
							))}
						</ul>
					) : m && m.inferred > 0 ? (
						<p className="mt-2 font-ui text-sm text-muted-foreground">Worked out from your answers on the concepts around it.</p>
					) : null}
				</section>

				{concept.prereqs.length > 0 && (
					<section>
						<h3 className="font-ui text-sm text-muted-foreground">Rests on</h3>
						<ul className="mt-1.5 space-y-1.5">{concept.prereqs.map(link)}</ul>
					</section>
				)}
				{dependents.length > 0 && (
					<section>
						<h3 className="font-ui text-sm text-muted-foreground">Leads to</h3>
						<ul className="mt-1.5 space-y-1.5">{dependents.map(link)}</ul>
					</section>
				)}
				{concept.refs.length > 0 && (
					<section>
						<h3 className="font-ui text-sm text-muted-foreground">In your material</h3>
						<ul className="mt-1.5 space-y-1 font-ui text-[15px]">
							{concept.refs.map((r) => (
								<li key={`${r.sourceId}:${r.from}`}>
									{`${decks.has(r.sourceId) ? "Slide" : "Page"}${r.from === r.to ? ` ${r.from}` : `s ${r.from}–${r.to}`}`}
									<span className="text-muted-foreground">, {sourceName.get(r.sourceId) ?? "material"}</span>
								</li>
							))}
						</ul>
					</section>
				)}
			</div>

			{onStudy && (
				<div className="border-t border-border px-6 py-4">
					<QuietButton onClick={onStudy} disabled={studying} className="w-full">{studying ? "Opening…" : "Study this now"}</QuietButton>
					<ErrorNote error={studyError} className="mt-2" />
				</div>
			)}
		</aside>
	);
}
