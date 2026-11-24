import { courseHttp, talkAboutPlan } from "@/src/server";

export const dynamic = "force-dynamic";

/** One turn of the conversation about the goal's plan: a question answered,
 *  or the plan changed. Body: { message }. Returns the course. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; goalId: string }> }) {
	const { id, goalId } = await params;
	const body = (await req.json().catch(() => ({}))) as { message?: unknown };
	return courseHttp(() => talkAboutPlan(id, goalId, body.message));
}
