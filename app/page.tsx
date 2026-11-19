import { CoursesHome } from "@/components/course/courses-home";
import { listCourses, readSettingsRecord } from "@/src/server";
import { slotsConfigured } from "@/src/core";

// Dynamic: the course list and the configured state are per-machine disk
// state, read on every navigation.
export const dynamic = "force-dynamic";

/** Home is the learner's courses. The free-form knowledge graph that used
 *  to live here is at /graph. */
export default function HomePage() {
	return <CoursesHome initialCourses={listCourses()} initialConfigured={slotsConfigured(readSettingsRecord()?.models)} />;
}
