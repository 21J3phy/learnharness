"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { stashOpeningPrompt } from "@/components/opening-prompt";
import { SetupDialog } from "@/components/setup-dialog";
import { useModelSetup } from "@/components/setup-cta";
import { cn } from "@/lib/utils";
import type { CourseSummary } from "@/src/core";
import { courseApi, needsModels, sendFiles, useCourses } from "./api";
import { COURSE_KINDS, nothingRead } from "@/lib/course-limits";
import { useFileDrop, type Dropped } from "./dropzone";
import { sortFiles, titleFromFile } from "./files";
import { ErrorNote, LinkButton, PageFrame, PrimaryButton, QuietButton, Stroke, Tex, awayDays, duration, longDay, useAction } from "./parts";
import { byUrgency, sessionDay, stepText, todayHeadline } from "./step";

/**
 * Home: what today asks for. Each course shows where the learner stands and
 * its next step, with the session that is due one click away. Dropping a
 * textbook or a syllabus anywhere on the page starts a course.
 */
export function CoursesHome({ initialCourses, today: initialToday, initialConfigured }: { initialCourses: CourseSummary[]; today: string; initialConfigured: boolean }) {
	const router = useRouter();
	const listed = useCourses(initialCourses, initialToday);
	const today = listed.today ?? initialToday;
	const courses = useMemo(() => byUrgency(listed.courses ?? initialCourses, today), [listed.courses, initialCourses, today]);
	const session = useAction();
	const openSession = (course: CourseSummary) => {
		const step = course.step;
		if (step.kind !== "session") return;
		void session.run(async () => {
			const { chatId, prompt } = await courseApi.startSession(course.id, step.goalId, step.sessionId);
			if (prompt) stashOpeningPrompt(chatId, prompt);
			router.push(`/chat/${chatId}`);
		});
	};
	const { configured, zeroKeys } = useModelSetup(initialConfigured);
	const [setupOpen, setSetupOpen] = useState(false);
	const [reading, setReading] = useState<string | null>(null);
	const [refusal, setRefusal] = useState<string | null>(null);
	const action = useAction();

	const start = ({ files, folder }: Dropped) => {
		setRefusal(null);
		const sorted = sortFiles(files);
		if (sorted.take.length === 0) { setRefusal(nothingRead(sorted.skipped)); return; }
		// Reading a book takes model calls: get the models chosen first.
		if (!configured || zeroKeys) { setSetupOpen(true); setRefusal("Choose your models first, then drop your files again."); return; }
		void action.run(async () => {
			setReading(sorted.take.length === 1 ? sorted.take[0]!.name : `${sorted.take.length} files`);
			// A dropped folder names the course; the map's own title replaces it once built.
			const created = await courseApi.create(folder?.trim().slice(0, 120) || titleFromFile(sorted.take[0]!.name));
			try {
				await sendFiles(created.id, sorted);
			} catch (error) {
				// Don't leave an empty course behind a refused upload.
				await courseApi.remove(created.id).catch(() => undefined);
				if (needsModels(error)) setSetupOpen(true);
				throw error;
			}
			router.push(`/course/${created.id}`);
		}).finally(() => setReading(null));
	};

	const { over, zone, choose, picker } = useFileDrop(start, !action.busy);
	const empty = courses.length === 0;

	return (
		<div {...zone} className="relative h-dvh">
			<PageFrame>
				<main className={cn("mx-auto w-full max-w-[68rem] px-10 [&>*]:max-w-[42rem]", empty ? "flex min-h-dvh flex-col justify-center pb-24" : "pb-24 pt-24")}>
					{empty ? (
						<>
							<h1 className="font-title text-[52px] leading-[1.05] tracking-[-0.01em]">Drop in your course.</h1>
							<p className="mt-5 max-w-[34rem] font-ui text-lg leading-relaxed text-muted-foreground">
								A textbook, lecture slides, a syllabus, your notes: one file or a whole folder. You get a map of everything the course expects you to know, a short diagnostic that finds what you already do, and a day-by-day plan up to your exam.
							</p>
						</>
					) : (
						<>
							<p className="font-ui text-sm text-muted-foreground">{longDay(today)}</p>
							<h1 className="mt-2 font-title text-[38px] leading-[1.1]" data-testid="today-headline">{todayHeadline(courses, today)}</h1>
							<ul className="mt-9 border-t border-border">
								{courses.map((c, i) => <CourseRow key={c.id} course={c} today={today} lead={i === 0} busy={session.busy} onOpenSession={() => openSession(c)} />)}
							</ul>
							<ErrorNote error={session.error} className="mt-3" />
						</>
					)}

					<div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2", empty ? "mt-9" : "mt-8")}>
						{reading ? (
							<p className="font-ui text-base" role="status">
								Reading <span className="sy-hl">{reading}</span>… a long book or a full folder takes a minute.
							</p>
						) : (
							<>
								{empty
									? <PrimaryButton onClick={choose}>Choose files</PrimaryButton>
									: <LinkButton onClick={choose} className="text-base">Start another course</LinkButton>}
								<span className="font-ui text-sm text-muted-foreground">
									{empty ? `or drop them anywhere on this page. ${COURSE_KINDS}.` : "or drop a textbook, slides or a syllabus anywhere on this page."}
								</span>
							</>
						)}
					</div>
					{refusal && <p role="alert" className="mt-3 font-ui text-sm text-error">{refusal}</p>}
					{!refusal && <ErrorNote error={action.error} className="mt-3" />}
					{picker}
				</main>
			</PageFrame>

			{over && (
				<div className="pointer-events-none absolute inset-3 z-40 flex items-center justify-center rounded-2xl border-2 border-dashed border-[color:var(--sy-hl)] bg-background/90">
					<p className="font-title text-3xl"><span className="sy-hl">Drop to start a course</span></p>
				</div>
			)}

			<SetupDialog open={setupOpen} onClose={() => setSetupOpen(false)} onDone={() => { setSetupOpen(false); setRefusal(null); }} />
		</div>
	);
}

function CourseRow({ course, today, lead, busy, onOpenSession }: { course: CourseSummary; today: string; lead: boolean; busy: boolean; onOpenSession: () => void }) {
	const percent = Math.round(course.knowledge * 100);
	const step = course.step;
	const Action = lead ? PrimaryButton : QuietButton;
	return (
		<li className="group relative border-b border-border py-7" data-testid="course-row">
			<div className="flex items-baseline justify-between gap-6">
				<h2 className="font-title text-[26px] leading-tight">
					{/* The whole row opens the course; the session button sits above it. */}
					<Link href={`/course/${course.id}`} className="sy-focus rounded-sm decoration-border decoration-1 underline-offset-[7px] after:absolute after:inset-0 group-hover:underline"><Tex>{course.title}</Tex></Link>
				</h2>
				{course.nextGoal && (
					<p className="shrink-0 font-ui text-sm text-muted-foreground">{course.nextGoal.title} {course.nextGoal.daysLeft >= 0 ? awayDays(course.nextGoal.daysLeft) : "has passed"}</p>
				)}
			</div>
			<div className="mt-4 flex items-end gap-4">
				<Stroke value={course.measured ? course.knowledge : 0} label={`${course.title}: ${course.measured ? `${percent}% known` : "not measured yet"}`} className="flex-1" />
				<p className="w-12 shrink-0 text-right font-ui text-sm tabular-nums text-muted-foreground">{course.measured ? `${percent}%` : ""}</p>
			</div>
			<div className="mt-5 flex min-h-9 items-center justify-between gap-6" data-testid="course-step">
				{step.kind === "session" ? (
					<>
						<p className="min-w-0 font-ui text-[15px] leading-snug">
							<span className="text-muted-foreground">{sessionDay(step.date, today)}</span>
							<span className="mx-2 text-border" aria-hidden="true">/</span>
							<Tex>{step.title}</Tex>
							<span className="ml-2.5 whitespace-nowrap text-sm text-muted-foreground">{duration(step.minutes)}</span>
						</p>
						<Action onClick={onOpenSession} disabled={busy} className={lead ? "relative h-10 shrink-0 px-4 text-[15px]" : "relative shrink-0"} data-testid="home-session-start">
							{step.started ? "Continue" : "Start"}
						</Action>
					</>
				) : (
					<p className="font-ui text-[15px] text-muted-foreground" role={step.kind === "building" ? "status" : undefined}>{stepText(step)}</p>
				)}
			</div>
		</li>
	);
}
