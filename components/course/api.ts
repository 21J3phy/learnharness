"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useServerEvent, useServerResync } from "@/components/server-events";
import type { Course, CourseSummary, Mastery } from "@/src/core";

/** The course as GET /api/courses/:id returns it. */
export interface CourseView extends Course {
	today: string;
	mastery: Record<string, Mastery>;
	nextQuestion: Record<string, string>;
}

/** A refusal from the course API, with the machine code when one applies. */
export class CourseApiError extends Error {
	constructor(message: string, readonly code?: string, readonly status?: number) {
		super(message);
	}
}

/** True when the refusal means "set up your models first". */
export const needsModels = (error: unknown): boolean =>
	error instanceof CourseApiError && (error.code === "models_not_configured" || error.code === "provider_key_missing");

async function send<T>(url: string, init?: RequestInit): Promise<T> {
	let res: Response;
	try {
		res = await fetch(url, init);
	} catch {
		throw new CourseApiError("Couldn't reach the app. Check that it is still running.");
	}
	const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
	if (!res.ok) throw new CourseApiError(body.error ?? "Something went wrong. Try again.", body.code, res.status);
	return body as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
	method,
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify(body ?? {}),
});

export const courseApi = {
	list: () => send<{ courses: CourseSummary[]; today: string }>("/api/courses"),
	create: (title: string) => send<CourseView>("/api/courses", json("POST", { title })),
	get: (id: string) => send<CourseView>(`/api/courses/${id}`),
	rename: (id: string, title: string) => send<CourseView>(`/api/courses/${id}`, json("PATCH", { title })),
	rebuild: (id: string) => send<CourseView>(`/api/courses/${id}`, json("PATCH", { rebuild: true })),
	remove: (id: string) => send<{ ok: true }>(`/api/courses/${id}`, { method: "DELETE" }),
	addSources: (id: string, files: readonly File[]) => {
		const form = new FormData();
		for (const file of files) form.append("files", file);
		return send<CourseView>(`/api/courses/${id}/sources`, { method: "POST", body: form });
	},
	createGoal: (id: string, goal: { title: string; kind: string; date: string; unitIds: string[]; note?: string }) =>
		send<{ course: CourseView; goalId: string }>(`/api/courses/${id}/goals`, json("POST", goal)),
	updateGoal: (id: string, goalId: string, goal: Record<string, unknown>) =>
		send<CourseView>(`/api/courses/${id}/goals/${goalId}`, json("PATCH", goal)),
	deleteGoal: (id: string, goalId: string) => send<CourseView>(`/api/courses/${id}/goals/${goalId}`, { method: "DELETE" }),
	startDiagnostic: (id: string, goalId: string) =>
		send<CourseView>(`/api/courses/${id}/goals/${goalId}/diagnostic`, json("POST", { action: "start" })),
	answer: (id: string, goalId: string, questionId: string, choice: number | null) =>
		send<{ correct: boolean; correctIndex: number; explanation: string; done: boolean; course: CourseView }>(
			`/api/courses/${id}/goals/${goalId}/diagnostic`, json("POST", { action: "answer", questionId, choice }),
		),
	finishDiagnostic: (id: string, goalId: string) =>
		send<CourseView>(`/api/courses/${id}/goals/${goalId}/diagnostic`, json("POST", { action: "finish" })),
	plan: (id: string, goalId: string, prefs?: { minutesPerDay: number; weekdays: number[] }) =>
		send<CourseView>(`/api/courses/${id}/goals/${goalId}/plan`, json("POST", prefs)),
	startSession: (id: string, goalId: string, sessionId: string) =>
		send<{ chatId: string; prompt?: string }>(`/api/courses/${id}/goals/${goalId}/sessions/${sessionId}`, json("POST", { action: "start" })),
	completeSession: (id: string, goalId: string, sessionId: string) =>
		send<CourseView>(`/api/courses/${id}/goals/${goalId}/sessions/${sessionId}`, json("POST", { action: "complete" })),
	studyConcept: (id: string, goalId: string, conceptId: string) =>
		send<{ chatId: string; prompt?: string }>(`/api/courses/${id}/goals/${goalId}/sessions/new`, json("POST", { action: "start", conceptIds: [conceptId] })),
};

/** One course, kept current: refetched on its change events and on reconnect. */
export function useCourse(id: string, initial: CourseView | null) {
	const [course, setCourse] = useState<CourseView | null>(initial);
	const [missing, setMissing] = useState(false);
	const latest = useRef(0);
	const refresh = useCallback(async () => {
		const ticket = ++latest.current;
		try {
			const next = await courseApi.get(id);
			if (ticket === latest.current) setCourse(next);
		} catch (error) {
			if (error instanceof CourseApiError && error.status === 404 && ticket === latest.current) setMissing(true);
		}
	}, [id]);
	useServerEvent("courses-changed", (e) => { if (!e.courseId || e.courseId === id) void refresh(); });
	// A teaching session's checks move the map: pick them up when a turn settles.
	useServerEvent("turn-settled", () => { void refresh(); });
	useServerResync(() => { void refresh(); });
	useEffect(() => {
		const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
		document.addEventListener("visibilitychange", onVisible);
		return () => document.removeEventListener("visibilitychange", onVisible);
	}, [refresh]);
	/** Adopt a record a mutation just returned (newer than any fetch in flight). */
	const adopt = useCallback((next: CourseView) => { latest.current++; setCourse(next); }, []);
	return { course, missing, refresh, adopt };
}

/** Every course's summary, kept current. `today` is the server's calendar
 *  day (null until the first read when no initial list was given). */
export function useCourses(initial: CourseSummary[] | null, initialToday: string | null = null) {
	const [state, setState] = useState<{ courses: CourseSummary[] | null; today: string | null }>({ courses: initial, today: initialToday });
	const latest = useRef(0);
	const refresh = useCallback(async () => {
		const ticket = ++latest.current;
		try {
			const next = await courseApi.list();
			if (ticket === latest.current) setState(next);
		} catch { /* keep the last list */ }
	}, []);
	useEffect(() => { if (initial === null) void refresh(); }, [initial, refresh]);
	useServerEvent("courses-changed", () => { void refresh(); });
	// A session's checks move its course's meter and step.
	useServerEvent("turn-settled", () => { void refresh(); });
	useServerResync(() => { void refresh(); });
	return { courses: state.courses, today: state.today, refresh };
}
