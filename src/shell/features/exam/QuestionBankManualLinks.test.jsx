// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let saved = null;
const bank = { "Week 15 NB NSCI": [
  { id: "q3", num: 3, stem: "Which pathway underlies extinction memory?", correct: "A", choices: { A: "vmPFC to amygdala" }, curriculumMappingReview: { decision: "unresolved", reason: "Objective catalog was empty" } },
  { id: "q5", num: 5, stem: "Already linked item", correct: "A", choices: { A: "x" }, lectureId: "nb61", lectureLabel: "LEC 61 · NB 61 Sleep", curriculumLinkStatus: "evidence-verified", objectiveIds: ["o61"] },
] };
vi.mock("../../../stores/questionBanks.js", () => ({ read: () => bank, writeAwait: async (_user, value) => { saved = value; } }));
const { QuestionBankManualLinks } = await import("./QuestionBankManualLinks.jsx");
const lectures = [{ id: "nb55", blockId: "b", lectureNumber: 55, lectureType: "LEC", lectureTitle: "NB 55 Emotions" }, { id: "nb61", blockId: "b", lectureNumber: 61, lectureType: "LEC", lectureTitle: "NB 61 Sleep" }];
const objectives = [{ id: "o55", linkedLecId: "nb55", code: "NSCI.0293", objective: "Fear and extinction circuitry" }];

it("lists unresolved questions with their reason and saves a lecture + objective link", async () => {
  const host = document.createElement("div"), root = createRoot(host);
  await act(async () => root.render(<QuestionBankManualLinks userId="u" blockId="b" filename="Week 15 NB NSCI" questions={bank["Week 15 NB NSCI"]} lectures={lectures} objectives={objectives} />));
  expect(host.textContent).toContain("1 not linked");
  expect(host.textContent).toContain("◇ Unresolved: Objective catalog was empty");
  expect(host.textContent).not.toContain("Already linked item");
  const select = host.querySelector("select");
  await act(async () => { select.value = "nb55"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  const box = host.querySelector('input[type="checkbox"]:not(:first-child)') || [...host.querySelectorAll('input[type="checkbox"]')].at(-1);
  await act(async () => { box.click(); });
  const button = [...host.querySelectorAll("button")].find(b => b.textContent === "Save link");
  await act(async () => { button.click(); });
  expect(saved["Week 15 NB NSCI"][0]).toMatchObject({ lectureId: "nb55", lectureLinkBasis: "user-assigned", curriculumLinkStatus: "user-confirmed", objectiveIds: ["o55"] });
  expect(saved["Week 15 NB NSCI"][1].lectureId).toBe("nb61");
  root.unmount();
});

it("links unlinked questions under the same heading after you assign one", async () => {
  bank["Week 15 NB BEHS"] = [
    { id: "d1", num: 1, stem: "Depersonalization episodes. Diagnosis?", correct: "A", choices: { A: "x" }, sourceSectionTitle: "Dissociative Disorders" },
    { id: "d2", num: 2, stem: "Dissociative amnesia after trauma. Diagnosis?", correct: "A", choices: { A: "x" }, sourceSectionTitle: "Dissociative Disorders" },
  ];
  const lectures58 = [...lectures, { id: "nb58", blockId: "b", lectureNumber: 58, lectureType: "LEC", lectureTitle: "NB 58 Trauma and Dissociative Disorders" }];
  const host = document.createElement("div"), root = createRoot(host);
  await act(async () => root.render(<QuestionBankManualLinks userId="u" blockId="b" filename="Week 15 NB BEHS" questions={bank["Week 15 NB BEHS"]} lectures={lectures58} objectives={objectives} blockBankFilenames={["Week 15 NB BEHS", "Week 15 NB NSCI"]} />));
  const select = host.querySelector("select");
  await act(async () => { select.value = "nb58"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => { [...host.querySelectorAll("button")].find(b => b.textContent === "Save link").click(); });
  expect(saved["Week 15 NB BEHS"][1]).toMatchObject({ lectureId: "nb58", lectureLinkBasis: "learned-heading", curriculumLinkStatus: "user-lecture-only" });
  expect(host.textContent).toMatch(/Also linked 1 unlinked question under “Dissociative Disorders”/);
  root.unmount();
});
