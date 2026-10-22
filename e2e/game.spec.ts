import { MAX_GUESSES, expect, getAnswer, getSuggestions, getWrongSets, guessSet, readShareText, startMode, test } from "./fixtures";

test.setTimeout(240_000);

test("daily run: 5 incorrect guesses then correct, share reflects the guesses", async ({ page, browser }) => {
  const answer = await getAnswer(browser, "daily");
  await startMode(page, "daily");
  const wrong = await getWrongSets(page, answer, 5);
  for (const set of wrong) {
    await guessSet(page, set);
    await expect(page.locator("#guessStatus")).toContainText("was not the highest-price printing.");
  }
  await expect(page.locator("#shareResultsButton")).toBeHidden();
  await guessSet(page, answer.set, answer.collectorNumber);
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

test("practice run completes and does not allow sharing results", async ({ page, browser }) => {
  const answer = await getAnswer(browser, "practice");
  await startMode(page, "practice");
  const [wrong] = await getWrongSets(page, answer, 1);
  await guessSet(page, wrong);
  await guessSet(page, answer.set, answer.collectorNumber);
  await expect(page.locator("#guessStatus")).toContainText("Correct!");
  await expect(page.locator("#postWinActions")).toBeVisible();
  await expect(page.locator("#homeButton")).toBeVisible();
  await expect(page.locator("#shareResultsButton")).toBeHidden();
});

test.describe("set autocomplete", () => {
  for (const mode of ["daily", "practice"] as const) {
    test(`${mode}: set code and unique set-name word show the set`, async ({ page }) => {
      await startMode(page, mode);

      // Same set list the page loads.
      const payload = await page.evaluate(async () =>
        (await fetch("https://api.scryfall.com/sets")).json()) as {
        data: Array<{ code: string; name: string; set_type: string }>;
      };
      const sets = payload.data.filter(s => s.set_type !== "memorabilia");

      const wordCounts = new Map<string, number>();
      for (const set of sets) {
        for (const word of new Set(set.name.toLowerCase().split(/[^a-z]+/).filter(Boolean))) {
          wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1);
        }
      }
      // A word that is in exactly one set name and is not a fragment of any other.
      const allNames = sets.map(s => s.name.toLowerCase());
      const target = sets.find(set =>
        set.name.toLowerCase().split(/[^a-z]+/).some(word =>
          word.length >= 6 && wordCounts.get(word) === 1 && allNames.filter(n => n.includes(word)).length === 1));
      expect(target).toBeTruthy();
      const uniqueWord = target!.name.toLowerCase().split(/[^a-z]+/).find(word =>
        word.length >= 6 && wordCounts.get(word) === 1 && allNames.filter(n => n.includes(word)).length === 1)!;

      const byCode = await getSuggestions(page, target!.code);
      expect(byCode.map(s => s.name)).toContain(target!.name);

      const byWord = await getSuggestions(page, uniqueWord);
      expect(byWord[0]).toEqual({ name: target!.name, code: target!.code });
    });
  }
});

test("daily run: giving up shows gave up text in share results", async ({ page, browser }) => {
  const answer = await getAnswer(browser, "daily");
  await startMode(page, "daily");
  const [wrong] = await getWrongSets(page, answer, 1);
  await guessSet(page, wrong);
  await page.locator("#giveUpButton").click();
  await expect(page.locator("#guessStatus")).toContainText("You gave up.");

  const text = await readShareText(page);
  expect(text).toContain("Priciest Printing X/20");
  expect(text).toContain("I gave up after 1 tries");
});

test("daily run: running out of guesses shows ran out text in share results", async ({ page, browser }) => {
  const answer = await getAnswer(browser, "daily");
  await startMode(page, "daily");
  for (const set of await getWrongSets(page, answer, MAX_GUESSES)) {
    await guessSet(page, set);
  }
  await expect(page.locator("#guessStatus")).toContainText("Out of guesses.");

  const text = await readShareText(page);
  expect(text).toContain("Priciest Printing X/20");
  expect(text).toContain("I ran out of guesses!");
});
