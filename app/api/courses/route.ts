import { courseHttp, courseToday, createCourse, listCourses } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET() {
	return courseHttp(() => ({ courses: listCourses(), today: courseToday() }));
}

export async function POST(req: Request) {
	const body = (await req.json().catch(() => ({}))) as { title?: unknown };
	return courseHttp(() => createCourse(typeof body.title === "string" ? body.title : ""));
}
