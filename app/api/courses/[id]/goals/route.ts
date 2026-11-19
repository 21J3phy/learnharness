import { courseHttp, createGoal } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
	return courseHttp(() => createGoal(id, body));
}
