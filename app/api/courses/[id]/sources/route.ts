/**
 * POST /api/courses/:id/sources — the learner's material in (multipart,
 * field "files"). The files' text is stored and the map build starts; the
 * response returns as soon as the files are stored. Progress arrives on
 * the events channel (courses-changed) and the course record's `build`.
 *
 * A drop too large for one request arrives as several: each carries
 * `batch` (its position, from 0) and `hold=1`, which stores without
 * building; the client then asks for the build (PATCH rebuild). `skipped`
 * is a JSON list of files the browser turned away, kept beside the course.
 */
import { CourseError, addSources, courseHttp } from "@/src/server";
import { FormBodyLimitError, readBoundedFormData } from "@/lib/bounded-form-data.ts";
import { MAX_COURSE_BODY_BYTES, MAX_COURSE_FILE_BYTES, MAX_COURSE_FILES, type SkippedFile } from "@/lib/course-limits.ts";

export const dynamic = "force-dynamic";

function skippedOf(field: unknown): SkippedFile[] {
	if (typeof field !== "string") return [];
	let parsed: unknown;
	try { parsed = JSON.parse(field); } catch { return []; }
	if (!Array.isArray(parsed)) return [];
	return parsed.slice(0, MAX_COURSE_FILES).flatMap((item: { name?: unknown; reason?: unknown }) =>
		typeof item?.name === "string" && typeof item.reason === "string" ? [{ name: item.name.slice(0, 200), reason: item.reason.slice(0, 300) }] : []);
}

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
		if (files.length > MAX_COURSE_FILES) throw new CourseError(`That's more than ${MAX_COURSE_FILES} files. Drop them in smaller groups.`, 413);
		if (files.reduce((sum, f) => sum + f.size, 0) > MAX_COURSE_FILE_BYTES) throw new CourseError("That's too large. The limit is 150 MB.", 413);
		const loaded = await Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
		return addSources(id, loaded, { hold: form.get("hold") === "1", first: (form.get("batch") ?? "0") === "0", skipped: skippedOf(form.get("skipped")) });
	});
}
