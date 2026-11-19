/**
 * POST /api/courses/:id/sources — the learner's material in (multipart,
 * field "files"). The files' text is stored and the map build starts; the
 * response returns as soon as the files are stored. Progress arrives on
 * the events channel (courses-changed) and the course record's `build`.
 */
import { CourseError, addSources, courseHttp } from "@/src/server";
import { FormBodyLimitError, readBoundedFormData } from "@/lib/bounded-form-data.ts";
import { MAX_COURSE_BODY_BYTES, MAX_COURSE_FILE_BYTES } from "@/lib/course-limits.ts";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	return courseHttp(async () => {
		let form: FormData;
		try {
			form = await readBoundedFormData(req, MAX_COURSE_BODY_BYTES);
		} catch (error) {
			if (error instanceof FormBodyLimitError) throw new CourseError("That's too large. The limit is 150 MB.", 413);
			throw new CourseError("The upload didn't arrive whole. Try again.");
		}
		const files = form.getAll("files").filter((f): f is File => f instanceof File);
		if (files.length === 0) throw new CourseError("No files arrived.");
		if (files.reduce((sum, f) => sum + f.size, 0) > MAX_COURSE_FILE_BYTES) throw new CourseError("That's too large. The limit is 150 MB.", 413);
		const loaded = await Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
		return addSources(id, loaded);
	});
}
