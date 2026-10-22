import { test as base, expect, Page } from "@playwright/test";

export const CARD_NAME = "Mock Card";
export const ANSWER_SET = { code: "ans", name: "Mock Omega Edition" };

const GREEK = [
  "Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta", "Iota", "Kappa",
  "Lambda", "Mu", "Nu", "Xi", "Omicron", "Pi", "Rho", "Sigma", "Tau", "Upsilon",
  "Phi", "Chi", "Psi", "Digamma",
];

// 24 wrong sets (more than the 20 allowed guesses) + 1 correct set.
export const WRONG_SETS = GREEK.map((word, i) => ({
  code: `w${String(i + 1).padStart(2, "0")}`,
  name: `Mock ${word} Edition`,
  uniqueWord: word,
}));

const ALL_SETS = [...WRONG_SETS, { ...ANSWER_SET, uniqueWord: "Omega" }];

function setPayload() {
  return {
    object: "list",
    has_more: false,
    data: ALL_SETS.map(set => ({
      code: set.code,
      name: set.name,
      set_type: "expansion",
      released_at: "2015-01-01",
    })),
  };
}

function cardFor(set: { code: string; name: string }, price: string) {
  return {
    id: `id-${set.code}`,
    name: CARD_NAME,
    mana_cost: "{1}{U}",
    type_line: "Creature — Test",
    oracle_text: "Mock oracle text.",
    power: "1",
    toughness: "1",
    set: set.code,
    set_name: set.name,
    collector_number: "1",
    released_at: set.code === ANSWER_SET.code ? "2020-01-01" : "2015-01-01",
    prices: { usd: price, usd_foil: null, usd_etched: null },
    border_color: "black",
    finishes: ["nonfoil"],
  };
}

export async function mockExternalRequests(page: Page) {
  await page.route("**/formatted_card_list.json", route =>
    route.fulfill({ json: [CARD_NAME] }));
  await page.route("https://api.scryfall.com/**", route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/sets") {
      return route.fulfill({ json: setPayload() });
    }
    if (url.pathname === "/cards/search") {
      return route.fulfill({
        json: {
          object: "list",
          has_more: false,
          data: [
            ...WRONG_SETS.map(set => cardFor(set, "1.00")),
            cardFor(ANSWER_SET, "100.00"),
          ],
        },
      });
    }
    if (url.pathname === "/cards/named") {
      return route.fulfill({ json: cardFor(ANSWER_SET, "100.00") });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.route(/^https:\/\/(svgs|cards)\.scryfall\.io\/.*/, route =>
    route.fulfill({ status: 200, contentType: "image/svg+xml", body: "<svg xmlns='http://www.w3.org/2000/svg'/>" }));
}

export async function captureClipboard(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __clipboard: string }).__clipboard = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as unknown as { __clipboard: string }).__clipboard = text;
        },
      },
    });
  });
}

export async function readShareText(page: Page): Promise<string> {
  await page.locator("#shareResultsButton").click();
  await expect(page.locator("#shareResultsButton")).toHaveText("Copied!");
  return page.evaluate(() => (window as unknown as { __clipboard: string }).__clipboard);
}

export async function startMode(page: Page, mode: "daily" | "practice") {
  await page.goto("/index.html");
  await page.locator(mode === "daily" ? "#startDailyMode" : "#startPracticeMode").click();
  await expect(page.locator("#guessStatus")).toHaveText("Start typing a set name or code to guess.");
}

export async function guessSet(page: Page, query: string) {
  await page.locator("#setGuessInput").fill(query);
  await page.locator("#setAutocomplete li").first().waitFor();
  await page.locator("#setGuessButton").click();
}

export const test = base.extend({
  page: async ({ page }, use) => {
    await mockExternalRequests(page);
    await captureClipboard(page);
    await use(page);
  },
});

export { expect };
