"use client";

import { useCallback, useRef, useState } from "react";
import { COURSE_ACCEPT, MAX_COURSE_FILES, byFileName } from "@/lib/course-limits";

/** Folders that are really one document (a Keynote deck saved as a package). */
const PACKAGE = /\.(?:key|pages|numbers|rtfd|app|bundle|photoslibrary)$/i;
/** Dotfiles and Office's lock files. */
const HIDDEN = /^(?:\.|~\$)/;

/** What a drop holds. `folder` names the one folder that was dropped. */
export interface Dropped {
	files: File[];
	folder?: string;
}

/**
 * Every file in a drop, folders opened all the way down. A file in a
 * subfolder carries the subfolder in its name ("Week 2 - Slides.pptx"), so
 * a course of weekly folders stays in order and its files stay apart.
 */
async function gather(entries: readonly FileSystemEntry[]): Promise<Dropped> {
	const files: File[] = [];
	const walk = async (entry: FileSystemEntry, prefix: string | null) => {
		if (files.length >= MAX_COURSE_FILES * 2 || HIDDEN.test(entry.name)) return;
		try {
			if (entry.isFile) {
				const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
				files.push(prefix ? new File([file], `${prefix} - ${file.name}`, { type: file.type, lastModified: file.lastModified }) : file);
			} else if (PACKAGE.test(entry.name)) {
				files.push(new File([], prefix ? `${prefix} - ${entry.name}` : entry.name));
			} else {
				const reader = (entry as FileSystemDirectoryEntry).createReader();
				const inside = prefix === null ? "" : prefix ? `${prefix} - ${entry.name}` : entry.name;
				for (;;) {
					// A folder is read in pages; an empty page ends it.
					const page = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
					if (page.length === 0) break;
					for (const kid of page.sort(byFileName)) await walk(kid, inside);
				}
			}
		} catch { /* an unreadable entry is left out */ }
	};
	for (const entry of entries) await walk(entry, entry.isDirectory ? null : "");
	const only = entries.length === 1 && entries[0]!.isDirectory && !PACKAGE.test(entries[0]!.name) ? entries[0]!.name : undefined;
	return { files, ...(only ? { folder: only } : {}) };
}

/**
 * File drop for a region of the page: files, several at once, or whole
 * folders. The handlers stop the event before the app-wide path drop zone
 * (which turns files into chat attachments) sees it — inside a course
 * surface a dropped file is course material.
 */
export function useFileDrop(onFiles: (dropped: Dropped) => void, enabled = true) {
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
			// Entries must be taken now: the drop's items are gone after this turn.
			const entries = Array.from(e.dataTransfer.items ?? [])
				.map((item) => (item.kind === "file" ? item.webkitGetAsEntry?.() ?? null : null))
				.filter((entry): entry is FileSystemEntry => entry !== null);
			if (entries.some((entry) => entry.isDirectory)) void gather(entries).then(onFiles);
			else onFiles({ files: Array.from(e.dataTransfer.files) });
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
				if (files.length > 0) onFiles({ files });
			}}
		/>
	);
	return { over, zone, choose, picker };
}
