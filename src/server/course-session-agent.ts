/**
 * A plan session's teacher knows what time it is. For a chat that is a
 * session of a study plan, the agent gets one more tool (session_clock)
 * and one more instruction (how to keep pace) beside whatever plugins add.
 *
 * The instruction is fixed text and the clock is a tool result, so nothing
 * here changes the system prompt from turn to turn.
 */
import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AgentBuildOptions } from "../agent/teacher-agent.ts";
import { serverExecute } from "../agent/tool-execute.ts";
import { SESSION_PACE_GUIDANCE, isCourseSession, sessionClock } from "./courses.ts";

type Contributions = NonNullable<AgentBuildOptions["pluginContributions"]>;

export const SESSION_CLOCK_TOOL = "session_clock";
const noInput = Type.Object({});

function clockTool(chatId: string): AgentTool<any> {
	return {
		name: SESSION_CLOCK_TOOL,
		label: SESSION_CLOCK_TOOL,
		description: "The date and time now, how long the learner has studied in this session against its planned length, which of its concepts are checked, whether the session is ahead or behind, and the rest of the study plan up to the exam. Takes no input.",
		parameters: noInput,
		execute: serverExecute(SESSION_CLOCK_TOOL, noInput, () => sessionClock(chatId) ?? "This chat is no longer part of a study plan (the plan was rebuilt or removed). Carry on without a schedule."),
	};
}

/** The contributions for a chat's agent, with the session clock added when the chat is a plan session. */
export function withCourseSession(base: Contributions | undefined, chatId: string): Contributions | undefined {
	if (!isCourseSession(chatId)) return base;
	return (context, reserved) => {
		const out = base ? base(context, reserved) : { instructions: [], tools: [] };
		if (context.agent === "prober" || reserved.includes(SESSION_CLOCK_TOOL) || out.tools.some((tool) => tool.name === SESSION_CLOCK_TOOL)) return out;
		return { ...out, instructions: [...out.instructions, SESSION_PACE_GUIDANCE], tools: [...out.tools, clockTool(context.chatId)] };
	};
}
