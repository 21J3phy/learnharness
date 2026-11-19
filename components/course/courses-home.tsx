"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SetupDialog } from "@/components/setup-dialog";
import { useModelSetup } from "@/components/setup-cta";
import { cn } from "@/lib/utils";
import type { CourseSummary } from "@/src/core";
import { courseApi, needsModels, useCourses } from "./api";
import { refusalFor, titleFromFile, useFileDrop } from "./dropzone";
import { ErrorNote, LinkButton, PageFrame, PrimaryButton, Stroke, Tex, awayDays, useAction } from "./parts";

/**
 * Home: the learner's courses, and the way to start one — drop a textbook
 * or a syllabus anywhere on the page.
 */
export function CoursesHome({ initialCourses, initialConfigured }: { initialCourses: CourseSummary[]; initialConfigured: boolean }) {
	const router = useRouter();
	const { courses } = useCourses(initialCourses);
	const { configured, zeroKeys } = useModelSetup(initialConfigured);
	const [setupOpen, setSetupOpen] = useState(false);
	const [reading, setReading] = useState<string | null>(null);
	const [refusal, setRefusal] = useState<string | null>(null);
	const action = useAction();

	const start = (files: File[]) => {
		setRefusal(null);
		const problem = refusalFor(files);
		if (problem) { setRefusal(problem); return; }
		// Reading a book takes model calls: get the models chosen first.
		if (!configured || zeroKeys) { setSetupOpen(true); setRefusal("Choose your models first, then drop the file again."); return; }
		void action.run(async () => {
			setReading(files.length === 1 ? files[0]!.name : `${files.length} files`);
			const created = await courseApi.create(titleFromFile(files[0]!.name));
			try {
				await courseApi.addSources(created.id, files);
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
							<h1 className="font-title text-[52px] leading-[1.05] tracking-[-0.01em]">Drop in your textbook.</h1>
							<p className="mt-5 max-w-[34rem] font-ui text-lg leading-relaxed text-muted-foreground">
								A syllabus or lecture notes work too. You get a map of everything the course expects you to know, a short diagnostic that finds what you already do, and a day-by-day plan up to your exam.
							</p>
						</>
					) : (
						<>
							<h1 className="font-title text-[38px] leading-[1.1]">Your courses</h1>
							<ul className="mt-8 border-t border-border">
								{courses.map((c) => <CourseRow key={c.id} course={c} />)}
							</ul>
						</>
					)}

					<div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2", empty ? "mt-9" : "mt-8")}>
						{reading ? (
							<p className="font-ui text-base" role="status">
								Reading <span className="sy-hl">{reading}</span>… a long book takes a minute.
							</p>
						) : (
							<>
								{empty
									? <PrimaryButton onClick={choose}>Choose a file</PrimaryButton>
									: <LinkButton onClick={choose} className="text-base">Start another course</LinkButton>}
								<span className="font-ui text-sm text-muted-foreground">
									{empty ? "or drop it anywhere on this page. PDF, Markdown or text." : "or drop a textbook or syllabus anywhere on this page."}
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
					<p className="font-title text-3xl"><span className="sy-hl">Drop it to start a course</span></p>
				</div>
			)}

			<SetupDialog open={setupOpen} onClose={() => setSetupOpen(false)} onDone={() => { setSetupOpen(false); setRefusal(null); }} />
		</div>
	);
}

function CourseRow({ course }: { course: CourseSummary }) {
	const building = course.status === "reading" || course.status === "mapping" || course.status === "organizing";
	const percent = Math.round(course.knowledge * 100);
	return (
		<li className="border-b border-border">
			<Link href={`/course/${course.id}`} className="sy-focus -mx-3 block rounded-lg px-3 py-6 transition-colors hover:bg-accent/50">
				<div className="flex items-baseline justify-between gap-6">
					<h2 className="font-title text-[26px] leading-tight"><Tex>{course.title}</Tex></h2>
					<p className="shrink-0 font-ui text-sm text-muted-foreground">
						{course.nextGoal
							? <>{course.nextGoal.title} {awayDays(course.nextGoal.daysLeft)}</>
							: building ? "Building the map…" : course.status === "failed" ? "Needs attention" : ""}
					</p>
				</div>
				<div className="mt-4 flex items-end gap-4">
					<Stroke value={course.measured ? course.knowledge : 0} label={`${course.title}: ${course.measured ? `${percent}% known` : "not measured yet"}`} className="flex-1" />
					<p className="w-12 shrink-0 text-right font-ui text-sm tabular-nums text-muted-foreground">{course.measured ? `${percent}%` : ""}</p>
				</div>
			</Link>
		</li>
	);
}
