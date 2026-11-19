import { notFound } from "next/navigation";
import { CoursePage } from "@/components/course/course-page";
import { getCourse } from "@/src/server";

export const dynamic = "force-dynamic";

export default async function CourseRoute({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const course = getCourse(id);
	if (!course) notFound();
	return <CoursePage key={course.id} id={course.id} initial={course} />;
}
