# Courses

This fork adds one layer on top of LearnHarness: a **course** built from your own material, with goals, a diagnostic, a dated plan and a knowledge meter. Teaching itself is unchanged — a course session is an ordinary LearnHarness teaching chat, opened already knowing what to teach and where you stand.

## The flow

1. **Drop in your material.** A textbook, a syllabus, lecture notes (PDF with selectable text, Markdown or plain text, up to 150 MB). The app reads it in parts, finds the concepts it teaches, then groups them into units and links each concept to the ones it rests on. A syllabus decides the units and their order; exams it lists are offered as goals.
2. **Set a goal.** What you are studying for, when, and which units it covers. Each goal has its own small map: its units' concepts, plus the earlier concepts they depend on.
3. **Take the diagnostic.** Multiple-choice questions written from your material. Each answer also moves the estimates of the concepts around it, so the next question is always the one that settles the most, and the quiz stops when the picture is clear or its budget runs out.
4. **Get a plan.** The concepts you don't hold yet are laid over the days until the exam, prerequisites first, within the time you said you have. With enough runway the last days are a practice exam and a final review. The plan can be rebuilt at any time (missed days, new estimates, different hours).
5. **Study.** Starting a session opens a teaching chat. The teacher receives the session's concepts, excerpts of your material, and your level on each concept as a concluded assessment, so it plans and starts teaching without probing again.

## The knowledge meter

The meter is the share of a goal's concepts you are estimated to hold. It is derived, never stored:

- Every graded answer is one piece of **evidence** on one concept: a diagnostic question, a check in a teaching session, or your own "mark done" (which counts for half).
- A right answer lifts that concept and, more weakly and fading with distance, the concepts it rests on. A wrong answer drops it and, fading the same way, what is built on it. One right answer alone never marks a prerequisite as solid; it takes a second supporting answer or a direct one.
- The meter is the mean estimate over the goal's concepts, and its history is the estimate after each answer. The diagnostic sets it; every later check refines it. A session's chat shows it in the header and re-reads it whenever a turn settles.

Checks in a session are traced to concepts through the lesson plan: the teacher is told to use concept ids as plan node ids, and a check names the node it is about.

## Where things live

| Part | File |
| --- | --- |
| Record shapes and the pure logic (graph, mastery, meter, diagnostic choice, planner) | `src/core/course.ts` |
| Storage: `<data>/courses/<id>/course.json` and `sources/<sid>.json` | `src/store/courses.ts` |
| The three model agents: read a part, organize the course, write questions | `src/agent/subagents/course-agents.ts` |
| The service: build, goals, diagnostic, plan, sessions, evidence sync | `src/server/courses.ts` |
| Routes | `app/api/courses/**`, `app/api/chats/[id]/course` |
| Screens | `components/course/**`, `app/page.tsx`, `app/course/[id]/page.tsx` |
| Tests for the pure logic | `tests/course-core.test.ts` |

The home page is now the list of courses. The free-form knowledge graph that used to be home is at `/graph` (sidebar: Knowledge graph).

## Models

Reading the material uses the **Cheap** slot. Organizing the course, writing the diagnostic and teaching use the **Strong** slot. Nothing runs until those are chosen.

## Limits worth knowing

- Scanned PDFs (no selectable text) can't be read; there is no OCR.
- The app does not check arithmetic. Questions and their keys are written by the model. If an answer key looks wrong, it may be.
- A practice-exam session is a LearnHarness practice chat; its results do not move the meter.
- Rebuilding a map keeps the id (and so the evidence) of every concept whose name survives; a renamed concept starts untested.
