import { courseHttp, deleteGoal, updateGoal } from "@/src/server";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string; goalId: string }> };

export async function PATCH(req: Request, { params }: Params) {
	const { id, goalId } = await params;
	const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
	return courseHttp(() => updateGoal(id, goalId, body));
}

export async function DELETE(_req: Request, { params }: Params) {
	const { id, goalId } = await params;
	return courseHttp(() => deleteGoal(id, goalId));
}
