import type { CourseStep, CourseSummary } from "@/src/core";
import { dayMonth, weekdayShort } from "./parts";

/** A course's next step in a line of words, for lists. */
export function stepText(step: CourseStep): string {
	switch (step.kind) {
		case "building": return "Reading your material…";
		case "material": return step.failed ? "The map couldn't be built" : "Add your material";
		case "goal": return "Next: set what you're studying for";
		case "diagnostic":
			return step.state === "writing" ? "Writing your diagnostic…"
				: step.state === "ready" ? "Your diagnostic is ready"
				: step.state === "in-progress" ? "Your diagnostic is waiting"
				: step.state === "failed" ? "The diagnostic couldn't be written"
				: "Next: take the diagnostic";
		case "plan": return "Next: build your plan";
		case "overdue": return step.count === 1 ? "A session slipped past" : `${step.count} sessions slipped past`;
		case "session": return step.title;
		case "done": return "Every session is done";
	}
}

/** "Today", or the day a session is planned for. */
export const sessionDay = (date: string, today: string): string => (date <= today ? "Today" : `${weekdayShort(date)} ${dayMonth(date)}`);

/** Courses in the order they need attention: a session due today first,
 *  then the nearest exam; courses with no goal last. */
export function byUrgency(courses: readonly CourseSummary[], today: string): CourseSummary[] {
	const due = (c: CourseSummary) => (c.step.kind === "session" && c.step.date <= today ? 0 : 1);
	const left = (c: CourseSummary) => (c.nextGoal && c.nextGoal.daysLeft >= 0 ? c.nextGoal.daysLeft : Number.MAX_SAFE_INTEGER);
	return [...courses].sort((a, b) => due(a) - due(b) || left(a) - left(b) || b.updatedAt.localeCompare(a.updatedAt));
}

/** The home page's headline: what today asks for. */
export function todayHeadline(courses: readonly CourseSummary[], today: string): string {
	const due = courses.filter((c) => c.step.kind === "session" && c.step.date <= today).length;
	if (due === 1) return "One session today.";
	if (due > 1) return `${due} sessions today.`;
	if (courses.some((c) => c.step.kind === "diagnostic" || c.step.kind === "plan" || c.step.kind === "goal" || c.step.kind === "overdue" || c.step.kind === "material")) return "Pick up where you left off.";
	if (courses.some((c) => c.step.kind === "building")) return "Reading your material.";
	return "Nothing due today.";
}
