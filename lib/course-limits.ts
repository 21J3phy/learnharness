/** One course upload: whole textbooks are welcome, plus multipart headroom. */
export const MAX_COURSE_FILE_BYTES = 150 * 1024 * 1024;
export const MAX_COURSE_BODY_BYTES = MAX_COURSE_FILE_BYTES + 1024 * 1024;

/** The file types a course takes; the picker's `accept` and the client check derive from it. */
const COURSE_EXTENSION_NAMES = ["pdf", "txt", "md", "markdown", "rst", "org", "adoc", "tex"];
export const COURSE_EXTENSIONS = new RegExp(`\\.(?:${COURSE_EXTENSION_NAMES.join("|")})$`, "i");
export const COURSE_ACCEPT = COURSE_EXTENSION_NAMES.map((name) => `.${name}`).join(",");
