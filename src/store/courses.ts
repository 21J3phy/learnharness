/**
 * CourseStore — the fs JSON adapter for courses (this fork's layer).
 *
 *   data/courses/<id>/course.json          the record (core/course.ts Course)
 *   data/courses/<id>/sources/<sid>.json   one dropped file's text, page by page
 *
 * Idioms follow the other adapters: sync fs, id-guarded filenames, atomic
 * replacement, notify-after-write. Read-modify-write sections contain no
 * awaits, so one server process never interleaves two updates of a record.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS } from "../../config.ts";
import { emit } from "../core/events.ts";
import { COURSE_FORMAT_VERSION, type Course } from "../core/course.ts";
import { writeFileAtomicSync } from "./atomic-write.ts";

const COURSES_DIR = path.join(/* turbopackIgnore: true */ PATHS.data, "courses");
const ID_RE = /^[A-Za-z0-9_-]+$/;

/** One page of a source's text. Plain text files are a single page 1. */
export interface SourcePage {
	number: number;
	text: string;
}

function courseDir(id: string): string {
	if (!ID_RE.test(id)) throw new Error(`Invalid course id: ${id}`);
	return path.join(/* turbopackIgnore: true */ COURSES_DIR, id);
}

function courseFile(id: string): string {
	return path.join(/* turbopackIgnore: true */ courseDir(id), "course.json");
}

function sourceFile(courseId: string, sourceId: string): string {
	if (!ID_RE.test(sourceId)) throw new Error(`Invalid source id: ${sourceId}`);
	return path.join(/* turbopackIgnore: true */ courseDir(courseId), "sources", `${sourceId}.json`);
}

function write(course: Course): void {
	fs.mkdirSync(courseDir(course.id), { recursive: true });
	writeFileAtomicSync(courseFile(course.id), JSON.stringify({ ...course, version: COURSE_FORMAT_VERSION }, null, "\t"), { allowInPlaceFallback: true });
}

function get(id: string): Course | null {
	if (!ID_RE.test(id)) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ courseFile(id), "utf-8"));
	} catch {
		return null;
	}
	const version = (parsed as { version?: unknown }).version;
	// A record written by a newer build reads as absent, never misparsed.
	if (typeof version === "number" && version > COURSE_FORMAT_VERSION) return null;
	return parsed as Course;
}

function list(): Course[] {
	let names: string[];
	try {
		names = fs.readdirSync(/* turbopackIgnore: true */ COURSES_DIR);
	} catch {
		return [];
	}
	return names
		.filter((name) => ID_RE.test(name))
		.map(get)
		.filter((c): c is Course => c !== null)
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function create(title: string): Course {
	const now = new Date().toISOString();
	const course: Course = {
		id: `course_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`,
		version: COURSE_FORMAT_VERSION,
		title: title.trim() || "Untitled course",
		createdAt: now,
		updatedAt: now,
		sources: [],
		units: [],
		concepts: [],
		evidence: [],
		goals: [],
		suggestions: [],
		build: { status: "idle", done: 0, total: 0, found: [] },
	};
	write(course);
	emit("courses-changed", { courseId: course.id });
	return course;
}

/** Read, change, write — in one synchronous section. Returns the stored
 *  record, or null when the course is gone (deleted mid-build is not an
 *  error). `touch: false` keeps updatedAt (and so the list order) still. */
function update(id: string, change: (course: Course) => Course | void, options?: { touch?: boolean; silent?: boolean }): Course | null {
	const current = get(id);
	if (!current) return null;
	const next = change(current) ?? current;
	if (options?.touch !== false) next.updatedAt = new Date().toISOString();
	write(next);
	if (!options?.silent) emit("courses-changed", { courseId: id });
	return next;
}

function remove(id: string): boolean {
	if (!get(id)) return false;
	fs.rmSync(courseDir(id), { recursive: true, force: true });
	emit("courses-changed", { courseId: id });
	return true;
}

function writeSource(courseId: string, sourceId: string, pages: SourcePage[]): void {
	fs.mkdirSync(path.dirname(sourceFile(courseId, sourceId)), { recursive: true });
	writeFileAtomicSync(sourceFile(courseId, sourceId), JSON.stringify(pages), { allowInPlaceFallback: true });
}

function readSource(courseId: string, sourceId: string): SourcePage[] {
	try {
		return JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ sourceFile(courseId, sourceId), "utf-8")) as SourcePage[];
	} catch {
		return [];
	}
}

function removeSource(courseId: string, sourceId: string): void {
	fs.rmSync(sourceFile(courseId, sourceId), { force: true });
}

export const courseStore = { create, get, list, update, remove, writeSource, readSource, removeSource };
export type CourseStore = typeof courseStore;
