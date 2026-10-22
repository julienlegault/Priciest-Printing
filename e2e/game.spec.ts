import { ANSWER_SET, WRONG_SETS, expect, guessSet, readShareText, startMode, test } from "./fixtures";

test("daily run: 5 incorrect guesses then correct, share reflects the guesses", async ({ page }) => {
  await startMode(page, "daily");
  for (const set of WRONG_SETS.slice(0, 5)) {
    await guessSet(page, set.code);
    await expect(page.locator("#guessStatus")).toContainText("was not the highest-price printing.");
  }
  await expect(page.locator("#shareResultsButton")).toBeHidden();
  await guessSet(page, ANSWER_SET.code);
  await expect(page.locator("#guessStatus")).toContainText("Correct!");
  await expect(page.locator("#shareResultsButton")).toBeVisible();

  const lines = (await readShareText(page)).split("\n");
  expect(lines[0]).toBe("Priciest Printing 6/20");
  const emojis = Array.from(lines[1]);
  expect(emojis).toHaveLength(6);
  expect(emojis.slice(0, 5)).not.toContain("🟩");
  expect(emojis[5]).toBe("🟩");
  expect(lines.join("\n")).not.toContain("gave up");
  expect(lines.join("\n")).not.toContain("ran out");
});

test("practice run completes and does not allow sharing results", async ({ page }) => {
  await startMode(page, "practice");
  await guessSet(page, WRONG_SETS[0].code);
  await guessSet(page, ANSWER_SET.code);
  await expect(page.locator("#guessStatus")).toContainText("Correct!");
  await expect(page.locator("#postWinActions")).toBeVisible();
  await expect(page.locator("#homeButton")).toBeVisible();
  await expect(page.locator("#shareResultsButton")).toBeHidden();
});

test.describe("set autocomplete", () => {
  for (const mode of ["daily", "practice"] as const) {
    test(`${mode}: set code and unique set-name word show the set`, async ({ page }) => {
      await startMode(page, mode);
      const target = WRONG_SETS[9];

      // The word must appear in no other set name.
      const allNames = [...WRONG_SETS.map(s => s.name), ANSWER_SET.name];
      expect(allNames.filter(n => n.split(" ").includes(target.uniqueWord))).toEqual([target.name]);

      const input = page.locator("#setGuessInput");
      const items = page.locator("#setAutocomplete li");

      await input.fill(target.code);
      await expect(items.first()).toContainText(target.name);

      await input.fill("");
      await input.fill(target.uniqueWord);
      await expect(items.first()).toContainText(target.name);
    });
  }
});

test("daily run: giving up shows gave up text in share results", async ({ page }) => {
  await startMode(page, "daily");
  await guessSet(page, WRONG_SETS[0].code);
  await page.locator("#giveUpButton").click();
  await expect(page.locator("#guessStatus")).toContainText("You gave up.");

  const text = await readShareText(page);
  expect(text).toContain("Priciest Printing X/20");
  expect(text).toContain("I gave up after 1 tries");
});

test("daily run: running out of guesses shows ran out text in share results", async ({ page }) => {
  await startMode(page, "daily");
  for (const set of WRONG_SETS.slice(0, 20)) {
    await guessSet(page, set.code);
  }
  await expect(page.locator("#guessStatus")).toContainText("Out of guesses.");

  const text = await readShareText(page);
  expect(text).toContain("Priciest Printing X/20");
  expect(text).toContain("I ran out of guesses!");
});
