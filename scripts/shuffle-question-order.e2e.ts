// Shuffling selected Working Copy questions from the keyboard-operable context
// menu. Store tests cover the pure ordering rule; this check proves the menu
// uses its selected scope and remains reachable without a pointer.

import { expect, test } from "@playwright/test";
import { seedAuthoringState } from "./seed-authoring";

function question(id: string, type: "multiple-choice" | "open") {
  return {
    id,
    type,
    columns: 1 as const,
    doc:
      type === "multiple-choice"
        ? {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: `Question ${id}` }],
              },
              {
                type: "multipleChoice",
                content: ["a", "b"].map((choice) => ({
                  type: "multipleChoiceChoice",
                  attrs: { correct: false, id: `${id}-${choice}` },
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: choice }],
                    },
                  ],
                })),
              },
            ],
          }
        : {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: `Question ${id}` }],
              },
            ],
          },
  };
}

async function seedQuestions(page: Parameters<typeof seedAuthoringState>[0]) {
  const multipleChoice = ["m1", "m2", "m3"].map((id) =>
    question(id, "multiple-choice"),
  );
  const shortAnswer = ["o1", "o2", "o3"].map((id) => question(id, "open"));
  await seedAuthoringState(page, {
    questionBank: { questions: [...multipleChoice, ...shortAnswer] },
    workingCopy: {
      title: "Shuffle scope",
      questionIds: [...multipleChoice, ...shortAnswer].map(({ id }) => id),
    },
    dirty: false,
  });
  await page.reload();
}

const questionIds = (page: Parameters<typeof seedQuestions>[0]) =>
  page.locator('.exam-question[data-question-id]').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-question-id')),
  )

test("keyboard Shuffle question order varies only the selected questions in each section and undoes once", async ({
  page,
}) => {
  await seedQuestions(page);
  const questions = page.locator(".exam-question");
  await expect(questions).toHaveCount(6);

  // The two selected positions in each section are the only positions Shuffle
  // may change. The middle question in each section must remain fixed.
  for (const index of [0, 2, 3, 5]) {
    await questions
      .nth(index)
      .click({ modifiers: index === 0 ? [] : ["Control"] });
  }
  await expect(page.locator(".exam-question--selected")).toHaveCount(4);

  const actions = page.getByRole("button", { name: "Actions for question 1" });
  await actions.focus();
  await actions.press("Enter");
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  const shuffle = page.getByRole("menuitem", {
    name: "Shuffle question order",
  });
  await expect(shuffle).toBeFocused();
  await shuffle.press("Enter");

  const shuffled = await questionIds(page);
  expect(shuffled.slice(0, 3)).toEqual(["m3", "m2", "m1"]);
  expect(shuffled.slice(3)).toEqual(["o3", "o2", "o1"]);
  await expect(page.getByRole("status")).toHaveText("Shuffled question order.");

  await page.getByRole("button", { name: "Undo" }).click();
  await expect
    .poll(() => questionIds(page))
    .toEqual(["m1", "m2", "m3", "o1", "o2", "o3"]);
});

test("opening a menu from an unselected question makes it the sole Shuffle scope", async ({
  page,
}) => {
  await seedQuestions(page);
  const questions = page.locator(".exam-question");
  await questions.nth(0).click();
  await expect(page.locator(".exam-question--selected")).toHaveCount(1);

  await page.getByRole("button", { name: "Actions for question 2" }).click();
  await expect(page.locator(".exam-question--selected")).toHaveCount(1);
  await expect(questions.nth(1)).toHaveClass(/exam-question--selected/);
  await page.getByRole("menuitem", { name: "Shuffle question order" }).click();

  // One selected question is not eligible, so the menu's new one-question
  // scope leaves every question exactly where it was.
  await expect
    .poll(() => questionIds(page))
    .toEqual(["m1", "m2", "m3", "o1", "o2", "o3"]);
});
