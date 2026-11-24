import {
	COURSE_BATCH_BYTES, COURSE_EXTENSIONS, MAX_COURSE_FILE_BYTES, MAX_COURSE_FILES, byFileName, unreadableReason,
	type SkippedFile,
} from "@/lib/course-limits";

/** A drop, sorted: what will be read (in reading order) and what was set
 *  aside, with why. One unreadable file never refuses the rest. */
export interface SortedFiles {
	take: File[];
	skipped: SkippedFile[];
}

export function sortFiles(files: readonly File[]): SortedFiles {
	const take: File[] = [];
	const skipped: SkippedFile[] = [];
	for (const file of [...files].sort(byFileName)) {
		if (!COURSE_EXTENSIONS.test(file.name)) skipped.push({ name: file.name, reason: unreadableReason(file.name) ?? "It isn't a kind of file this can read." });
		else if (file.size > MAX_COURSE_FILE_BYTES) skipped.push({ name: file.name, reason: "It is larger than 150 MB." });
		else if (take.length >= MAX_COURSE_FILES) skipped.push({ name: file.name, reason: `Only the first ${MAX_COURSE_FILES} files of a drop are read.` });
		else take.push(file);
	}
	return { take, skipped };
}

/** The files as uploads of a bounded size, in order. */
export function batchesOf<T extends { size: number }>(files: readonly T[], limit = COURSE_BATCH_BYTES): T[][] {
	const batches: T[][] = [];
	let room = 0;
	for (const file of files) {
		if (batches.length === 0 || file.size > room) {
			batches.push([]);
			room = limit;
		}
		batches[batches.length - 1]!.push(file);
		room -= file.size;
	}
	return batches;
}

/** The course name a first file suggests: its name without the extension. */
export function titleFromFile(name: string): string {
	return name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "New course";
}

/** How much of a source was read, in its own unit ("24 slides"). */
export function sourceSize(source: { kind: "pdf" | "text" | "slides"; pages: number }): string {
	if (source.kind === "text") return "";
	const unit = source.kind === "slides" ? "slide" : "page";
	return `${source.pages.toLocaleString("en-US")} ${unit}${source.pages === 1 ? "" : "s"}`;
}
