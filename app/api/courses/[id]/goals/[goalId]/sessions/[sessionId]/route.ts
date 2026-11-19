import { completeSession, courseHttp, startSession, studyConcepts } from "@/src/server";

export const dynamic = "force-dynamic";

/** { action: "start" } opens the session's teaching chat (creating it the
 *  first time); { action: "complete" } marks the session done. The session
 *  id "new" with { conceptIds } studies those concepts now, off-schedule. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; goalId: string; sessionId: string }> }) {
	const { id, goalId, sessionId } = await params;
	const body = (await req.json().catch(() => ({}))) as { action?: unknown; conceptIds?: unknown };
	return courseHttp(() => {
		if (sessionId === "new") return studyConcepts(id, goalId, body.conceptIds);
		return body.action === "complete" ? completeSession(id, goalId, sessionId) : startSession(id, goalId, sessionId);
	});
}
