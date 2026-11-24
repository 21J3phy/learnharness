# Courses

This fork adds one layer on top of LearnHarness: a **course** built from your own material, with goals, a diagnostic, a dated plan and a knowledge meter. Teaching itself is unchanged — a course session is an ordinary LearnHarness teaching chat, opened already knowing what to teach and where you stand.

## The flow

1. **Drop in your material.** A textbook, lecture slides, a syllabus, your notes: several files at once, or a whole folder (see "What you can drop in" below). The app reads it in parts, finds the concepts it teaches, then groups them into units and links each concept to the ones it rests on. A syllabus decides the units and their order; a series of lecture files is taken in file-name order (Lecture 2 before Lecture 10). Exams the material lists are offered as goals.
2. **Set a goal.** What you are studying for, when, and which units it covers. Each goal has its own small map: its units' concepts, plus the earlier concepts they depend on.
3. **Take the diagnostic.** Multiple-choice questions written from your material. Each answer also moves the estimates of the concepts around it, so the next question is always the one that settles the most, and the quiz stops when the picture is clear or its budget runs out.
4. **Get a plan.** The concepts you don't hold yet are laid over the days until the exam, prerequisites first, within the time you said you have. With enough runway the last days are a practice exam and a final review. The plan can be rebuilt at any time (missed days, new estimates, different hours).
5. **Study.** Starting a session opens a teaching chat. The teacher receives the session's concepts, excerpts of your material, and your level on each concept as a concluded assessment, so it plans and starts teaching without probing again.

## What you can drop in

| Kind | Files | How it is read |
| --- | --- | --- |
| PDF | `.pdf` | Page by page. Needs selectable text. |
| PowerPoint | `.pptx`, `.ppsx`, `.pptm` | One page per slide: title, bullets, tables, equations and speaker notes. A slide with only pictures is skipped and counted. |
| Word | `.docx`, `.docm` | Headings, lists, tables and equations. |
| EPUB | `.epub` | The book in reading order. Copy-protected books can't be read. |
| Web page and text | `.html`, `.md`, `.txt`, `.tex`, `.rst`, `.org`, `.adoc` | As text. |

- **Folders.** Dropping a folder takes every file in it, subfolders included. A file in a subfolder carries the subfolder in its name ("Week 2 - Slides.pptx"). A single dropped folder names the new course until the map supplies a title.
- **Mixed drops.** A file that can't be read (Keynote, old `.ppt`/`.doc`, pictures, a damaged or password-protected file) is set aside and the rest are read. The course page lists every file under its title: how much of each was read, and for the ones set aside, why and what to do. Only a drop where nothing could be read is refused.
- **Size.** Each file up to 150 MB, up to 400 files in one drop. A large drop is sent as several uploads and the map is built once, after the last.
- **Equations.** Office equations are read as LaTeX (fractions, powers, roots, matrices). Equations that are pictures are not read.

## The screens

- **Home** is what today asks for. Each course shows its meter and its next step, in the order of the flow above: add material, set a goal, take the diagnostic, build the plan, then the session that is due. A due session starts from here in one click. Courses are listed by urgency: a session due today first, then the nearest exam.
- **A course** leads with the goal's meter and the one next step, then the days up to the exam, then the map.
- **The map** has two levels. Each unit is one line with how much of it you hold; opening a unit shows its concepts in teaching order. A short course starts fully open; a long one opens at the unit of the session that is due. Pointing at a concept draws what it rests on and what it leads to, and a link into a closed unit ends at that unit's line.
- **The sidebar** is organised by course. A course's study sessions sit under it while you are in the course; chats started outside any course come after, under "Other chats". Search covers every session.
- **A session's chat** names its course before the title (the way back), and shows how many of the session's concepts have been checked next to the goal's meter.

A learning session of three or more concepts is named after its unit, numbered when the unit runs over several sessions ("Determinants, part 2"); the course page lists the concepts underneath.

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
| Reading a dropped file into pages of text (PDF, PowerPoint, Word, EPUB, HTML, text) | `src/server/course-files.ts` |
| The readable kinds, the limits, and the reason given for each unreadable kind | `lib/course-limits.ts` |
| The service: build, goals, diagnostic, plan, sessions, evidence sync | `src/server/courses.ts` |
| Routes | `app/api/courses/**`, `app/api/chats/[id]/course` |
| Screens | `components/course/**`, `app/page.tsx`, `app/course/[id]/page.tsx`, the course groups in `components/sidebar.tsx` |
| Tests for the pure logic | `tests/course-core.test.ts` |
| Tests for reading files and sorting a drop | `tests/course-files.test.ts` |

The free-form knowledge graph that used to be home is at `/graph` (sidebar: Knowledge graph), and a chat outside any course starts from the sidebar's "New chat".

## Models

Reading the material uses the **Cheap** slot. Organizing the course, writing the diagnostic and teaching use the **Strong** slot. Nothing runs until those are chosen.

## Limits worth knowing

- Scanned PDFs (no selectable text) and slides made of pictures can't be read; there is no OCR.
- Keynote and Pages files can't be read. Export them as PowerPoint, Word or PDF first.
- The app does not check arithmetic. Questions and their keys are written by the model. If an answer key looks wrong, it may be.
- A practice-exam session is a LearnHarness practice chat; its results do not move the meter.
- Rebuilding a map keeps the id (and so the evidence) of every concept whose name survives; a renamed concept starts untested.
