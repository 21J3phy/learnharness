"use client";

import { useCallback, useRef, useState } from "react";
import { COURSE_ACCEPT, COURSE_EXTENSIONS, MAX_COURSE_FILE_BYTES } from "@/lib/course-limits";

/** Why a set of files can't be taken, in the learner's terms — or null. */
export function refusalFor(files: readonly File[]): string | null {
	if (files.length === 0) return "Nothing was dropped.";
	const wrong = files.find((f) => !COURSE_EXTENSIONS.test(f.name));
	if (wrong) return `“${wrong.name}” isn't a file this can read. Use a PDF, Markdown or text file.`;
	if (files.reduce((sum, f) => sum + f.size, 0) > MAX_COURSE_FILE_BYTES) return "That's more than 150 MB. Try the textbook on its own.";
	return null;
}

/**
 * File drop for a region of the page. The handlers stop the event before
 * the app-wide path drop zone (which turns files into chat attachments)
 * sees it — inside a course surface a dropped file is course material.
 */
export function useFileDrop(onFiles: (files: File[]) => void, enabled = true) {
	const depth = useRef(0);
	const [over, setOver] = useState(false);
	const input = useRef<HTMLInputElement>(null);
	const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
	const zone = {
		onDragEnter: (e: React.DragEvent) => {
			if (!enabled || !hasFiles(e)) return;
			e.preventDefault();
			e.stopPropagation();
			depth.current++;
			setOver(true);
		},
		onDragOver: (e: React.DragEvent) => {
			if (!enabled || !hasFiles(e)) return;
			e.preventDefault();
			e.stopPropagation();
			e.dataTransfer.dropEffect = "copy";
		},
		onDragLeave: (e: React.DragEvent) => {
			if (!enabled || !hasFiles(e)) return;
			e.stopPropagation();
			depth.current = Math.max(0, depth.current - 1);
			if (depth.current === 0) setOver(false);
		},
		onDrop: (e: React.DragEvent) => {
			if (!enabled || !hasFiles(e)) return;
			e.preventDefault();
			e.stopPropagation();
			depth.current = 0;
			setOver(false);
			onFiles(Array.from(e.dataTransfer.files));
		},
	};
	const choose = useCallback(() => input.current?.click(), []);
	const picker = (
		<input
			ref={input}
			type="file"
			accept={COURSE_ACCEPT}
			multiple
			hidden
			onChange={(e) => {
				const files = Array.from(e.target.files ?? []);
				e.target.value = "";
				if (files.length > 0) onFiles(files);
			}}
		/>
	);
	return { over, zone, choose, picker };
}

/** The course name a first file suggests: its name without the extension. */
export function titleFromFile(name: string): string {
	return name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "New course";
}
