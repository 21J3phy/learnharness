import type { SkippedFile } from "../src/core/course.ts";

/** One course upload: whole textbooks are welcome, plus multipart headroom. */
export const MAX_COURSE_FILE_BYTES = 150 * 1024 * 1024;
export const MAX_COURSE_BODY_BYTES = MAX_COURSE_FILE_BYTES + 1024 * 1024;

/** The file types a course takes; the picker's `accept` and the client check derive from it. */
const COURSE_EXTENSION_NAMES = [
	"pdf", "pptx", "ppsx", "pptm", "docx", "docm", "epub", "html", "htm",
	"txt", "md", "markdown", "rst", "org", "adoc", "tex",
];
export const COURSE_EXTENSIONS = new RegExp(`\\.(?:${COURSE_EXTENSION_NAMES.join("|")})$`, "i");
export const COURSE_ACCEPT = COURSE_EXTENSION_NAMES.map((name) => `.${name}`).join(",");
/** The readable kinds, as the learner is told them. */
export const COURSE_KINDS = "PDF, PowerPoint, Word, EPUB or text";

/** One drop, however it is split into uploads. */
export const MAX_COURSE_FILES = 400;
/** Files travel in uploads of about this size, so a folder of decks never
 *  has to fit in one request. */
export const COURSE_BATCH_BYTES = 96 * 1024 * 1024;

export type { SkippedFile };

const UNREADABLE: [RegExp, string][] = [
	[/\.key$/i, "Keynote files can't be read. In Keynote, choose File › Export To › PowerPoint or PDF, and drop that."],
	[/\.pages$/i, "Pages files can't be read. In Pages, choose File › Export To › Word or PDF, and drop that."],
	[/\.(?:ppt|pps|pot)$/i, "It is in the old PowerPoint format. Save it as .pptx or PDF."],
	[/\.(?:doc|dot|rtf|rtfd)$/i, "It is in an older document format. Save it as .docx or PDF."],
	[/\.(?:odp|odt|ods)$/i, "OpenDocument files can't be read yet. Save it as PowerPoint, Word or PDF."],
	[/\.(?:png|jpe?g|heic|heif|gif|webp|tiff?|bmp|svg)$/i, "Pictures can't be read yet."],
	[/\.(?:mp4|mov|m4v|avi|mkv|webm|mp3|m4a|wav|aac)$/i, "Recordings can't be read."],
	[/\.(?:zip|rar|7z|tar|gz|tgz)$/i, "It is an archive. Unpack it and drop the folder."],
	[/\.(?:xlsx?|numbers|csv)$/i, "Spreadsheets can't be read."],
];

/** Why a file of a known kind can't be taken, or null when the name gives no reason. */
export function unreadableReason(name: string): string | null {
	return UNREADABLE.find(([pattern]) => pattern.test(name))?.[1] ?? null;
}

/** Lecture 2 before Lecture 10: the order a folder of files is read in. */
export const byFileName = (a: { name: string }, b: { name: string }): number =>
	a.name.localeCompare(b.name, "en", { numeric: true, sensitivity: "base" });

/** What to say when a drop held nothing readable. */
export function nothingRead(skipped: readonly SkippedFile[]): string {
	if (skipped.length === 0) return "Nothing was dropped.";
	if (skipped.length === 1) return `“${skipped[0]!.name}” wasn't read. ${skipped[0]!.reason}`;
	const shown = skipped.slice(0, 3).map((file) => `${file.name}: ${file.reason}`).join(" ");
	return `None of these ${skipped.length} files could be read. ${shown}`;
}
