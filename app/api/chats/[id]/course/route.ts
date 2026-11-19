import { courseHttp, courseLinkForChat } from "@/src/server";

export const dynamic = "force-dynamic";

/** The course session this chat belongs to, or { link: null }. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	return courseHttp(() => ({ link: courseLinkForChat(id) }));
}
