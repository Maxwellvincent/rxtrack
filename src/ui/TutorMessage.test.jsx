import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { installDomStorage } from "../stores/testEnv.js";
import { TutorMessage } from "./TutorMessage.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
it("keeps teaching and one follow-up visible while diagnostic notes and cards start collapsed", () => {
  installDomStorage();
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(<TutorMessage turn={{ feedback: "Your localization is correct. Now connect it to function.", followUp: "What changes downstream?", assessment: "partial", firstDivergence: "A connection is missing.", preservedReasoning: ["Localization"], missTypes: ["content"], ankiRecommendation: { front: "Gap?", back: "Bridge." } }} />));
  expect(host.querySelector(".desk-tutor-bubble__label").textContent).toBe("Tutor");
  expect(host.querySelector(".desk-tutor-bubble__question").textContent).toBe("What changes downstream?");
  expect([...host.querySelectorAll("details")].every(details => !details.open)).toBe(true);
  expect(host.querySelector("details").textContent).toContain("Connection to strengthen");
  act(() => root.unmount());
});
