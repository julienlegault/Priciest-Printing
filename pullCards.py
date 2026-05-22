import json
import re
from typing import Any

import requests

OUTPUT_FILE = "public/formatted_card_list.json"
SCRYFALL_BULK_DATA_URL = "https://api.scryfall.com/bulk-data"
PRICE_THRESHOLD = 12.0

excluded_card_names = {
    "cleanse",
    "crusade",
    "jihad",
    "imprison",
    "invoke-prejudice",
    "pradesh-gypsies",
    "stone-throwing-devils",
}


def normalize_name(name: str) -> str:
    name = name.lower()
    if "//" in name:
        name = [part.strip() for part in name.split("//")][0]
    name = re.sub(r"[^a-z0-9\- ]+", "", name)
    name = re.sub(r"\s+", "-", name.strip())
    return name


def fetch_bulk_data_index() -> dict[str, Any]:
    try:
        response = requests.get(SCRYFALL_BULK_DATA_URL, timeout=30)
        response.raise_for_status()
        return response.json()
    except requests.RequestException as exc:
        raise RuntimeError("Failed to fetch Scryfall bulk data index") from exc


def download_bulk_dataset(dataset_type: str, bulk_index: dict[str, Any]) -> list[dict[str, Any]]:
    dataset = next((item for item in bulk_index["data"] if item["type"] == dataset_type), None)
    if not dataset:
        raise RuntimeError(f"Scryfall dataset not found: {dataset_type}")

    download_url = dataset["download_uri"]
    try:
        response = requests.get(download_url, timeout=120)
        response.raise_for_status()
        return response.json()
    except requests.RequestException as exc:
        raise RuntimeError(
            f"Failed to download Scryfall dataset '{dataset_type}' from {download_url}"
        ) from exc


def parse_price_value(value: str | None) -> float:
    if value in (None, ""):
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def get_highest_price_for_printing(card: dict[str, Any]) -> float:
    prices = card.get("prices") or {}
    return max(
        parse_price_value(prices.get("usd")),
        parse_price_value(prices.get("usd_foil")),
        parse_price_value(prices.get("usd_etched")),
    )


def build_max_price_by_oracle_id(default_cards: list[dict[str, Any]]) -> dict[str, float]:
    max_price_by_oracle_id: dict[str, float] = {}
    for card in default_cards:
        oracle_id = card.get("oracle_id")
        if not oracle_id:
            continue

        highest_price = get_highest_price_for_printing(card)
        previous = max_price_by_oracle_id.get(oracle_id, 0.0)
        if highest_price > previous:
            max_price_by_oracle_id[oracle_id] = highest_price
    return max_price_by_oracle_id


def build_card_list(
    oracle_cards: list[dict[str, Any]], max_price_by_oracle_id: dict[str, float]
) -> list[str]:
    selected_cards: list[str] = []
    seen_names: set[str] = set()

    for card in oracle_cards:
        if card.get("legalities", {}).get("commander") != "legal":
            continue

        card_name = card.get("name")
        oracle_id = card.get("oracle_id")
        if not card_name or not oracle_id:
            continue

        if normalize_name(card_name) in excluded_card_names:
            continue

        max_price = max_price_by_oracle_id.get(oracle_id, 0.0)
        if max_price <= PRICE_THRESHOLD:
            continue

        if card_name in seen_names:
            continue

        selected_cards.append(card_name)
        seen_names.add(card_name)

    selected_cards.sort(key=str.casefold)
    return selected_cards


def write_card_list(card_list: list[str], filename: str) -> None:
    with open(filename, "w", encoding="utf-8") as f:
        json.dump(card_list, f, ensure_ascii=False)


def main() -> None:
    print("🔄 Fetching Scryfall bulk data index...")
    bulk_index = fetch_bulk_data_index()

    print("📥 Downloading oracle cards dataset...")
    oracle_cards = download_bulk_dataset("oracle_cards", bulk_index)
    print(f"   Loaded {len(oracle_cards):,} oracle cards")

    print("📥 Downloading default cards dataset (all printings with prices)...")
    default_cards = download_bulk_dataset("default_cards", bulk_index)
    print(f"   Loaded {len(default_cards):,} printings")

    max_price_by_oracle_id = build_max_price_by_oracle_id(default_cards)
    selected_cards = build_card_list(oracle_cards, max_price_by_oracle_id)
    write_card_list(selected_cards, OUTPUT_FILE)

    print("✅ Finished")
    print(f"   Price threshold: ${PRICE_THRESHOLD:.2f}")
    print(f"   Total cards in list: {len(selected_cards):,}")
    print(f"   File saved: {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
