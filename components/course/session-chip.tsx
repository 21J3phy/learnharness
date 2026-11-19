"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useServerEvent } from "@/components/server-events";

interface ChatCourseLink {
	courseId: string;
	courseTitle: string;
	goalTitle: string;
	knowledge: number | null;
}

/**
 * In a teaching chat that belongs to a course: the way back to the course,
 * carrying the goal's knowledge meter. The meter is re-read whenever a turn
 * settles, so it moves as the session's checks are answered.
 */
export function CourseSessionChip({ chatId }: { chatId: string }) {
	const [link, setLink] = useState<ChatCourseLink | null>(null);
	const refresh = useCallback(async () => {
		try {
			const res = await fetch(`/api/chats/${chatId}/course`, { cache: "no-store" });
			if (res.ok) setLink(((await res.json()) as { link: ChatCourseLink | null }).link);
		} catch { /* keep the last reading */ }
	}, [chatId]);
	useEffect(() => { void refresh(); }, [refresh]);
	useServerEvent("turn-settled", (e) => { if (e.chatId === chatId) void refresh(); });
	useServerEvent("record-changed", (e) => { if (e.chatId === chatId) void refresh(); });
	if (!link) return null;
	const percent = link.knowledge === null ? null : Math.round(link.knowledge * 100);
	return (
		<Link
			href={`/course/${link.courseId}`}
			data-testid="course-chip"
			title={`Back to ${link.courseTitle}`}
			className="lh-no-drag flex shrink-0 items-center gap-2 rounded-full border border-border/80 py-0.5 pl-2.5 pr-1 font-ui text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground"
		>
			<span className="max-w-40 truncate">{link.goalTitle}</span>
			<span className="relative h-4 w-14 overflow-hidden rounded-full bg-accent" aria-hidden="true">
				<span className="absolute inset-y-0 left-0 rounded-full bg-[color:var(--sy-hl-band)] transition-[width] duration-500" style={{ width: `${percent ?? 0}%` }} />
			</span>
			<span className="w-8 tabular-nums text-foreground" aria-label={percent === null ? "Not measured yet" : `${percent}% known`}>{percent === null ? "–" : `${percent}%`}</span>
		</Link>
	);
}
