import { test as base, expect, Browser, Page } from "@playwright/test";

export const MAX_GUESSES = 20;

export type Mode = "daily" | "practice";

export type SetOption = { name: string; code: string };

export type Answer = {
  set: SetOption;
  collectorNumber: string;
  // Names of every set holding a printing tied for the top price.
  correctSetNames: Set<string>;
};

const SET_LABEL = /^(.*) \(([A-Za-z0-9]+)\)$/;

// Practice mode picks a random card; pin Math.random so the card is the same
// in the discovery run and the real run.
async function pinRandom(page: Page) {
  await page.addInitScript(() => {
    Math.random = () => 0.5;
  });
}

async function captureClipboard(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __clipboard: string };
    w.__clipboard = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => { w.__clipboard = text; } },
    });
  });
}

export async function readShareText(page: Page): Promise<string> {
  await page.locator("#shareResultsButton").click();
  await expect(page.locator("#shareResultsButton")).toHaveText("Copied!");
  return page.evaluate(() => (window as unknown as { __clipboard: string }).__clipboard);
}

export async function startMode(page: Page, mode: Mode) {
  await page.goto("/index.html");
  await page.locator(mode === "daily" ? "#startDailyMode" : "#startPracticeMode").click();
  await expect(page.locator("#guessStatus")).toHaveText("Start typing a set name or code to guess.", {
    timeout: 90_000,
  });
}

// Types a query and returns the set suggestions the page shows for it.
export async function getSuggestions(page: Page, query: string): Promise<SetOption[]> {
  const input = page.locator("#setGuessInput");
  await input.fill("");
  await input.fill(query);
  const items = page.locator("#setAutocomplete li");
  await items.first().waitFor();
  const labels = (await items.allTextContents()).map(text => text.trim());
  return labels.flatMap(label => {
    const match = SET_LABEL.exec(label);
    return match ? [{ name: match[1], code: match[2].toLowerCase() }] : [];
  });
}

async function findSet(page: Page, name: string): Promise<SetOption> {
  const found = (await getSuggestions(page, name)).find(set => set.name === name);
  if (!found) {
    throw new Error(`Set "${name}" not offered by autocomplete`);
  }
  return found;
}

// Plays a throwaway game and gives up so the page reveals today's answer.
export async function discoverAnswer(browser: Browser, mode: Mode): Promise<Answer> {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await pinRandom(page);
    await startMode(page, mode);
    await page.locator("#giveUpButton").click();
    await expect(page.locator("#guessStatus")).toContainText("You gave up.");

    const captions = (await page.locator(".all-printing-caption").allTextContents()).map(c => c.trim());
    const parsed = captions.map(caption => {
      const [head, ...rest] = caption.split(" • ");
      const match = /^(.*) #(\S+)$/.exec(head);
      return { setName: match?.[1] ?? head, number: match?.[2] ?? "", price: rest.join(" • ") };
    });
    // Printings are listed highest price first.
    const top = parsed[0];
    const correctSetNames = new Set(parsed.filter(p => p.price === top.price).map(p => p.setName));
    // The input is disabled once the game is over, so look the set up in a fresh game.
    const lookupContext = await browser.newContext();
    try {
      const lookupPage = await lookupContext.newPage();
      await pinRandom(lookupPage);
      await startMode(lookupPage, mode);
      const set = await findSet(lookupPage, top.setName);
      return { set, collectorNumber: top.number, correctSetNames };
    } finally {
      await lookupContext.close();
    }
  } finally {
    await context.close();
  }
}

const answers = new Map<Mode, Promise<Answer>>();
export function getAnswer(browser: Browser, mode: Mode): Promise<Answer> {
  let answer = answers.get(mode);
  if (!answer) {
    answer = discoverAnswer(browser, mode);
    answers.set(mode, answer);
  }
  return answer;
}

// Collects set options from the page's autocomplete, skipping correct sets.
export async function getWrongSets(page: Page, answer: Answer, count: number): Promise<SetOption[]> {
  const wrong = new Map<string, SetOption>();
  for (const query of "aeoiurnstlmdcgphbvkw".split("")) {
    for (const set of await getSuggestions(page, query)) {
      if (!answer.correctSetNames.has(set.name)) {
        wrong.set(set.code, set);
      }
    }
    if (wrong.size >= count) {
      break;
    }
  }
  expect(wrong.size).toBeGreaterThanOrEqual(count);
  await page.locator("#setGuessInput").fill("");
  return [...wrong.values()].slice(0, count);
}

// Guesses a set via the page. When the page asks for a version, picks the
// given collector number or the first option.
export async function guessSet(page: Page, set: SetOption, collectorNumber?: string) {
  const rows = page.locator("#resultsGrid .result-item");
  const before = await rows.count();
  const suggestions = await getSuggestions(page, set.name);
  expect(suggestions.map(s => s.code)).toContain(set.code);
  await page.locator("#setAutocomplete li").filter({ hasText: `(${set.code.toUpperCase()})` }).first().click();
  await page.locator("#setGuessButton").click();

  const modal = page.locator("#versionPickerModal");
  await page.waitForFunction(
    ({ before }) =>
      !document.getElementById("versionPickerModal")!.classList.contains("hidden") ||
      document.querySelectorAll("#resultsGrid .result-item").length > before,
    { before },
  );
  if (await modal.isVisible()) {
    const options = page.locator(".version-option");
    const option = collectorNumber
      ? options.filter({ has: page.locator(".version-option-caption", { hasText: new RegExp(`^#${collectorNumber}( |$)`) }) }).first()
      : options.first();
    await option.click();
  }
  await expect(rows).toHaveCount(before + 1);
}

export const test = base.extend({
  page: async ({ page }, use) => {
    await pinRandom(page);
    await captureClipboard(page);
    await use(page);
  },
});

export { expect };
