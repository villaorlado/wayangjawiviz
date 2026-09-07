#!/usr/bin/env python3
"""
Prepare a raw region-level CSV (as exported from the Jawi OCR/annotation
pipeline) for the visualization site.

Usage:
    python3 scripts/prepare_data.py <input.csv> <term_id> <term_label>

Example:
    python3 scripts/prepare_data.py sample.csv wayang "Wayang"

What it does:
  - Drops the unnamed pandas index column, if present.
  - Validates required columns exist.
  - Writes a cleaned copy to data/<term_id>.csv
  - Registers/updates the dataset in data/datasets.json
  - Prints any event_city values not present in data/city_coords.json,
    so they can be reviewed and added by hand.

This script does not invent geocoding on its own -- city_coords.json is a
hand-curated lookup (raw string -> canonical name + lat/lon). Unmapped
cities are simply skipped by the map at render time (an on-page note
reports how many mentions were skipped).
"""
import csv
import json
import sys
from pathlib import Path

REQUIRED_COLUMNS = [
    "page_id", "region_id", "region_text",
    "wayang_type", "article_genre", "event_city",
]

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"


def main():
    if len(sys.argv) != 4:
        print(__doc__)
        sys.exit(1)

    src_path, term_id, term_label = sys.argv[1], sys.argv[2], sys.argv[3]
    src = Path(src_path)
    if not src.exists():
        sys.exit(f"Input file not found: {src}")

    with src.open(encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = [c for c in reader.fieldnames if c and c.strip()]
        missing = [c for c in REQUIRED_COLUMNS if c not in fieldnames]
        if missing:
            sys.exit(f"Input CSV is missing required columns: {missing}")
        rows = list(reader)

    DATA_DIR.mkdir(exist_ok=True)
    out_path = DATA_DIR / f"{term_id}.csv"
    with out_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({k: row.get(k, "") for k in fieldnames})
    print(f"Wrote {len(rows)} rows -> {out_path}")

    # Update datasets.json
    manifest_path = DATA_DIR / "datasets.json"
    manifest = []
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest = [d for d in manifest if d["id"] != term_id]
    manifest.append({
        "id": term_id,
        "label": term_label,
        "file": f"data/{term_id}.csv",
    })
    manifest.sort(key=lambda d: d["label"])
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Updated {manifest_path} ({len(manifest)} dataset(s))")

    # Report unmapped cities
    coords_path = DATA_DIR / "city_coords.json"
    coords = {}
    if coords_path.exists():
        coords = json.loads(coords_path.read_text(encoding="utf-8"))
    unmapped = {}
    for row in rows:
        city = (row.get("event_city") or "").strip()
        if not city:
            continue
        key = city.lower()
        if key not in coords:
            unmapped[city] = unmapped.get(city, 0) + 1
    if unmapped:
        print("\nCities not yet in data/city_coords.json (add them by hand):")
        for city, n in sorted(unmapped.items(), key=lambda kv: -kv[1]):
            print(f"  {n:>3}  {city!r}")
    else:
        print("\nAll non-blank event_city values are covered by city_coords.json.")


if __name__ == "__main__":
    main()
