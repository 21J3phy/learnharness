"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckIcon } from "lucide-react";
import { useServerEvent } from "@/components/server-events";
import { Tex } from "./parts";

/** A chat's place in a course, as GET /api/chats/:id/course returns it. */
export interface ChatCourseLink {
	courseId: string;
	courseTitle: string;
	goalTitle: string;
	sessionKind: "learn" | "review" | "practice";
	sessionStatus: "upcoming" | "done";
	/** Concepts of the session that have a graded check / all of them. */
	checked: number;
	total: number;
	knowledge: number | null;
}

/**
 * The course a chat belongs to, or null for a chat outside any course.
 * Re-read whenever a turn settles, so the session's progress and the goal's
 * meter move as checks are answered.
 */
export function useCourseLink(chatId: string): ChatCourseLink | null {
	const [link, setLink] = useState<ChatCourseLink | null>(null);
	const refresh = useCallback(async () => {
		try {
			const res = await fetch(`/api/chats/${chatId}/course`, { cache: "no-store" });
			if (res.ok) setLink(((await res.json()) as { link: ChatCourseLink | null }).link);
		} catch { /* keep the last reading */ }
	}, [chatId]);
	useEffect(() => { setLink(null); void refresh(); }, [refresh]);
	useServerEvent("turn-settled", (e) => { if (e.chatId === chatId) void refresh(); });
	useServerEvent("record-changed", (e) => { if (e.chatId === chatId) void refresh(); });
	return link;
}

/** Before the session's title: the course it belongs to, and the way back. */
export function CourseCrumb({ link }: { link: ChatCourseLink | null }) {
	if (!link) return null;
	return (
		<>
			<Link
				href={`/course/${link.courseId}`}
				data-testid="course-crumb"
				title={`Back to ${link.courseTitle}`}
				className="lh-no-drag max-w-[26%] shrink-0 truncate rounded-md font-ui text-sm text-muted-foreground transition-colors hover:text-foreground"
			>
				<Tex>{link.courseTitle}</Tex>
			</Link>
			<span className="shrink-0 font-ui text-sm text-border" aria-hidden="true">/</span>
		</>
	);
}

/**
 * After the title: how far through the session the learner is, and the
 * goal's knowledge meter. A finished session offers the way back instead.
 */
export function CourseSessionChip({ link }: { link: ChatCourseLink | null }) {
	if (!link) return null;
	const percent = link.knowledge === null ? null : Math.round(link.knowledge * 100);
	const counted = link.sessionKind === "learn" && link.total > 0;
	const done = link.sessionStatus === "done";
	return (
		<Link
			href={`/course/${link.courseId}`}
			data-testid="course-chip"
			data-done={done || undefined}
			title={`Back to ${link.courseTitle}`}
			className="lh-no-drag flex h-7 shrink-0 items-center gap-2.5 rounded-full border border-border/80 pl-3 pr-2.5 font-ui text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground"
		>
			{done ? (
				<span className="flex items-center gap-1 text-foreground"><CheckIcon className="size-3.5" aria-hidden="true" />Session done</span>
			) : counted && (
				<span className="tabular-nums" aria-label={`${link.checked} of ${link.total} concepts checked`}>
					<span className="text-foreground">{link.checked}</span> of {link.total} checked
				</span>
			)}
			{(done || counted) && <span className="h-3 w-px bg-border" aria-hidden="true" />}
			<span className="max-w-32 truncate">{link.goalTitle}</span>
			<span className="relative h-1 w-12 overflow-hidden rounded-full bg-border/70" aria-hidden="true">
				<span className="absolute inset-y-0 left-0 rounded-full bg-[color:var(--lh-accent)] transition-[width] duration-500" style={{ width: `${percent ?? 0}%` }} />
			</span>
			<span className="tabular-nums text-foreground" aria-label={percent === null ? "Not measured yet" : `${percent}% known`}>{percent === null ? "–" : `${percent}%`}</span>
		</Link>
	);
}
