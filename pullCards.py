import json
import re
import requests
import time
import os
from urllib.parse import urlparse

OUTPUT_FILE = "formatted_card_list.js"
EDHREC_BASE_URL = "https://json.edhrec.com/pages/cards/"
SCRYFALL_BULK_DATA_URL = "https://api.scryfall.com/bulk-data"

# Delay between API checks to avoid hammering EDHREC
REQUEST_DELAY = 0.2  # seconds

fully_banned_cards = ["cleanse", "crusade", "jihad", "imprison", "invoke-prejudice", "pradesh-gypsies", "stone-throwing-devils"]

def download_oracle_cards():
    """Download the latest oracle cards from Scryfall."""
    print("🔄 Fetching Scryfall bulk data info...")
    
    try:
        # Get bulk data info from Scryfall
        response = requests.get(SCRYFALL_BULK_DATA_URL, timeout=10)
        response.raise_for_status()
        bulk_data = response.json()
        
        # Find the oracle cards dataset
        oracle_data = None
        for dataset in bulk_data["data"]:
            if dataset["type"] == "oracle_cards":
                oracle_data = dataset
                break
        
        if not oracle_data:
            raise Exception("Oracle cards dataset not found in Scryfall bulk data")
        
        download_url = oracle_data["download_uri"]
        file_size = oracle_data.get("size", 0)
        
        print(f"📥 Downloading oracle cards from Scryfall...")
        print(f"   URL: {download_url}")
        print(f"   Size: {file_size:,} bytes ({file_size / 1024 / 1024:.1f} MB)")
        
        # Download the file
        response = requests.get(download_url, timeout=60, stream=True)
        response.raise_for_status()
        
        # Save to temporary file
        temp_file = "oracle-cards-temp.json"
        with open(temp_file, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        
        print("✅ Download complete!")
        
        # Load and return the JSON data
        with open(temp_file, "r", encoding="utf-8") as f:
            cards = json.load(f)
        
        # Clean up temp file
        os.remove(temp_file)
        
        print(f"📋 Loaded {len(cards):,} cards from Scryfall")
        return cards
        
    except Exception as e:
        print(f"❌ Error downloading oracle cards: {e}")
        raise

def normalize_name(name: str) -> str:
    """Normalize card names to lowercase, remove punctuation, replace spaces with hyphens."""
    name = name.lower()
    # check for '//' in name, and if present check if both sides are identical. If so, keep only one side.
    if '//' in name:
        name = [part.strip() for part in name.split('//')][0]

    name = re.sub(r"[^a-z0-9\- ]+", "", name)  # remove non-alphanumeric except spaces
    name = re.sub(r"\s+", "-", name.strip())  # replace spaces with hyphens
    return name

def is_valid_edhrec_card(name: str) -> bool:
    """Check if a given normalized card name has a valid EDHREC JSON page."""
    url = f"{EDHREC_BASE_URL}{name}.json"
    try:
        response = requests.get(url, timeout=5)
        if response.status_code != 200:
            return False
        data = response.json()
        # minimal validation: ensure expected keys exist
        card_info = data.get("container", {}).get("json_dict", {}).get("card", {})
        return "inclusion" in card_info and "potential_decks" in card_info
    except Exception:
        return False

def load_existing_card_list(filename):
    """Load the existing card list from the JavaScript file."""
    try:
        with open(filename, "r", encoding="utf-8") as f:
            content = f.read()
        
        # Extract the array content between the brackets
        start_marker = "window.cardList = ["
        end_marker = "];"
        
        start_idx = content.find(start_marker)
        if start_idx == -1:
            print(f"⚠️  Could not find array start in {filename}")
            return set()
        
        start_idx += len(start_marker)
        end_idx = content.find(end_marker, start_idx)
        if end_idx == -1:
            print(f"⚠️  Could not find array end in {filename}")
            return set()
        
        array_content = content[start_idx:end_idx].strip()
        
        # Parse the card names from the array content
        existing_cards = set()
        lines = array_content.split('\n')
        for line in lines:
            line = line.strip()
            if line and line.startswith('"') and line.endswith('"') or line.endswith('",'):
                # Remove quotes and comma
                card_name = line.strip('"').rstrip(',').rstrip('"').strip()
                if card_name:
                    existing_cards.add(card_name)
        
        print(f"📋 Found {len(existing_cards):,} existing cards in {filename}")
        return existing_cards
        
    except FileNotFoundError:
        print(f"📄 {filename} not found, starting with empty list")
        return set()
    except Exception as e:
        print(f"⚠️  Error reading {filename}: {e}")
        return set()

def write_javascript_format(card_list, filename):
    """Write the card list in the JavaScript format matching formatted_card_list.js"""
    with open(filename, "w", encoding="utf-8") as f:
        f.write("// Card list as a global variable for local testing\n")
        f.write("// Updated at: {}\n\n".format(time.strftime("%Y-%m-%d %H:%M:%S")))
        f.write("window.cardList = [\n")
        
        for i, card in enumerate(card_list):
            # Add comma except for the last item
            comma = "," if i < len(card_list) - 1 else ""
            f.write(f'  "{card}"{comma}\n')
        
        f.write("];\n")

def main():
    # Load existing cards to avoid redundant checks
    existing_cards = load_existing_card_list(OUTPUT_FILE)
    
    # Download the latest oracle cards from Scryfall
    cards = download_oracle_cards()

    formatted = list(existing_cards)  # Start with existing cards
    seen = set(existing_cards)        # Track what we've already processed
    new_cards_checked = 0
    new_cards_found = 0

    print(f"🔍 Checking {len(cards):,} cards against EDHREC...")
    print(f"   Skipping {len(existing_cards):,} cards already in the list")

    for i, card in enumerate(cards, 1):
        card_name = card["name"]
        if '//' in card_name:
            temp_name = normalize_name(re.sub(r"//", "", card_name).strip())
            if is_valid_edhrec_card(temp_name):
                norm = temp_name
                # Skip if we've already seen this card (existing or duplicate)
                if norm in seen or card.get("legalities").get("commander") != "legal":
                    continue
                new_cards_checked += 1
                formatted.append(norm)
                seen.add(norm)
                new_cards_found += 1
                print(f"[{new_cards_checked}] ✅ {norm} (NEW)")
                time.sleep(REQUEST_DELAY)
                continue
        norm = normalize_name(card_name)

        # Skip if we've already seen this card (existing or duplicate)
        if norm in seen or card.get("legalities").get("commander") != "legal" or norm in fully_banned_cards:
            continue

        new_cards_checked += 1
        
        if is_valid_edhrec_card(norm):
            formatted.append(norm)
            seen.add(norm)
            new_cards_found += 1
            print(f"[{new_cards_checked}] ✅ {norm} (NEW)")
        else:
            print(f"[{new_cards_checked}] ❌ {norm}")

        time.sleep(REQUEST_DELAY)

    # Write in JavaScript format matching the existing file structure

    if new_cards_found <= 0:
        # only edit the timestamp if no new cards were found
        # reopen the existing file in in-place mode and update the timestamp line
        print("\n⚠️  No new cards found, updating timestamp only.")
        with open(OUTPUT_FILE, "r+", encoding="utf-8") as f:
            content = f.readlines()
            f.seek(0)
            for line in content:
                if line.startswith("// Updated at:"):
                    f.write("// Updated at: {}\n\n".format(time.strftime("%Y-%m-%d %H:%M:%S")))
                else:
                    f.write(line)
            f.truncate()
    else:
        write_javascript_format(formatted, OUTPUT_FILE)

    print(f"\n✅ Finished!")
    print(f"   Total cards in list: {len(formatted):,}")
    print(f"   New cards checked: {new_cards_checked:,}")
    print(f"   New cards found: {new_cards_found:,}")
    print(f"   File saved: {OUTPUT_FILE}")

if __name__ == "__main__":
    main()
