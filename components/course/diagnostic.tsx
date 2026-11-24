"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { diagnosticBudget, diagnosticCandidates, goalScope, indexCourse, knowledgeOf, masteryOf, type Goal } from "@/src/core";
import { courseApi, type CourseView } from "./api";
import { ErrorNote, Hl, LinkButton, Md, Meter, PrimaryButton, Stroke, Tex, useAction } from "./parts";

const LETTERS = ["A", "B", "C", "D", "E", "F"];

interface Reveal {
	questionId: string;
	choice: number | null;
	correct: boolean;
	correctIndex: number;
	explanation: string;
	done: boolean;
}

/**
 * The diagnostic, full-window and one question at a time. Each answer
 * moves the estimates of the concepts around it, so the next question is
 * always the one that settles the most — and the quiz stops as soon as the
 * picture is clear.
 */
export function DiagnosticRun({ course, goal, adopt, onClose, onPlan }: {
	course: CourseView;
	goal: Goal;
	adopt: (course: CourseView) => void;
	onClose: () => void;
	/** Leave the diagnostic and build the plan from its result. */
	onPlan: () => void;
}) {
	const diagnostic = goal.diagnostic!;
	const [reveal, setReveal] = useState<Reveal | null>(null);
	const [picked, setPicked] = useState<number | null>(null);
	const action = useAction();

	// While an answer's result is on screen, keep showing ITS question — the
	// record has already moved on to the next one.
	const questionId = reveal?.questionId ?? course.nextQuestion[goal.id];
	const question = diagnostic.questions.find((q) => q.id === questionId);
	const asked = diagnostic.answers.length;
	const budget = useMemo(() => diagnosticBudget(diagnosticCandidates(course, goal).length), [course, goal]);
	// The question on screen: the one being answered, or the one just answered.
	const number = Math.max(1, Math.min(asked + (reveal ? 0 : 1), budget));
	// The meter this diagnostic is setting — it moves with every answer.
	const knowledge = useMemo(() => knowledgeOf(course, goalScope(course, goal).core), [course, goal]);
	const finished = diagnostic.status === "done" && !reveal;

	const answer = useCallback((choice: number | null) => {
		if (!question || reveal || action.busy) return;
		setPicked(choice);
		void action.run(async () => {
			const result = await courseApi.answer(course.id, goal.id, question.id, choice);
			setReveal({ questionId: question.id, choice, correct: result.correct, correctIndex: result.correctIndex, explanation: result.explanation, done: result.done });
			adopt(result.course);
		});
	}, [question, reveal, action, course.id, goal.id, adopt]);

	const next = useCallback(() => { setReveal(null); setPicked(null); }, []);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
			if (finished) return;
			if (reveal) {
				if (e.key === "Enter" || e.key === " " || e.key === "ArrowRight") { e.preventDefault(); next(); }
				return;
			}
			if (!question) return;
			const n = "1234".indexOf(e.key) >= 0 ? Number(e.key) - 1 : "abcd".indexOf(e.key.toLowerCase());
			if (n >= 0 && n < question.options.length) { e.preventDefault(); answer(n); }
			else if (e.key === "0" || e.key === "?") { e.preventDefault(); answer(null); }
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [answer, next, onClose, question, reveal, finished]);

	return (
		<div className="lh-no-drag absolute inset-0 z-40 flex flex-col bg-background" role="dialog" aria-label={`Diagnostic for ${goal.title}`} data-testid="diagnostic">
			<header className="mx-auto flex w-full max-w-[42rem] items-center gap-5 px-6 pb-2 pt-14">
				<div className="flex-1">
					{!finished && (
						<>
							<p className="font-ui text-sm text-muted-foreground" data-testid="diagnostic-count">Question {number} of at most {budget}</p>
							{/* The bar is how far through the quiz this is — not the estimate. */}
							<Stroke value={number / budget} label={`Question ${number} of at most ${budget}`} className="mt-1" />
							<p
								className="mt-2 min-h-5 font-ui text-sm text-muted-foreground"
								data-testid="diagnostic-meter"
								title={`An estimate, from your answers so far, of how much of what ${goal.title} covers you already know. It moves with every answer.`}
							>
								{knowledge.value === null ? "" : <>Estimate so far: you know about <span className="tabular-nums text-foreground">{Math.round(knowledge.value * 100)}%</span> of <Tex>{goal.title}</Tex>.</>}
							</p>
						</>
					)}
				</div>
				<button type="button" onClick={onClose} aria-label="Close the diagnostic" className="sy-focus -mr-2 rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground">
					<XIcon className="size-4" />
				</button>
			</header>

			<div className="flex-1 overflow-y-auto">
				<div className="mx-auto w-full max-w-[42rem] px-6 pb-24 pt-[6vh]">
					{finished ? (
						<Result course={course} goal={goal} onPlan={onPlan} />
					) : question ? (
						<>
							<div className="text-[19px] leading-relaxed" data-testid="diagnostic-question">
								<Md>{question.question}</Md>
							</div>
							<ol className="mt-8 space-y-2.5">
								{question.options.map((option, i) => {
									const chosen = (reveal ? reveal.choice : picked) === i;
									const right = reveal?.correctIndex === i;
									return (
										<li key={i}>
											<button
												type="button"
												disabled={!!reveal || action.busy}
												onClick={() => answer(i)}
												data-testid={`diagnostic-option-${i}`}
												className={cn(
													"sy-focus flex w-full items-baseline gap-4 rounded-xl border px-4 py-3.5 text-left transition-colors",
													!reveal && "border-border hover:border-foreground/60 hover:bg-accent/50",
													!reveal && chosen && "border-foreground",
													reveal && right && "border-[color:var(--sy-hl)]",
													reveal && chosen && !right && "border-error/70",
													reveal && !right && !chosen && "border-border opacity-55",
												)}
											>
												<span className="w-4 shrink-0 font-ui text-sm text-muted-foreground">{LETTERS[i]}</span>
												<span className={cn("flex-1 text-[16.5px] leading-snug", reveal && right && "[&_p]:inline")}>
													<Md>{option}</Md>
												</span>
												{reveal && right && <span className="shrink-0 font-ui text-sm"><span className="sy-hl">correct</span></span>}
												{reveal && chosen && !right && <span className="shrink-0 font-ui text-sm text-error">your answer</span>}
											</button>
										</li>
									);
								})}
							</ol>

							<div className="mt-6 min-h-24">
								{reveal ? (
									<div data-testid="diagnostic-reveal">
										{reveal.explanation && (
											<div className="text-[15.5px] leading-relaxed text-muted-foreground"><Md>{reveal.explanation}</Md></div>
										)}
										<PrimaryButton onClick={next} className="mt-5" autoFocus data-testid="diagnostic-next">
											{reveal.done ? "See where you stand" : "Next question"}
										</PrimaryButton>
									</div>
								) : (
									<div className="flex items-center justify-between">
										<LinkButton onClick={() => answer(null)} disabled={action.busy} data-testid="diagnostic-skip" className="text-base">I don't know</LinkButton>
										<p className="font-ui text-sm text-muted-foreground">Press A–D, or 0 for “I don't know”.</p>
									</div>
								)}
								<ErrorNote error={action.error} className="mt-3" />
							</div>
						</>
					) : (
						<p className="font-ui text-base text-muted-foreground">No question is ready. Close this and try again.</p>
					)}
				</div>
			</div>

			{!finished && asked >= 3 && !reveal && (
				<footer className="px-6 pb-5 text-center">
					<LinkButton onClick={() => void courseApi.finishDiagnostic(course.id, goal.id).then(adopt)}>Stop here and use these answers</LinkButton>
				</footer>
			)}
		</div>
	);
}

/** The picture the diagnostic drew: the goal's concepts, marked. */
function Result({ course, goal, onPlan }: { course: CourseView; goal: Goal; onPlan: () => void }) {
	const { groups, counts } = useMemo(() => {
		const index = indexCourse(course);
		const mastery = masteryOf(course, index);
		const scope = goalScope(course, goal, index);
		const groups = course.units
			.map((unit) => ({ unit, concepts: scope.core.map((id) => index.byId.get(id)!).filter((c) => c.unitId === unit.id).map((c) => ({ c, state: mastery.get(c.id)!.state })) }))
			.filter((g) => g.concepts.length > 0);
		const all = groups.flatMap((g) => g.concepts);
		return { groups, counts: { solid: all.filter((x) => x.state === "solid").length, total: all.length } };
	}, [course, goal]);
	const right = goal.diagnostic!.answers.filter((a) => a.correct).length;
	const toLearn = counts.total - counts.solid;

	return (
		<div data-testid="diagnostic-result">
			<h2 className="font-title text-[28px] leading-tight">Here is where you stand.</h2>
			<Meter knowledge={knowledgeOf(course, goalScope(course, goal).core)} of={goal.title} className="mt-6" />
			<p className="mt-6 max-w-[34rem] font-ui text-base leading-relaxed text-muted-foreground">
				{right} of {goal.diagnostic!.answers.length} right. {toLearn > 0
					? `Your plan spends its time on the ${toLearn} ${toLearn === 1 ? "concept" : "concepts"} that ${toLearn === 1 ? "isn't" : "aren't"} solid yet.`
					: "Your plan keeps it warm until the day."}
			</p>
			<div className="mt-9 space-y-5">
				{groups.map(({ unit, concepts }) => (
					<section key={unit.id}>
						<h3 className="font-ui text-sm text-muted-foreground"><Tex>{unit.title}</Tex></h3>
						<p className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1.5 font-ui text-[15.5px] leading-snug">
							{concepts.map(({ c, state }) => <Hl key={c.id} state={state} className={cn(state === "solid" && "sy-hl-arrive")}><Tex>{c.title}</Tex></Hl>)}
						</p>
					</section>
				))}
			</div>
			<PrimaryButton onClick={onPlan} className="mt-10" autoFocus data-testid="diagnostic-plan">Build my plan</PrimaryButton>
		</div>
	);
}
