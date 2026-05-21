export {};

type CardListItem = string;

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
  artCropUrl: string | null;
  imageUrl: string | null;
  collectorNumber: string;
  releaseDate: string | null;
  releaseYear: number | null;
  prices: Record<Finish, number | null>;
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
    art_crop?: string;
    normal?: string;
  };
  card_faces?: Array<{
    image_uris?: {
      art_crop?: string;
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

const setGuessInput = document.getElementById("setGuessInput") as HTMLInputElement;
const finishGuessInput = document.getElementById("finishGuessInput") as HTMLSelectElement;
const setGuessButton = document.getElementById("setGuessButton") as HTMLButtonElement;
const setAutocomplete = document.getElementById("setAutocomplete") as HTMLUListElement;
const cardFrame = document.getElementById("cardFrame") as HTMLElement;
const resultsGrid = document.getElementById("resultsGrid") as HTMLElement;
const guessStatus = document.getElementById("guessStatus") as HTMLElement;
const winModal = document.getElementById("winModal") as HTMLElement;
const closeWinModal = document.getElementById("closeWinModal") as HTMLButtonElement;
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

const RNG_MULTIPLIER = 9301;
const RNG_INCREMENT = 49297;
const RNG_MODULUS = 233280;

const PRICE_COLOR_CLOSE = { r: 46, g: 204, b: 113 };
const PRICE_COLOR_FAR = { r: 231, g: 76, b: 60 };
const PRICE_COLOR_NO_DATA = "rgb(140, 65, 65)";
const PRICE_DIFF_THRESHOLD = 0.5;
const NO_PRINTING_TEXT = "No printing";

function seededRandom(seed: number) {
  return () => {
    seed = (seed * RNG_MULTIPLIER + RNG_INCREMENT) % RNG_MODULUS;
    return seed / RNG_MODULUS;
  };
}

function getDailyIndex(max: number) {
  const today = new Date().toISOString().slice(0, 10);
  let seed = 0;
  for (const c of today) {
    seed += c.charCodeAt(0);
  }
  //const rand = seededRandom(seed);
  //return Math.floor(rand() * max);
  return Math.floor(Math.random() * max);
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

function getCardImage(card: ScryfallCard): string | null {
  return card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal ?? null;
}

function getCardArtCrop(card: ScryfallCard): string | null {
  return card.image_uris?.art_crop ?? card.card_faces?.[0]?.image_uris?.art_crop ?? null;
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
  const showOracleText = clueLevel >= 3;
  const revealArtCrop = clueLevel >= 4;
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
  if (revealArtCrop && correctPrinting?.artCropUrl) {
    const artCrop = document.createElement("img");
    artCrop.className = "card-art-crop";
    artCrop.src = correctPrinting.artCropUrl;
    artCrop.alt = `${selectedCardName} art crop`;
    artPlaceholder.appendChild(artCrop);
  } else {
    artPlaceholder.setAttribute("aria-hidden", "true");
  }

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

  cardFrame.appendChild(nameRow);
  cardFrame.appendChild(artPlaceholder);
  cardFrame.appendChild(typeRow);
  cardFrame.appendChild(textBox);
  cardFrame.appendChild(statsEl);
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
        artCropUrl: getCardArtCrop(card),
        imageUrl: getCardImage(card),
        collectorNumber: card.collector_number,
        releaseDate: card.released_at ?? null,
        releaseYear: parseReleaseYear(card.released_at),
        prices: {
          nonfoil: nonfoilPrice,
          foil: foilPrice
        },
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

function getGuessKey(setCode: string, finish: Finish, printing: PrintingInfo | null): string {
  return printing ? `${printing.id}:${finish}` : `${setCode}:missing:${finish}`;
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

function getPrintingOptionCaption(printing: PrintingInfo): string {
  const pieces = [`#${printing.collectorNumber}`];
  if (printing.releaseYear !== null) {
    pieces.push(String(printing.releaseYear));
  }
  return pieces.join(" • ");
}

function addGuessRow(set: SetInfo, finish: Finish, printing: PrintingInfo | null) {
  const row = document.createElement("div");
  row.className = "result-item results-row";

  const guessedKey = getGuessKey(set.code, finish, printing);
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
    variantParts.push(...printing.modifiers);
  } else {
    // Occurs when a set has no paper printing for this card (e.g. digital-only or missing data)
    variantParts.push(formatFinish(finish));
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
  resultsGrid.prepend(row);
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

function submitGuess(guessedSet: SetInfo, guessedFinish: Finish, printing: PrintingInfo | null) {
  const guessedKey = getGuessKey(guessedSet.code, guessedFinish, printing);

  if (guessedPrintingKeys.has(guessedKey)) {
    guessStatus.textContent = "You already guessed that version and finish.";
    clearSetGuess();
    return;
  }

  guessedPrintingKeys.add(guessedKey);
  addGuessRow(guessedSet, guessedFinish, printing);
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
  const printings = printingsBySet.get(guessedSet.code) ?? [];

  if (printings.length > 1) {
    guessStatus.textContent = "Choose which version you want to guess.";
    openVersionPicker(guessedSet, guessedFinish, printings);
    return;
  }

  submitGuess(guessedSet, guessedFinish, printings[0] ?? null);
}

async function setupGame() {
  const cardsResponse = await fetch("../formatted_card_list.json");
  if (!cardsResponse.ok) {
    throw new Error("Failed to load card list.");
  }
  const cards = (await cardsResponse.json()) as CardListItem[];

  if (!cards.length) {
    throw new Error("Card list was empty.");
  }

  selectedCardName = cards[getDailyIndex(cards.length)];

  const cardResponse = await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(selectedCardName)}`);
  if (!cardResponse.ok) {
    throw new Error("Failed to load today's card.");
  }

  selectedCard = (await cardResponse.json()) as ScryfallCard;
  renderCardFrame(selectedCard);

  const printings = await fetchAllPrintings(selectedCard.name);
  if (!printings.length) {
    throw new Error("No printings found for today's card.");
  }

  printingsBySet.clear();
  for (const printing of printings) {
    const existing = printingsBySet.get(printing.setCode) ?? [];
    existing.push(printing);
    printingsBySet.set(printing.setCode, existing);
  }

  let highestPricePrinting: PrintingInfo | null = null;
  let highestPriceFinish: Finish = "nonfoil";
  let highestPrice = -1;
  correctAnswerKeys.clear();
  correctSetCodes.clear();
  for (const printingsInSet of printingsBySet.values()) {
    for (const printing of printingsInSet) {
      const nonfoilPrice = printing.prices.nonfoil;
      if (nonfoilPrice !== null && nonfoilPrice > highestPrice) {
        highestPrice = nonfoilPrice;
        highestPriceFinish = "nonfoil";
        highestPricePrinting = printing;
        correctAnswerKeys.clear();
        correctSetCodes.clear();
        correctAnswerKeys.add(getGuessKey(printing.setCode, "nonfoil", printing));
        correctSetCodes.add(printing.setCode);
      } else if (nonfoilPrice !== null && nonfoilPrice === highestPrice) {
        correctAnswerKeys.add(getGuessKey(printing.setCode, "nonfoil", printing));
        correctSetCodes.add(printing.setCode);
      }

      const foilPrice = printing.prices.foil;
      if (foilPrice !== null && foilPrice > highestPrice) {
        highestPrice = foilPrice;
        highestPriceFinish = "foil";
        highestPricePrinting = printing;
        correctAnswerKeys.clear();
        correctSetCodes.clear();
        correctAnswerKeys.add(getGuessKey(printing.setCode, "foil", printing));
        correctSetCodes.add(printing.setCode);
      } else if (foilPrice !== null && foilPrice === highestPrice) {
        correctAnswerKeys.add(getGuessKey(printing.setCode, "foil", printing));
        correctSetCodes.add(printing.setCode);
      }
    }
  }

  correctPrinting = highestPricePrinting;
  correctFinish = highestPriceFinish;
  if (!correctPrinting) {
    throw new Error("Could not determine a correct answer.");
  }

  allSets = await fetchAllSets();
  guessStatus.textContent = "Start typing a set name or code to guess.";
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
  winModal.classList.add("hidden");
});

closeVersionPickerModal.addEventListener("click", closeVersionPicker);

winModal.addEventListener("click", event => {
  if (event.target === winModal) {
    winModal.classList.add("hidden");
  }
});

versionPickerModal.addEventListener("click", event => {
  if (event.target === versionPickerModal) {
    closeVersionPicker();
  }
});

setupGame().catch(error => {
  cardFrame.replaceChildren();
  const loading = document.createElement("p");
  loading.className = "loading";
  loading.textContent = `Unable to load game data: ${(error as Error).message}`;
  cardFrame.appendChild(loading);
  guessStatus.textContent = "Please refresh and try again.";
});
