import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ObjectiveProgressChart } from "./ObjectiveProgressChart.jsx";
it("shows measured accuracy without labeling it mastery and prioritizes weak objectives", () => {
  const html = renderToStaticMarkup(<ObjectiveProgressChart rows={[
    { id: "ready", text: "Established objective", attempts: 4, correct: 4, ready: true, targetOrder: "third-order" },
    { id: "weak", text: "Weak objective", attempts: 4, correct: 1, state: "struggling", targetOrder: "second-order" },
    { id: "new", text: "New objective", attempts: 0, correct: 0, targetOrder: "second-order" },
  ]} />);
  expect(html).toContain("25% correct, 1 of 4 questions");
  expect(html).toContain("Not yet tested");
  expect(html.indexOf("Weak objective")).toBeLessThan(html.indexOf("Established objective"));
  expect(html).not.toContain("Mastered");
});
