const setGuessInput = document.getElementById("setGuessInput");
const setGuessButton = document.getElementById("setGuessButton");
const setAutocomplete = document.getElementById("setAutocomplete");
const cardFrame = document.getElementById("cardFrame");
const resultsGrid = document.getElementById("resultsGrid");
const guessStatus = document.getElementById("guessStatus");
const winModal = document.getElementById("winModal");
const closeWinModal = document.getElementById("closeWinModal");
const winMessage = document.getElementById("winMessage");
const winCardImage = document.getElementById("winCardImage");
let allSets = [];
let selectedCardName = "";
let selectedCard = null;
let printingBySet = new Map();
let correctPrinting = null;
let guessedSetCodes = new Set();
let lastSetQuery = "";
let lastSetResults = [];
const RNG_MULTIPLIER = 9301;
const RNG_INCREMENT = 49297;
const RNG_MODULUS = 233280;
const PRICE_COLOR_CLOSE = { r: 46, g: 204, b: 113 };
const PRICE_COLOR_FAR = { r: 231, g: 76, b: 60 };
const PRICE_COLOR_NO_DATA = "rgb(140, 65, 65)";
const PRICE_DIFF_THRESHOLD = 0.5;
function seededRandom(seed) {
    return () => {
        seed = (seed * RNG_MULTIPLIER + RNG_INCREMENT) % RNG_MODULUS;
        return seed / RNG_MODULUS;
    };
}
function getDailyIndex(max) {
    const today = new Date().toISOString().slice(0, 10);
    let seed = 0;
    for (const c of today) {
        seed += c.charCodeAt(0);
    }
    const rand = seededRandom(seed);
    return Math.floor(rand() * max);
}
function normalize(value) {
    return value.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}
function parsePrice(value) {
    if (!value) {
        return 0;
    }
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
}
function getCardImage(card) {
    return card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal ?? null;
}
function getCardOracle(card) {
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
function getCardManaCost(card) {
    if (card.mana_cost) {
        return card.mana_cost;
    }
    return card.card_faces?.map(face => face.mana_cost ?? "").filter(Boolean).join(" // ") ?? "";
}
function getCardTypeLine(card) {
    if (card.type_line) {
        return card.type_line;
    }
    return card.card_faces?.map(face => face.type_line ?? "").filter(Boolean).join(" // ") ?? "";
}
function getCardStats(card) {
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
function renderCardFrame(card) {
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
    mana.textContent = manaCost;
    nameRow.appendChild(name);
    nameRow.appendChild(mana);
    const oracle = document.createElement("p");
    oracle.className = "card-oracle";
    oracle.textContent = oracleText || "No rules text";
    const typeRow = document.createElement("div");
    typeRow.className = "card-type-row";
    const type = document.createElement("span");
    type.textContent = typeLine;
    const statsEl = document.createElement("span");
    statsEl.className = "card-stats";
    statsEl.textContent = stats;
    typeRow.appendChild(type);
    typeRow.appendChild(statsEl);
    cardFrame.appendChild(nameRow);
    cardFrame.appendChild(oracle);
    cardFrame.appendChild(typeRow);
}
async function fetchAllSets() {
    const sets = [];
    let nextPage = "https://api.scryfall.com/sets";
    while (nextPage) {
        const response = await fetch(nextPage);
        if (!response.ok) {
            throw new Error("Failed to load set list.");
        }
        const payload = (await response.json());
        for (const set of payload.data) {
            if (!set.code || !set.name) {
                continue;
            }
            if (set.set_type === "memorabilia") {
                continue;
            }
            sets.push({ code: set.code.toLowerCase(), name: set.name });
        }
        nextPage = payload.has_more && payload.next_page ? payload.next_page : "";
    }
    const deduped = new Map();
    for (const set of sets) {
        if (!deduped.has(set.code)) {
            deduped.set(set.code, set);
        }
    }
    return [...deduped.values()].sort((a, b) => a.name.localeCompare(b.name));
}
async function fetchAllPrintings(cardName) {
    const printings = [];
    const escapedCardName = cardName.replace(/[\"'\\]/g, "\\$&");
    const query = `!"${escapedCardName}" unique:prints game:paper`;
    let nextPage = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}`;
    while (nextPage) {
        const response = await fetch(nextPage);
        if (!response.ok) {
            throw new Error("Failed to load card printings.");
        }
        const payload = (await response.json());
        for (const card of payload.data) {
            const priceFields = [card.prices.usd, card.prices.usd_foil, card.prices.usd_etched];
            const price = Math.max(...priceFields.map(parsePrice));
            printings.push({
                setCode: card.set.toLowerCase(),
                setName: card.set_name,
                price,
                imageUrl: getCardImage(card)
            });
        }
        nextPage = payload.has_more && payload.next_page ? payload.next_page : "";
    }
    return printings;
}
function rankSets(query, limit) {
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
        }
        else if (code.startsWith(cleaned)) {
            score = 5;
        }
        else if (name.startsWith(cleaned)) {
            score = 10;
        }
        else if (name.includes(` ${cleaned}`)) {
            score = 20;
        }
        else if (name.includes(cleaned) || code.includes(cleaned)) {
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
function renderAutocomplete(query) {
    setAutocomplete.innerHTML = "";
    if (!query.trim()) {
        return;
    }
    const suggestions = rankSets(query, 12);
    for (const set of suggestions) {
        const item = document.createElement("li");
        item.textContent = `${set.name} (${set.code.toUpperCase()})`;
        item.onclick = () => {
            setGuessInput.value = set.name;
            setGuessInput.dataset.selectedCode = set.code;
            setAutocomplete.innerHTML = "";
            setGuessInput.focus();
        };
        setAutocomplete.appendChild(item);
    }
}
function formatPrice(value) {
    if (value === null) {
        return "N/A";
    }
    return `$${value.toFixed(2)}`;
}
function priceHeatColor(guessPrice, answerPrice) {
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
function addGuessRow(set, hasPrinting, price) {
    const row = document.createElement("div");
    row.className = "result-item results-row";
    const setCell = document.createElement("span");
    setCell.textContent = `${set.name} (${set.code.toUpperCase()})`;
    const hasPrintingCell = document.createElement("span");
    hasPrintingCell.textContent = hasPrinting ? "✓" : "✗";
    const priceCell = document.createElement("span");
    priceCell.className = "result-price";
    priceCell.textContent = formatPrice(price);
    priceCell.style.backgroundColor = priceHeatColor(price, correctPrinting?.price ?? 0);
    row.appendChild(setCell);
    row.appendChild(hasPrintingCell);
    row.appendChild(priceCell);
    resultsGrid.prepend(row);
}
function showWinModal() {
    if (!correctPrinting) {
        return;
    }
    winMessage.textContent = `Correct! ${selectedCardName}'s highest Scryfall price is in ${correctPrinting.setName} at ${formatPrice(correctPrinting.price)}.`;
    if (correctPrinting.imageUrl) {
        winCardImage.src = correctPrinting.imageUrl;
        winCardImage.alt = `${selectedCardName} from ${correctPrinting.setName}`;
        winCardImage.classList.remove("hidden");
    }
    else {
        winCardImage.removeAttribute("src");
        winCardImage.alt = "";
        winCardImage.classList.add("hidden");
    }
    winModal.classList.remove("hidden");
}
function findSelectedSet() {
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
    if (guessedSetCodes.has(guessedSet.code)) {
        guessStatus.textContent = "You already guessed that set.";
        setGuessInput.value = "";
        setGuessInput.dataset.selectedCode = "";
        setAutocomplete.innerHTML = "";
        return;
    }
    guessedSetCodes.add(guessedSet.code);
    const printing = printingBySet.get(guessedSet.code);
    const hasPrinting = Boolean(printing);
    const price = printing ? printing.price : null;
    addGuessRow(guessedSet, hasPrinting, price);
    setGuessInput.value = "";
    setGuessInput.dataset.selectedCode = "";
    setAutocomplete.innerHTML = "";
    if (guessedSet.code === correctPrinting.setCode) {
        guessStatus.textContent = "Correct!";
        showWinModal();
        return;
    }
    guessStatus.textContent = `${guessedSet.name} was not the highest-price printing.`;
}
async function setupGame() {
    const cardsResponse = await fetch("/formatted_card_list.json");
    if (!cardsResponse.ok) {
        throw new Error("Failed to load card list.");
    }
    const cards = (await cardsResponse.json());
    if (!cards.length) {
        throw new Error("Card list was empty.");
    }
    selectedCardName = cards[getDailyIndex(cards.length)];
    const cardResponse = await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(selectedCardName)}`);
    if (!cardResponse.ok) {
        throw new Error("Failed to load today's card.");
    }
    selectedCard = (await cardResponse.json());
    renderCardFrame(selectedCard);
    const printings = await fetchAllPrintings(selectedCard.name);
    if (!printings.length) {
        throw new Error("No printings found for today's card.");
    }
    printingBySet.clear();
    for (const printing of printings) {
        const existing = printingBySet.get(printing.setCode);
        if (!existing || printing.price > existing.price) {
            printingBySet.set(printing.setCode, printing);
        }
    }
    let highestPricePrinting = null;
    for (const printing of printingBySet.values()) {
        if (!highestPricePrinting || printing.price > highestPricePrinting.price) {
            highestPricePrinting = printing;
        }
    }
    correctPrinting = highestPricePrinting;
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
winModal.addEventListener("click", event => {
    if (event.target === winModal) {
        winModal.classList.add("hidden");
    }
});
setupGame().catch(error => {
    cardFrame.replaceChildren();
    const loading = document.createElement("p");
    loading.className = "loading";
    loading.textContent = `Unable to load game data: ${error.message}`;
    cardFrame.appendChild(loading);
    guessStatus.textContent = "Please refresh and try again.";
});
export {};
