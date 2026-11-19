import { CourseError, courseHttp, deleteCourse, getCourse, rebuildCourse, renameCourse } from "@/src/server";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
	const { id } = await params;
	return courseHttp(() => {
		const course = getCourse(id);
		if (!course) throw new CourseError("That course no longer exists.", 404, "not_found");
		return course;
	});
}

/** { title } renames; { rebuild: true } reads the material again. */
export async function PATCH(req: Request, { params }: Params) {
	const { id } = await params;
	const body = (await req.json().catch(() => ({}))) as { title?: unknown; rebuild?: unknown };
	return courseHttp(() => {
		if (body.rebuild === true) return rebuildCourse(id);
		return renameCourse(id, typeof body.title === "string" ? body.title : "");
	});
}

export async function DELETE(_req: Request, { params }: Params) {
	const { id } = await params;
	return courseHttp(() => {
		if (!deleteCourse(id)) throw new CourseError("That course no longer exists.", 404, "not_found");
		return { ok: true };
	});
}
