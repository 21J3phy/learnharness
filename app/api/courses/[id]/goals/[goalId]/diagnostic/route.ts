import { answerDiagnostic, courseHttp, finishDiagnostic, startDiagnostic } from "@/src/server";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string; goalId: string }> };

/**
 * { action: "start" }                      write the questions (again)
 * { action: "answer", questionId, choice } choice null = "I don't know"
 * { action: "finish" }                     stop early; the answers so far stand
 */
export async function POST(req: Request, { params }: Params) {
	const { id, goalId } = await params;
	const body = (await req.json().catch(() => ({}))) as { action?: unknown; questionId?: unknown; choice?: unknown };
	return courseHttp(() => {
		if (body.action === "answer") {
			return answerDiagnostic(id, goalId, typeof body.questionId === "string" ? body.questionId : "", typeof body.choice === "number" ? body.choice : null);
		}
		if (body.action === "finish") return finishDiagnostic(id, goalId);
		return startDiagnostic(id, goalId);
	});
}
