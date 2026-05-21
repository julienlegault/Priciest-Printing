export {};

type CardListItem = string;
type GameMode = "daily" | "practice";
type PrintingStyle = "regular" | "borderless" | "extendedart";

type SetInfo = {
  code: string;
  name: string;
  iconSvgUri: string | null;
  releaseDate: string | null;
  releaseYear: number | null;
};

type Finish = "nonfoil" | "foil";

type PrintingInfo = {
  id: string;
  setCode: string;
  setName: string;
  imageUrl: string | null;
  collectorNumber: string;
  releaseDate: string | null;
  releaseYear: number | null;
  prices: Record<Finish, number | null>;
  style: PrintingStyle;
  modifiers: string[];
};

type ScryfallCard = {
  id: string;
  name: string;
  mana_cost?: string;
  type_line: string;
  oracle_text?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
  set: string;
  set_name: string;
  collector_number: string;
  released_at?: string;
  prices: {
    usd: string | null;
    usd_foil: string | null;
    usd_etched: string | null;
  };
  image_uris?: {
    normal?: string;
  };
  card_faces?: Array<{
    image_uris?: {
      normal?: string;
    };
    oracle_text?: string;
    mana_cost?: string;
    type_line?: string;
    power?: string;
    toughness?: string;
    loyalty?: string;
    defense?: string;
  }>;
  frame_effects?: string[];
  border_color?: string;
  finishes?: string[];
  full_art?: boolean;
  textless?: boolean;
  promo?: boolean;
  promo_types?: string[];
};

type ScryfallList<T> = {
  data: T[];
  has_more: boolean;
  next_page?: string;
};

type DailyPlayRecord = {
  shareRows: string[];
  cardName?: string;
  priceText?: string;
  imageUrl?: string;
  hardMode?: boolean;
};

type DailyPlayStore = Record<string, DailyPlayRecord>;

const setGuessInput = document.getElementById("setGuessInput") as HTMLInputElement;
const finishGuessInput = document.getElementById("finishGuessInput") as HTMLSelectElement;
const styleGuessInput = document.getElementById("styleGuessInput") as HTMLSelectElement;
const setGuessButton = document.getElementById("setGuessButton") as HTMLButtonElement;
const setAutocomplete = document.getElementById("setAutocomplete") as HTMLUListElement;
const cardFrame = document.getElementById("cardFrame") as HTMLElement;
const setTimeline = document.getElementById("setTimeline") as HTMLElement;
const resultsGrid = document.getElementById("resultsGrid") as HTMLElement;
const guessStatus = document.getElementById("guessStatus") as HTMLElement;
const modeLanding = document.getElementById("modeLanding") as HTMLElement;
const gameArea = document.getElementById("gameArea") as HTMLElement;
const startDailyMode = document.getElementById("startDailyMode") as HTMLButtonElement;
const startPracticeMode = document.getElementById("startPracticeMode") as HTMLButtonElement;
const hardModeInput = document.getElementById("hardModeInput") as HTMLInputElement;
const winModal = document.getElementById("winModal") as HTMLElement;
const closeWinModal = document.getElementById("closeWinModal") as HTMLButtonElement;
const shareResultsButton = document.getElementById("shareResultsButton") as HTMLButtonElement;
const winMessage = document.getElementById("winMessage") as HTMLElement;
const winCardImage = document.getElementById("winCardImage") as HTMLImageElement;
const versionPickerModal = document.getElementById("versionPickerModal") as HTMLElement;
const closeVersionPickerModal = document.getElementById("closeVersionPickerModal") as HTMLButtonElement;
const versionPickerTitle = document.getElementById("versionPickerTitle") as HTMLElement;
const versionPickerGrid = document.getElementById("versionPickerGrid") as HTMLElement;

let allSets: SetInfo[] = [];
let selectedCardName = "";
let selectedCard: ScryfallCard | null = null;
let printingsBySet = new Map<string, PrintingInfo[]>();
let correctPrinting: PrintingInfo | null = null;
let correctFinish: Finish = "nonfoil";
let correctAnswerKeys = new Set<string>();
let correctSetCodes = new Set<string>();
let guessedPrintingKeys = new Set<string>();
let lastSetQuery = "";
let lastSetResults: SetInfo[] = [];
let shareRows: string[] = [];
let currentMode: GameMode = "practice";
let currentHardMode = false;
let timelineSetIndexByCode = new Map<string, number>();

(function initTimelineDragScroll() {
  let isDragging = false;
  let dragStartX = 0;
  let scrollStartLeft = 0;

  setTimeline.addEventListener("mousedown", (e: MouseEvent) => {
    if (e.button !== 0) return;
    isDragging = true;
    dragStartX = e.clientX;
    scrollStartLeft = setTimeline.scrollLeft;
    setTimeline.classList.add("dragging");
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e: MouseEvent) => {
    if (!isDragging) return;
    const delta = e.clientX - dragStartX;
    setTimeline.scrollLeft = scrollStartLeft - delta;
  });

  const stopDragging = () => {
    if (!isDragging) return;
    isDragging = false;
    setTimeline.classList.remove("dragging");
  };

  window.addEventListener("mouseup", stopDragging);
  window.addEventListener("mouseleave", stopDragging);
})();

const RNG_MULTIPLIER = 9301;
const RNG_INCREMENT = 49297;
const RNG_MODULUS = 233280;

const PRICE_COLOR_CLOSE = { r: 46, g: 204, b: 113 };
const PRICE_COLOR_FAR = { r: 231, g: 76, b: 60 };
const PRICE_COLOR_NO_DATA = "rgb(140, 65, 65)";
const PRICE_DIFF_THRESHOLD = 0.5;
const NO_PRINTING_TEXT = "No printing";
const SHARE_URL = "https://julienlegault.github.io/tempmagicdaily/printings/";
const DAILY_PLAY_STORAGE_KEY = "tempmagicdaily-printings-daily-plays";
const DAILY_PLAY_RETENTION_DAYS = 30;
const NORMAL_ORACLE_CLUE_GUESS_COUNT = 3;
const HARD_MODE_ORACLE_CLUE_GUESS_COUNT = 8;
const MINIMUM_WINNING_PRINTING_PRICE = 8;

function seededRandom(seed: number) {
  return () => {
    seed = (seed * RNG_MULTIPLIER + RNG_INCREMENT) % RNG_MODULUS;
    return seed / RNG_MODULUS;
  };
}

function getUtcDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

// Returns the date key for the current "day", where each day resets at 1 AM EST
// (fixed UTC-5 offset; 1 AM EST = 6 AM UTC). DST is intentionally ignored.
function getEstResetDateKey(): string {
  const EST_RESET_OFFSET_MS = 6 * 60 * 60 * 1000; // 1 AM EST (UTC-5) = 6 AM UTC
  return getUtcDateKey(new Date(Date.now() - EST_RESET_OFFSET_MS));
}

function getDailyIndex(max: number) {
  const today = getEstResetDateKey();
  let seed = 0;
  for (const c of today) {
    seed += c.charCodeAt(0);
  }
  const rand = seededRandom(seed);
  return Math.floor(rand() * max);
}

function getTodayKey() {
  return getEstResetDateKey();
}

function getDailyRecordKey(dateKey: string, hardMode: boolean): string {
  return hardMode ? `${dateKey}|hard` : dateKey;
}

function loadDailyPlayStore(): DailyPlayStore {
  try {
    const raw = localStorage.getItem(DAILY_PLAY_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    const store: DailyPlayStore = {};
    for (const [date, value] of Object.entries(parsed)) {
      if (typeof date !== "string" || !value || typeof value !== "object") {
        continue;
      }
      const rows = (value as { shareRows?: unknown }).shareRows;
      if (!Array.isArray(rows)) {
        continue;
      }
      const shareRows = rows.filter((row): row is string => typeof row === "string");
      const cardName = (value as { cardName?: unknown }).cardName;
      const priceText = (value as { priceText?: unknown }).priceText;
      const imageUrl = (value as { imageUrl?: unknown }).imageUrl;
      const hardMode = (value as { hardMode?: unknown }).hardMode;
      store[date] = {
        shareRows,
        cardName: typeof cardName === "string" ? cardName : undefined,
        priceText: typeof priceText === "string" ? priceText : undefined,
        imageUrl: typeof imageUrl === "string" ? imageUrl : undefined,
        hardMode: typeof hardMode === "boolean" ? hardMode : undefined,
      };
    }
    return store;
  } catch (error) {
    console.error("Failed to parse daily play store:", error);
    return {};
  }
}

function persistDailyPlayStore(store: DailyPlayStore) {
  try {
    localStorage.setItem(DAILY_PLAY_STORAGE_KEY, JSON.stringify(store));
  } catch (error) {
    console.error("Failed to persist daily play store:", error);
  }
}

function pruneDailyPlayStore(store: DailyPlayStore): DailyPlayStore {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayMs = today.getTime();

  const entries = Object.entries(store).filter(([date]) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:\|hard)?$/.exec(date);
    if (!match) {
      return false;
    }

    const [, year, month, day] = match;
    const entryMs = Date.UTC(Number(year), Number(month) - 1, Number(day));
    const ageDays = Math.floor((todayMs - entryMs) / 86400000);
    return ageDays >= 0 && ageDays < DAILY_PLAY_RETENTION_DAYS;
  });
  return Object.fromEntries(entries);
}

function getDailyPlayRecord(dateKey: string): DailyPlayRecord | null {
  const store = loadDailyPlayStore();
  const prunedStore = pruneDailyPlayStore(store);
  if (Object.keys(prunedStore).length !== Object.keys(store).length) {
    persistDailyPlayStore(prunedStore);
  }
  return prunedStore[dateKey] ?? prunedStore[`${dateKey}|hard`] ?? null;
}

function saveDailyPlayRecord(
  dateKey: string,
  shareRowsForDay: string[],
  cardName: string,
  priceText: string,
  imageUrl: string | null,
  hardMode: boolean,
) {
  const prunedStore = pruneDailyPlayStore(loadDailyPlayStore());
  prunedStore[dateKey] = {
    shareRows: [...shareRowsForDay],
    cardName,
    priceText,
    imageUrl: imageUrl ?? undefined,
    hardMode,
  };
  persistDailyPlayStore(prunedStore);
}

function getPracticeIndex(max: number) {
  return Math.floor(Math.random() * max);
}

function getCardIndex(max: number, mode: GameMode) {
  return mode === "daily" ? getDailyIndex(max) : getPracticeIndex(max);
}

function getCardCandidates(cards: CardListItem[], mode: GameMode): CardListItem[] {
  if (!cards.length) {
    return [];
  }
  const startIndex = getCardIndex(cards.length, mode);
  return [...cards.slice(startIndex), ...cards.slice(0, startIndex)];
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

function parsePrice(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseReleaseYear(value: string | undefined | null): number | null {
  if (!value || value.length < 4) {
    return null;
  }
  const year = Number.parseInt(value.slice(0, 4), 10);
  return Number.isFinite(year) ? year : null;
}

function maxPrice(...values: Array<number | null>): number | null {
  const numbers = values.filter((value): value is number => value !== null);
  return numbers.length ? Math.max(...numbers) : null;
}

function getPrintingPrice(printing: PrintingInfo | null, finish: Finish): number | null {
  if (!printing) {
    return null;
  }
  return printing.prices[finish];
}

function formatFinish(finish: Finish): string {
  return finish === "foil" ? "Foil" : "Non-foil";
}

function getSelectedFinish(): Finish {
  const finish = finishGuessInput.value;
  return finish === "foil" || finish === "nonfoil" ? finish : "nonfoil";
}

function getSelectedStyle(): PrintingStyle {
  const style = styleGuessInput.value;
  return style === "regular" || style === "borderless" || style === "extendedart" ? style : "regular";
}

function updateStyleGuessVisibility() {
  const shouldShow = currentHardMode;
  styleGuessInput.classList.toggle("hidden", !shouldShow);
  styleGuessInput.disabled = !shouldShow;
}

function getStyleLabel(style: PrintingStyle): string {
  if (style === "borderless") return "Borderless";
  if (style === "extendedart") return "Extended Art";
  return "Regular";
}

function getPrintingStyle(card: ScryfallCard): PrintingStyle {
  if (card.frame_effects?.includes("extendedart")) {
    return "extendedart";
  }
  if (card.border_color === "borderless") {
    return "borderless";
  }
  return "regular";
}

function getCardImage(card: ScryfallCard): string | null {
  return card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal ?? null;
}

function getCardOracle(card: ScryfallCard): string {
  if (card.oracle_text) {
    return card.oracle_text;
  }
  if (!card.card_faces?.length) {
    return "";
  }
  return card.card_faces
    .map(face => face.oracle_text ?? "")
    .filter(Boolean)
    .join("\n\n");
}

function getCardManaCost(card: ScryfallCard): string {
  if (card.mana_cost) {
    return card.mana_cost;
  }
  return card.card_faces?.map(face => face.mana_cost ?? "").filter(Boolean).join(" // ") ?? "";
}

function getCardTypeLine(card: ScryfallCard): string {
  if (card.type_line) {
    return card.type_line;
  }
  return card.card_faces?.map(face => face.type_line ?? "").filter(Boolean).join(" // ") ?? "";
}

function getCardStats(card: ScryfallCard): string {
  const power = card.power ?? card.card_faces?.[0]?.power;
  const toughness = card.toughness ?? card.card_faces?.[0]?.toughness;
  const loyalty = card.loyalty ?? card.card_faces?.[0]?.loyalty;
  const defense = card.defense ?? card.card_faces?.[0]?.defense;

  if (power && toughness) {
    return `${power}/${toughness}`;
  }
  if (loyalty) {
    return `Loyalty: ${loyalty}`;
  }
  if (defense) {
    return `Defense: ${defense}`;
  }
  return "";
}

function renderWithSymbols(text: string, container: HTMLElement): void {
  const parts = text.split(/(\{[^}]+\})/g);
  for (const part of parts) {
    const match = part.match(/^\{([^}]+)\}$/);
    if (match) {
      const symbol = match[1].toUpperCase();
      const img = document.createElement("img");
      img.src = `https://svgs.scryfall.io/card-symbols/${symbol}.svg`;
      img.alt = `{${symbol}}`;
      img.className = "card-symbol";
      img.onerror = () => {
        img.replaceWith(document.createTextNode(part));
      };
      container.appendChild(img);
    } else {
      container.appendChild(document.createTextNode(part));
    }
  }
}

function renderCardFrame(card: ScryfallCard) {
  const clueLevel = guessedPrintingKeys.size;
  const showManaCost = clueLevel >= 1;
  const showTypeLineAndStats = clueLevel >= 2;
  const showOracleText = clueLevel >= (currentHardMode ? HARD_MODE_ORACLE_CLUE_GUESS_COUNT : NORMAL_ORACLE_CLUE_GUESS_COUNT);
  const manaCost = getCardManaCost(card);
  const typeLine = getCardTypeLine(card);
  const oracleText = getCardOracle(card);
  const stats = getCardStats(card);
  cardFrame.replaceChildren();

  const nameRow = document.createElement("div");
  nameRow.className = "card-name-row";
  const name = document.createElement("span");
  name.textContent = card.name;
  const mana = document.createElement("span");
  if (showManaCost && manaCost) {
    renderWithSymbols(manaCost, mana);
  }
  nameRow.appendChild(name);
  nameRow.appendChild(mana);

  const artPlaceholder = document.createElement("div");
  artPlaceholder.className = "card-art-placeholder";
  artPlaceholder.setAttribute("aria-hidden", "true");

  const typeRow = document.createElement("div");
  typeRow.className = "card-type-row";
  const type = document.createElement("span");
  type.textContent = showTypeLineAndStats ? typeLine : "";
  typeRow.appendChild(type);

  const statsEl = document.createElement("span");
  statsEl.className = "card-stats";
  statsEl.textContent = showTypeLineAndStats ? stats : "";

  const textBox = document.createElement("div");
  textBox.className = "card-text-box";
  if (currentHardMode && !showOracleText) {
    textBox.classList.add("hidden");
  }
  if (showOracleText) {
    const oracle = document.createElement("p");
    oracle.className = "card-oracle";
    const lines = (oracleText || "No rules text").split("\n");
    lines.forEach((line, i) => {
      if (i > 0) {
        oracle.appendChild(document.createElement("br"));
      }
      renderWithSymbols(line, oracle);
    });
    textBox.appendChild(oracle);
  }
  textBox.appendChild(statsEl);

  cardFrame.appendChild(nameRow);
  cardFrame.appendChild(artPlaceholder);
  cardFrame.appendChild(typeRow);
  cardFrame.appendChild(textBox);
}

async function fetchAllSets(): Promise<SetInfo[]> {
  const sets: SetInfo[] = [];
  let nextPage = "https://api.scryfall.com/sets";

  while (nextPage) {
    const response = await fetch(nextPage);
    if (!response.ok) {
      throw new Error("Failed to load set list.");
    }
    const payload = (await response.json()) as ScryfallList<{
      code: string;
      name: string;
      set_type: string;
      released_at?: string;
      icon_svg_uri?: string;
    }>;

    for (const set of payload.data) {
      if (!set.code || !set.name) {
        continue;
      }
      if (set.set_type === "memorabilia") {
        continue;
      }
      const releaseDate = set.released_at ?? null;
      sets.push({
        code: set.code.toLowerCase(),
        name: set.name,
        iconSvgUri: set.icon_svg_uri ?? null,
        releaseDate,
        releaseYear: parseReleaseYear(releaseDate)
      });
    }

    nextPage = payload.has_more && payload.next_page ? payload.next_page : "";
  }

  const deduped = new Map<string, SetInfo>();
  for (const set of sets) {
    if (!deduped.has(set.code)) {
      deduped.set(set.code, set);
    }
  }

  return [...deduped.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function fetchAllPrintings(cardName: string): Promise<PrintingInfo[]> {
  const printings: PrintingInfo[] = [];
  const escapedCardName = cardName.replace(/[\"'\\]/g, "\\$&");
  const query = `!"${escapedCardName}" unique:prints game:paper`;
  let nextPage = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&include_extras=true&include_variations=true`;

  while (nextPage) {
    const response = await fetch(nextPage);
    if (!response.ok) {
      throw new Error("Failed to load card printings.");
    }
    const payload = (await response.json()) as ScryfallList<ScryfallCard>;

    for (const card of payload.data) {
      const nonfoilPrice = parsePrice(card.prices.usd);
      const foilPrice = maxPrice(parsePrice(card.prices.usd_foil), parsePrice(card.prices.usd_etched));
      const modifiers: string[] = [];
      if (card.border_color === "borderless") modifiers.push("Borderless");
      if (card.frame_effects?.includes("extendedart")) modifiers.push("Extended Art");
      if (card.frame_effects?.includes("showcase")) modifiers.push("Showcase");
      if (card.full_art) modifiers.push("Full Art");
      if (card.textless) modifiers.push("Textless");
      if (card.finishes?.includes("etched")) modifiers.push("Etched");
      printings.push({
        id: card.id,
        setCode: card.set.toLowerCase(),
        setName: card.set_name,
        imageUrl: getCardImage(card),
        collectorNumber: card.collector_number,
        releaseDate: card.released_at ?? null,
        releaseYear: parseReleaseYear(card.released_at),
        prices: {
          nonfoil: nonfoilPrice,
          foil: foilPrice
        },
        style: getPrintingStyle(card),
        modifiers
      });
    }

    nextPage = payload.has_more && payload.next_page ? payload.next_page : "";
  }

  return printings;
}

function rankSets(query: string, limit: number): SetInfo[] {
  const cleaned = normalize(query);
  if (!cleaned) {
    return [];
  }

  if (cleaned === lastSetQuery) {
    return lastSetResults.slice(0, limit);
  }

  lastSetQuery = cleaned;
  const ranked = allSets
    .map(set => {
      const code = set.code.toLowerCase();
      const name = normalize(set.name);
      let score = 1000;

      if (code === cleaned || name === cleaned) {
        score = 0;
      } else if (code.startsWith(cleaned)) {
        score = 5;
      } else if (name.startsWith(cleaned)) {
        score = 10;
      } else if (name.includes(` ${cleaned}`)) {
        score = 20;
      } else if (name.includes(cleaned) || code.includes(cleaned)) {
        score = 30;
      }

      return { set, score, name, code };
    })
    .sort((a, b) => {
      if (a.score !== b.score) {
        return a.score - b.score;
      }
      if (a.name !== b.name) {
        return a.name.localeCompare(b.name);
      }
      return a.code.localeCompare(b.code);
    })
    .map(item => item.set);

  lastSetResults = ranked;
  return ranked.slice(0, limit);
}

function createSetIcon(iconSvgUri: string | null): HTMLImageElement | null {
  if (!iconSvgUri) {
    return null;
  }
  const img = document.createElement("img");
  img.src = iconSvgUri;
  img.alt = "";
  img.className = "set-icon";
  return img;
}

function getSetSymbolLabel(set: SetInfo): string {
  if (set.releaseYear == null) {
    return set.name;
  }
  const yearText = String(set.releaseYear);
  if (set.name.includes(yearText)) {
    return set.name;
  }
  return `${set.name} (${yearText})`;
}

function renderSetTimeline() {
  setTimeline.replaceChildren();
  timelineSetIndexByCode.clear();

  const timelineSets = [...allSets].sort((a, b) => {
    if (!a.releaseDate) return 1;
    if (!b.releaseDate) return -1;
    return a.releaseDate.localeCompare(b.releaseDate);
  });

  timelineSets.forEach((set, index) => {
    const item = document.createElement("div");
    item.className = "timeline-set-item";
    item.dataset.setCode = set.code;
    const symbolLabel = getSetSymbolLabel(set);
    item.title = symbolLabel;
    item.setAttribute("aria-label", symbolLabel);

    if (set.iconSvgUri) {
      const img = document.createElement("img");
      img.src = set.iconSvgUri;
      img.alt = symbolLabel;
      img.className = "timeline-set-icon";
      item.appendChild(img);
    } else {
      const square = document.createElement("span");
      square.className = "timeline-set-fallback-square";
      square.setAttribute("aria-hidden", "true");
      item.appendChild(square);
    }

    setTimeline.appendChild(item);
    timelineSetIndexByCode.set(set.code, index);
  });

  setTimeline.classList.remove("hidden");
}

function getTimelineHintDirection(setCode: string): "timeline-set-hint-left" | "timeline-set-hint-right" | null {
  const guessedIndex = timelineSetIndexByCode.get(setCode);
  if (guessedIndex === undefined || correctSetCodes.has(setCode)) {
    return null;
  }

  let nearestDelta: number | null = null;
  for (const correctSetCode of correctSetCodes) {
    const correctIndex = timelineSetIndexByCode.get(correctSetCode);
    if (correctIndex === undefined) {
      continue;
    }
    const delta = correctIndex - guessedIndex;
    if (nearestDelta === null || Math.abs(delta) < Math.abs(nearestDelta)) {
      nearestDelta = delta;
    }
  }

  if (nearestDelta === null) {
    return null;
  }

  return nearestDelta < 0 ? "timeline-set-hint-left" : "timeline-set-hint-right";
}

function updateSetTimelineItem(setCode: string, isCorrect: boolean) {
  const item = setTimeline.querySelector(`[data-set-code="${CSS.escape(setCode)}"]`) as HTMLElement | null;
  if (!item) {
    return;
  }
  if (isCorrect) {
    item.classList.add("timeline-set-correct");
    item.classList.remove("timeline-set-incorrect");
  } else {
    item.classList.add("timeline-set-incorrect");
    item.classList.remove("timeline-set-correct");
  }
  item.classList.remove("timeline-set-hint-left", "timeline-set-hint-right");

  if (!isCorrect) {
    const directionClass = getTimelineHintDirection(setCode);
    if (directionClass) {
      item.classList.add(directionClass);
    }
  }

  item.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
}

function appendSetNameNodes(parent: Node, iconSvgUri: string | null, name: string, code?: string): void {
  const icon = createSetIcon(iconSvgUri);
  if (icon) {
    parent.appendChild(icon);
    parent.appendChild(document.createTextNode(" "));
  }
  parent.appendChild(document.createTextNode(code ? `${name} (${code.toUpperCase()})` : name));
}

function renderAutocomplete(query: string) {
  setAutocomplete.innerHTML = "";
  if (!query.trim()) {
    return;
  }

  const suggestions = rankSets(query, 12);
  for (const set of suggestions) {
    const item = document.createElement("li");
    appendSetNameNodes(item, set.iconSvgUri, set.name, set.code);
    item.onclick = () => {
      setGuessInput.value = set.name;
      setGuessInput.dataset.selectedCode = set.code;
      setAutocomplete.innerHTML = "";
      setGuessInput.focus();
    };
    setAutocomplete.appendChild(item);
  }
}

function formatPrice(value: number | null): string {
  if (value === null) {
    return NO_PRINTING_TEXT;
  }
  return `$${value.toFixed(2)}`;
}

function priceHeatColor(guessPrice: number | null, answerPrice: number): string {
  if (guessPrice === null) {
    return PRICE_COLOR_NO_DATA;
  }
  if (answerPrice <= 0) {
    return guessPrice <= 0
      ? `rgb(${PRICE_COLOR_CLOSE.r}, ${PRICE_COLOR_CLOSE.g}, ${PRICE_COLOR_CLOSE.b})`
      : PRICE_COLOR_NO_DATA;
  }

  const ratio = Math.abs(guessPrice - answerPrice) / answerPrice;
  const clamped = Math.min(ratio / PRICE_DIFF_THRESHOLD, 1);

  const r = Math.round(PRICE_COLOR_CLOSE.r + (PRICE_COLOR_FAR.r - PRICE_COLOR_CLOSE.r) * clamped);
  const g = Math.round(PRICE_COLOR_CLOSE.g + (PRICE_COLOR_FAR.g - PRICE_COLOR_CLOSE.g) * clamped);
  const b = Math.round(PRICE_COLOR_CLOSE.b + (PRICE_COLOR_FAR.b - PRICE_COLOR_CLOSE.b) * clamped);

  return `rgb(${r}, ${g}, ${b})`;
}

function getGuessResultText(printing: PrintingInfo | null, finish: Finish): string {
  if (!printing) {
    return NO_PRINTING_TEXT;
  }

  const price = getPrintingPrice(printing, finish);
  if (price !== null) {
    return formatPrice(price);
  }

  return finish === "foil" ? "No foil printing" : NO_PRINTING_TEXT;
}

function getGuessKey(setCode: string, finish: Finish, printing: PrintingInfo | null, style: PrintingStyle | null = null): string {
  return printing ? `${printing.id}:${finish}` : `${setCode}:missing:${finish}:${style ?? "none"}`;
}

function getYearComparisonArrow(guessedYear: number | null, answerYear: number | null): string {
  if (guessedYear === null || answerYear === null || guessedYear === answerYear) {
    return "";
  }
  return answerYear > guessedYear ? " ↑" : " ↓";
}

function formatYearResult(set: SetInfo): string {
  if (set.releaseYear === null) {
    return "Unknown";
  }
  return `${set.releaseYear}${getYearComparisonArrow(set.releaseYear, correctPrinting?.releaseYear ?? null)}`;
}

function getYearResultClass(set: SetInfo): string {
  const guessedYear = set.releaseYear;
  const answerYear = correctPrinting?.releaseYear ?? null;
  if (guessedYear === null || answerYear === null) {
    return "";
  }
  const diff = Math.abs(guessedYear - answerYear);
  if (diff === 0) {
    return "result-year-exact";
  }
  if (diff <= 2) {
    return "result-year-close";
  }
  return "result-year-far";
}

function getPriceShareEmoji(price: number | null, answerPrice: number): string {
  if (price === null) return "🟥";
  if (answerPrice <= 0) return price <= 0 ? "🟩" : "🟥";

  const ratio = Math.abs(price - answerPrice) / answerPrice;
  const clamped = Math.min(ratio / PRICE_DIFF_THRESHOLD, 1);

  if (clamped < 0.25) return "🟩";
  if (clamped < 0.5) return "🟨";
  if (clamped < 0.75) return "🟧";
  return "🟥";
}

function getYearShareEmoji(set: SetInfo): string {
  const yearClass = getYearResultClass(set);
  if (yearClass === "result-year-exact") return "🟩";
  if (yearClass === "result-year-close") return "🟨";
  return "🟥";
}

function getPrintingOptionCaption(printing: PrintingInfo): string {
  const pieces = [`#${printing.collectorNumber}`];
  if (printing.releaseYear !== null) {
    pieces.push(String(printing.releaseYear));
  }
  return pieces.join(" • ");
}

function pickHardModePrinting(printings: PrintingInfo[], style: PrintingStyle, finish: Finish): PrintingInfo | null {
  const matches = printings.filter(printing => printing.style === style);
  if (!matches.length) {
    return null;
  }
  return matches.sort((a, b) => {
    const aPrice = getPrintingPrice(a, finish);
    const bPrice = getPrintingPrice(b, finish);
    if (aPrice !== null && bPrice !== null && aPrice !== bPrice) {
      return bPrice - aPrice;
    }
    if (aPrice !== null && bPrice === null) {
      return -1;
    }
    if (aPrice === null && bPrice !== null) {
      return 1;
    }
    const collectorNumberComparison = a.collectorNumber.localeCompare(b.collectorNumber, undefined, { numeric: true });
    if (collectorNumberComparison !== 0) {
      return collectorNumberComparison;
    }
    return a.id.localeCompare(b.id);
  })[0] ?? null;
}

function addGuessRow(set: SetInfo, finish: Finish, printing: PrintingInfo | null, guessedStyle: PrintingStyle | null = null) {
  const row = document.createElement("div");
  row.className = "result-item results-row";

  const guessedKey = getGuessKey(set.code, finish, printing, guessedStyle);
  const isSetCorrect = correctSetCodes.has(set.code);
  const isPrintingCorrect = printing !== null && correctAnswerKeys.has(guessedKey);

  const setCell = document.createElement("div");
  setCell.className = `result-set ${isSetCorrect ? "result-set-correct" : "result-set-incorrect"}`;
  appendSetNameNodes(setCell, set.iconSvgUri, set.name, set.code);

  const numberCell = document.createElement("div");
  numberCell.className = `result-number ${isPrintingCorrect ? "result-number-correct" : "result-number-incorrect"}`;
  const variantParts: string[] = [];
  if (printing) {
    variantParts.push(`#${printing.collectorNumber}`);
    variantParts.push(formatFinish(finish));
    if (currentHardMode) {
      variantParts.push(getStyleLabel(printing.style));
    }
    variantParts.push(...printing.modifiers);
  } else {
    // Occurs when a set has no paper printing for this card (e.g. digital-only or missing data)
    variantParts.push(formatFinish(finish));
    if (guessedStyle) {
      variantParts.push(getStyleLabel(guessedStyle));
    }
    variantParts.push("No printing");
  }
  numberCell.textContent = variantParts.join(" • ");

  const priceCell = document.createElement("span");
  priceCell.className = "result-price";
  const price = getPrintingPrice(printing, finish);
  const winningPrice = getPrintingPrice(correctPrinting, correctFinish) ?? 0;
  priceCell.textContent = getGuessResultText(printing, finish);
  priceCell.style.backgroundColor = priceHeatColor(price, winningPrice);

  const yearCell = document.createElement("span");
  yearCell.className = "result-year";
  yearCell.textContent = formatYearResult(set);
  const yearClass = getYearResultClass(set);
  if (yearClass) {
    yearCell.classList.add(yearClass);
  }

  row.appendChild(setCell);
  row.appendChild(numberCell);
  row.appendChild(priceCell);
  row.appendChild(yearCell);

  const setEmoji = isSetCorrect ? "🟩" : "🟥";
  const numberEmoji = isPrintingCorrect ? "🟩" : "🟥";
  const priceEmoji = getPriceShareEmoji(price, winningPrice);
  const yearEmoji = getYearShareEmoji(set);
  shareRows.push(`${setEmoji}${numberEmoji}${priceEmoji}${yearEmoji}`);

  resultsGrid.appendChild(row);
}

function showWinModal(printing: PrintingInfo, finish: Finish) {
  const winningPrice = getPrintingPrice(printing, finish);
  if (winningPrice === null) {
    return;
  }

  winMessage.replaceChildren();
  winMessage.appendChild(document.createTextNode(`Correct! ${selectedCardName}'s highest Scryfall price is the ${formatFinish(finish).toLowerCase()} printing in `));
  const winSet = allSets.find(s => s.code === printing.setCode);
  appendSetNameNodes(winMessage, winSet?.iconSvgUri ?? null, printing.setName);
  winMessage.appendChild(document.createTextNode(` at ${formatPrice(winningPrice)}.`));

  if (printing.imageUrl) {
    winCardImage.src = printing.imageUrl;
    winCardImage.alt = `${selectedCardName} from ${printing.setName}`;
    winCardImage.classList.remove("hidden");
  } else {
    winCardImage.removeAttribute("src");
    winCardImage.alt = "";
    winCardImage.classList.add("hidden");
  }

  if (currentMode === "daily") {
    saveDailyPlayRecord(
      getDailyRecordKey(getTodayKey(), currentHardMode),
      shareRows,
      selectedCardName,
      formatPrice(winningPrice),
      printing.imageUrl,
      currentHardMode,
    );
    shareResultsButton.classList.remove("hidden");
  } else {
    shareResultsButton.classList.add("hidden");
  }

  winModal.classList.remove("hidden");
}

async function fetchCardImageByName(cardName: string): Promise<string | null> {
  try {
    const response = await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(cardName)}`);
    if (!response.ok) {
      console.error(`Failed to fetch card image for "${cardName}": HTTP ${response.status}`);
      return null;
    }
    const card = (await response.json()) as ScryfallCard;
    return getCardImage(card);
  } catch (error) {
    console.error(`Failed to fetch card image for "${cardName}":`, error);
    return null;
  }
}

async function showStoredDailyWinModal(record: DailyPlayRecord) {
  const storedHardMode = record.hardMode ?? false;
  currentHardMode = storedHardMode;
  shareRows = [...record.shareRows];
  if (record.cardName && record.priceText) {
    winMessage.textContent = `You already completed today's daily. Today's card was ${record.cardName} at ${record.priceText}. You can copy your score again.`;
  } else {
    winMessage.textContent = "You already completed today's daily. You can copy your score again.";
  }

  let imageUrl = record.imageUrl ?? null;
  if (!imageUrl && record.cardName) {
    imageUrl = await fetchCardImageByName(record.cardName);
    if (imageUrl) {
      saveDailyPlayRecord(
        getDailyRecordKey(getTodayKey(), storedHardMode),
        record.shareRows,
        record.cardName,
        record.priceText ?? "",
        imageUrl,
        storedHardMode,
      );
    }
  }

  if (imageUrl) {
    winCardImage.src = imageUrl;
    winCardImage.alt = record.cardName ? `${record.cardName} winning printing` : "Winning card printing";
    winCardImage.classList.remove("hidden");
  } else {
    winCardImage.removeAttribute("src");
    winCardImage.alt = "";
    winCardImage.classList.add("hidden");
  }
  shareResultsButton.classList.remove("hidden");
  winModal.classList.remove("hidden");
}

function findSelectedSet(): SetInfo | null {
  const selectedCode = setGuessInput.dataset.selectedCode;
  if (selectedCode) {
    const byCode = allSets.find(set => set.code === selectedCode);
    if (byCode) {
      return byCode;
    }
  }

  const query = setGuessInput.value.trim();
  if (!query) {
    return null;
  }

  const best = rankSets(query, 1)[0];
  return best ?? null;
}

function clearSetGuess() {
  setGuessInput.value = "";
  setGuessInput.dataset.selectedCode = "";
  setAutocomplete.innerHTML = "";
}

function closeVersionPicker() {
  versionPickerGrid.replaceChildren();
  versionPickerModal.classList.add("hidden");
}

function submitGuess(guessedSet: SetInfo, guessedFinish: Finish, printing: PrintingInfo | null, guessedStyle: PrintingStyle | null = null) {
  const guessedKey = getGuessKey(guessedSet.code, guessedFinish, printing, guessedStyle);

  if (guessedPrintingKeys.has(guessedKey)) {
    guessStatus.textContent = "You already guessed that version and finish.";
    clearSetGuess();
    return;
  }

  guessedPrintingKeys.add(guessedKey);
  addGuessRow(guessedSet, guessedFinish, printing, guessedStyle);
  if (!currentHardMode) {
    updateSetTimelineItem(guessedSet.code, correctSetCodes.has(guessedSet.code));
  }
  clearSetGuess();
  if (selectedCard) {
    renderCardFrame(selectedCard);
  }

  if (correctAnswerKeys.has(guessedKey) && printing) {
    guessStatus.textContent = "Correct!";
    showWinModal(printing, guessedFinish);
    return;
  }

  guessStatus.replaceChildren();
  appendSetNameNodes(guessStatus, guessedSet.iconSvgUri, guessedSet.name);
  guessStatus.appendChild(document.createTextNode(` ${formatFinish(guessedFinish).toLowerCase()} was not the highest-price printing.`));
}

function openVersionPicker(guessedSet: SetInfo, guessedFinish: Finish, printings: PrintingInfo[]) {
  versionPickerTitle.replaceChildren();
  versionPickerTitle.appendChild(document.createTextNode(`Choose ${selectedCardName} in `));
  appendSetNameNodes(versionPickerTitle, guessedSet.iconSvgUri, guessedSet.name);
  versionPickerGrid.replaceChildren();

  const sortedPrintings = [...printings].sort((a, b) => {
    const collectorNumberComparison = a.collectorNumber.localeCompare(b.collectorNumber, undefined, { numeric: true });
    if (collectorNumberComparison !== 0) {
      return collectorNumberComparison;
    }
    return a.id.localeCompare(b.id);
  });

  for (const printing of sortedPrintings) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "version-option";

    if (printing.imageUrl) {
      const image = document.createElement("img");
      image.src = printing.imageUrl;
      image.alt = `${selectedCardName} from ${guessedSet.name} (#${printing.collectorNumber})`;
      option.appendChild(image);
    } else {
      const fallback = document.createElement("div");
      fallback.className = "version-option-fallback";
      fallback.textContent = selectedCardName;
      option.appendChild(fallback);
    }

    const caption = document.createElement("span");
    caption.className = "version-option-caption";
    caption.textContent = getPrintingOptionCaption(printing);
    option.appendChild(caption);

    option.addEventListener("click", () => {
      closeVersionPicker();
      submitGuess(guessedSet, guessedFinish, printing);
    });

    versionPickerGrid.appendChild(option);
  }

  versionPickerModal.classList.remove("hidden");
}

function handleGuess() {
  if (!correctPrinting) {
    guessStatus.textContent = "Game is still loading.";
    return;
  }

  const guessedSet = findSelectedSet();
  if (!guessedSet) {
    guessStatus.textContent = "Pick a valid set from suggestions or type a clearer query.";
    return;
  }

  const guessedFinish = getSelectedFinish();
  const guessedStyle = getSelectedStyle();
  const printings = printingsBySet.get(guessedSet.code) ?? [];

  if (currentHardMode) {
    const hardModePrinting = pickHardModePrinting(printings, guessedStyle, guessedFinish);
    submitGuess(guessedSet, guessedFinish, hardModePrinting, guessedStyle);
    return;
  }

  if (printings.length > 1) {
    guessStatus.textContent = "Choose which version you want to guess.";
    openVersionPicker(guessedSet, guessedFinish, printings);
    return;
  }

  submitGuess(guessedSet, guessedFinish, printings[0] ?? null);
}

async function setupGame(mode: GameMode) {
  const cardsResponse = await fetch("../formatted_card_list.json");
  if (!cardsResponse.ok) {
    throw new Error("Failed to load card list.");
  }
  const cards = (await cardsResponse.json()) as CardListItem[];

  if (!cards.length) {
    throw new Error("Card list was empty.");
  }
  const cardCandidates = getCardCandidates(cards, mode);
  let selectedPrintingsBySet: Map<string, PrintingInfo[]> | null = null;
  let highestPricePrinting: PrintingInfo | null = null;
  let highestPriceFinish: Finish = "nonfoil";
  let highestPrice = -1;
  let selectedCorrectAnswerKeys = new Set<string>();
  let selectedCorrectSetCodes = new Set<string>();
  let evaluatedCandidateCount = 0;

  for (const cardCandidate of cardCandidates) {
    evaluatedCandidateCount += 1;
    const printings = await fetchAllPrintings(cardCandidate);
    if (!printings.length) {
      continue;
    }

    const candidatePrintingsBySet = new Map<string, PrintingInfo[]>();
    for (const printing of printings) {
      const existing = candidatePrintingsBySet.get(printing.setCode) ?? [];
      existing.push(printing);
      candidatePrintingsBySet.set(printing.setCode, existing);
    }

    let candidateHighestPricePrinting: PrintingInfo | null = null;
    let candidateHighestPriceFinish: Finish = "nonfoil";
    let candidateHighestPrice = -1;
    const candidateCorrectAnswerKeys = new Set<string>();
    const candidateCorrectSetCodes = new Set<string>();

    for (const printingsInSet of candidatePrintingsBySet.values()) {
      for (const printing of printingsInSet) {
        const nonfoilPrice = printing.prices.nonfoil;
        if (nonfoilPrice !== null && nonfoilPrice > candidateHighestPrice) {
          candidateHighestPrice = nonfoilPrice;
          candidateHighestPriceFinish = "nonfoil";
          candidateHighestPricePrinting = printing;
          candidateCorrectAnswerKeys.clear();
          candidateCorrectSetCodes.clear();
          candidateCorrectAnswerKeys.add(getGuessKey(printing.setCode, "nonfoil", printing));
          candidateCorrectSetCodes.add(printing.setCode);
        } else if (nonfoilPrice !== null && nonfoilPrice === candidateHighestPrice) {
          candidateCorrectAnswerKeys.add(getGuessKey(printing.setCode, "nonfoil", printing));
          candidateCorrectSetCodes.add(printing.setCode);
        }

        const foilPrice = printing.prices.foil;
        if (foilPrice !== null && foilPrice > candidateHighestPrice) {
          candidateHighestPrice = foilPrice;
          candidateHighestPriceFinish = "foil";
          candidateHighestPricePrinting = printing;
          candidateCorrectAnswerKeys.clear();
          candidateCorrectSetCodes.clear();
          candidateCorrectAnswerKeys.add(getGuessKey(printing.setCode, "foil", printing));
          candidateCorrectSetCodes.add(printing.setCode);
        } else if (foilPrice !== null && foilPrice === candidateHighestPrice) {
          candidateCorrectAnswerKeys.add(getGuessKey(printing.setCode, "foil", printing));
          candidateCorrectSetCodes.add(printing.setCode);
        }
      }
    }

    if (!candidateHighestPricePrinting || candidateHighestPrice < MINIMUM_WINNING_PRINTING_PRICE) {
      continue;
    }

    selectedCardName = cardCandidate;
    selectedPrintingsBySet = candidatePrintingsBySet;
    highestPricePrinting = candidateHighestPricePrinting;
    highestPriceFinish = candidateHighestPriceFinish;
    highestPrice = candidateHighestPrice;
    selectedCorrectAnswerKeys = candidateCorrectAnswerKeys;
    selectedCorrectSetCodes = candidateCorrectSetCodes;
    break;
  }

  if (!selectedCardName || !selectedPrintingsBySet || !highestPricePrinting) {
    throw new Error(
      `Could not find a card with a printing valued at $${MINIMUM_WINNING_PRINTING_PRICE} or more after checking ${evaluatedCandidateCount} cards.`,
    );
  }

  printingsBySet = selectedPrintingsBySet;

  correctAnswerKeys.clear();
  for (const key of selectedCorrectAnswerKeys) {
    correctAnswerKeys.add(key);
  }
  correctSetCodes.clear();
  for (const setCode of selectedCorrectSetCodes) {
    correctSetCodes.add(setCode);
  }

  correctPrinting = highestPricePrinting;
  correctFinish = highestPriceFinish;

  const cardResponse = await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(selectedCardName)}`);
  if (!cardResponse.ok) {
    throw new Error("Failed to load today's card.");
  }

  selectedCard = (await cardResponse.json()) as ScryfallCard;
  renderCardFrame(selectedCard);

  allSets = await fetchAllSets();
  if (currentHardMode) {
    setTimeline.classList.add("hidden");
  } else {
    renderSetTimeline();
  }
  guessStatus.textContent = currentHardMode
    ? "Start typing a set name or code, then choose foil and style to guess."
    : "Start typing a set name or code to guess.";
}

function setLoadingState() {
  cardFrame.replaceChildren();
  const loading = document.createElement("p");
  loading.className = "loading";
  loading.textContent = "Loading card…";
  cardFrame.appendChild(loading);
}

function resetGameState() {
  selectedCardName = "";
  selectedCard = null;
  printingsBySet.clear();
  correctPrinting = null;
  correctFinish = "nonfoil";
  correctAnswerKeys.clear();
  correctSetCodes.clear();
  guessedPrintingKeys.clear();
  lastSetQuery = "";
  lastSetResults = [];
  shareRows = [];
  timelineSetIndexByCode.clear();
  clearSetGuess();
  resultsGrid.replaceChildren();
  setTimeline.replaceChildren();
  setTimeline.classList.add("hidden");
  guessStatus.textContent = "";
  closeVersionPicker();
  winModal.classList.add("hidden");
}

function showLanding() {
  resetGameState();
  updateStyleGuessVisibility();
  gameArea.classList.add("hidden");
  modeLanding.classList.remove("hidden");
}

async function startGame(mode: GameMode, hardMode: boolean) {
  currentMode = mode;
  currentHardMode = hardMode;
  resetGameState();
  updateStyleGuessVisibility();
  modeLanding.classList.add("hidden");
  gameArea.classList.remove("hidden");
  guessStatus.textContent = "Loading game data…";
  setLoadingState();
  try {
    await setupGame(mode);
  } catch (error) {
    cardFrame.replaceChildren();
    const loading = document.createElement("p");
    loading.className = "loading";
    loading.textContent = `Unable to load game data: ${(error as Error).message}`;
    cardFrame.appendChild(loading);
    guessStatus.textContent = "Please refresh and try again.";
  }
}

setGuessInput.addEventListener("input", () => {
  setGuessInput.dataset.selectedCode = "";
  renderAutocomplete(setGuessInput.value);
});

setGuessInput.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    handleGuess();
  }
});

setGuessButton.addEventListener("click", handleGuess);

closeWinModal.addEventListener("click", () => {
  showLanding();
});

shareResultsButton.addEventListener("click", () => {
  const modeLine = currentHardMode ? "\nHard Mode" : "";
  const shareText = `Temp Magic Daily${modeLine}\n${shareRows.join("\n")}\n${SHARE_URL}`;
  navigator.clipboard.writeText(shareText).then(() => {
    shareResultsButton.textContent = "Copied!";
    setTimeout(() => {
      shareResultsButton.textContent = "Share Results";
    }, 2000);
  }).catch((err: unknown) => {
    console.error("Clipboard write failed:", err);
    shareResultsButton.textContent = "Copy failed";
    setTimeout(() => {
      shareResultsButton.textContent = "Share Results";
    }, 2000);
  });
});

closeVersionPickerModal.addEventListener("click", closeVersionPicker);

winModal.addEventListener("click", event => {
  if (event.target === winModal) {
    showLanding();
  }
});

versionPickerModal.addEventListener("click", event => {
  if (event.target === versionPickerModal) {
    closeVersionPicker();
  }
});

startDailyMode.addEventListener("click", () => {
  currentHardMode = hardModeInput.checked;
  const savedDailyRecord = getDailyPlayRecord(getTodayKey());
  if (savedDailyRecord) {
    void showStoredDailyWinModal(savedDailyRecord);
    return;
  }
  void startGame("daily", currentHardMode);
});

startPracticeMode.addEventListener("click", () => {
  currentHardMode = hardModeInput.checked;
  void startGame("practice", currentHardMode);
});

showLanding();
