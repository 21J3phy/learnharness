import { courseHttp, planGoal } from "@/src/server";

export const dynamic = "force-dynamic";

/** Build the goal's plan, or rebuild it from today (missed days, new
 *  preferences, changed estimates). Body: optional { minutesPerDay, weekdays }. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; goalId: string }> }) {
	const { id, goalId } = await params;
	const body = (await req.json().catch(() => undefined)) as unknown;
	return courseHttp(() => planGoal(id, goalId, body));
}
