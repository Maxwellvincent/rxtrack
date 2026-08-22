import { describe, it, expect } from "vitest";
import { taskBelongsToBlock, filterTasksToBlock, clusterTasks, groupStruggleTasks } from "./struggleTasks.js";

const erLectures = [
  { id: "lec-pelvis", lectureTitle: "Pelvis and Perineum I" },
  { id: "lec-diabetes", lectureTitle: "Diabetes and Hypoglycemia" },
];

describe("taskBelongsToBlock / filterTasksToBlock", () => {
  it("matches a task whose deck-path lecture label overlaps a block lecture title", () => {
    const task = { lecture: "ER Lecture-10: Introduction to the Anatomy of the Pelvis and Perineum" };
    expect(taskBelongsToBlock(task, erLectures)).toBe(true);
  });

  it("does not match a task from an unrelated block", () => {
    const task = { lecture: "MSK Lecture 5: Rotator Cuff Anatomy" };
    expect(taskBelongsToBlock(task, erLectures)).toBe(false);
  });

  it("falls back to the deck string when there's no lecture field", () => {
    const task = { deck: "AnKing::Term 2::ER::Week 2::Diabetes and Hypoglycemia::Rand Lover's" };
    expect(taskBelongsToBlock(task, erLectures)).toBe(true);
  });

  it("filterTasksToBlock keeps only the block-matching tasks", () => {
    const tasks = [
      { id: "a", lecture: "ER Lecture-10: Introduction to the Anatomy of the Pelvis and Perineum" },
      { id: "b", lecture: "MSK Lecture 5: Rotator Cuff Anatomy" },
    ];
    expect(filterTasksToBlock(tasks, erLectures).map((t) => t.id)).toEqual(["a"]);
  });
});

describe("clusterTasks", () => {
  it("clusters by shared noteId", () => {
    const tasks = [
      { id: "1", noteId: "n1", concept: "X" },
      { id: "2", noteId: "n1", concept: "X" },
    ];
    const rows = clusterTasks(tasks);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("group");
    expect(rows[0].tasks).toHaveLength(2);
  });

  it("clusters duplicate-concept cards with NO shared noteId by concept + lecture", () => {
    const tasks = [
      { id: "1", concept: "Pelvic and perineal structure spatial relationships", lecture: "ER Lecture-10" },
      { id: "2", concept: "Pelvic and perineal structure spatial relationships", lecture: "ER Lecture-10" },
      { id: "3", concept: "Pelvic and perineal structure spatial relationships", lecture: "ER Lecture-10" },
    ];
    const rows = clusterTasks(tasks);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("group");
    expect(rows[0].tasks).toHaveLength(3);
  });

  it("does not cluster the same concept name from a different lecture", () => {
    const tasks = [
      { id: "1", concept: "Blood supply", lecture: "Lecture A" },
      { id: "2", concept: "Blood supply", lecture: "Lecture B" },
    ];
    expect(clusterTasks(tasks)).toHaveLength(2);
  });

  it("leaves a genuinely unique task as a single row", () => {
    const rows = clusterTasks([{ id: "1", concept: "Unique thing" }]);
    expect(rows).toEqual([{ kind: "single", task: { id: "1", concept: "Unique thing" } }]);
  });
});

describe("groupStruggleTasks", () => {
  const tasks = [
    { id: "1", subject: "Anatomy", state: "watch", doneLocally: false, concept: "A" },
    { id: "2", subject: "Anatomy", state: "persistent", doneLocally: false, concept: "B" },
    { id: "3", subject: "Endocrine", state: "deep", doneLocally: true, concept: "C" },
  ];

  it("hides done tasks by default", () => {
    const groups = groupStruggleTasks(tasks);
    const endo = groups.find(([subject]) => subject === "Endocrine");
    expect(endo).toBeUndefined();
  });

  it("shows done tasks when asked", () => {
    const groups = groupStruggleTasks(tasks, { showDone: true });
    expect(groups.find(([subject]) => subject === "Endocrine")).toBeTruthy();
  });

  it("sorts subjects by raw task count, worst first", () => {
    const groups = groupStruggleTasks(tasks, { showDone: true });
    expect(groups[0][0]).toBe("Anatomy"); // 2 tasks, beats Endocrine's 1
  });

  it("sorts within a subject by severity, persistent first", () => {
    const groups = groupStruggleTasks(tasks);
    const [, , rows] = groups.find(([subject]) => subject === "Anatomy");
    expect(rows[0].task.state).toBe("persistent");
  });
});
