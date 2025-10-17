# src/fetch_wordle_data.py
"""
Fetches:
- allowed guess list (community mirror of Wordle dictionary)
- used answers (cross-check from two sources)
Then writes artifacts to /data and mirrors to /public.
"""

import json, csv, hashlib, os, sys, time
from datetime import date
import requests

from parse import normalize_words, parse_techradar, parse_wordfinder
from sources import ALLOWED_URLS, USED_SOURCES

ROOT = os.path.dirname(os.path.dirname(__file__))
DATA_DIR = os.path.join(ROOT, "data")
PUBLIC_DIR = os.path.join(ROOT, "public")
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(PUBLIC_DIR, exist_ok=True)

def fetch_allowed() -> set:
    last_exc = None
    for url in ALLOWED_URLS:
        try:
            r = requests.get(url, timeout=30)
            r.raise_for_status()
            lines = [line.strip() for line in r.text.splitlines() if line.strip()]
            return normalize_words(lines)
        except Exception as e:
            last_exc = e
    raise RuntimeError(f"Failed to fetch allowed list. Last error: {last_exc}")

def fetch_used() -> set:
    used_sets = []
    # TechRadar
    try:
        html = requests.get(USED_SOURCES["techradar"], timeout=30).text
        used_sets.append(parse_techradar(html))
    except Exception as e:
        print(f"[warn] techradar fetch/parse failed: {e}", file=sys.stderr)

    # WordFinder
    try:
        html = requests.get(USED_SOURCES["wordfinder"], timeout=30).text
        used_sets.append(parse_wordfinder(html))
    except Exception as e:
        print(f"[warn] wordfinder fetch/parse failed: {e}", file=sys.stderr)

    if not used_sets:
        raise RuntimeError("No used-answers sources could be parsed.")

    # Strategy: intersection for safety; if very small, fallback to union
    inter = set.intersection(*used_sets) if len(used_sets) > 1 else used_sets[0]
    if len(inter) < 100:  # heuristic: if too small, prefer union (structures change)
        union = set().union(*used_sets)
        print(f"[info] intersection too small ({len(inter)}), using union {len(union)}")
        return union
    return inter

def write_json(path, payload):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)

def checksum(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        h.update(f.read())
    return "sha256:" + h.hexdigest()

def mirror_to_public(filename):
    src = os.path.join(DATA_DIR, filename)
    dst = os.path.join(PUBLIC_DIR, filename)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with open(src, "rb") as s, open(dst, "wb") as d:
        d.write(s.read())

def main():
    today = date.today().isoformat()

    allowed = fetch_allowed()
    used = fetch_used()

    # Sanity filter: only keep 5-letter words in 'used' that are also guessable
    used = used & allowed

    allowed_not_used = sorted(allowed - used)

    # Write JSON artifacts
    write_json(os.path.join(DATA_DIR, "allowed.json"),
               {"generated": today, "count": len(allowed), "words": sorted(allowed)})
    write_json(os.path.join(DATA_DIR, "used.json"),
               {"generated": today, "count": len(used), "words": sorted(used)})
    write_json(os.path.join(DATA_DIR, "allowed_not_used.json"),
               {"generated": today, "count": len(allowed_not_used), "words": allowed_not_used})

    # Write CSV
    all_words = sorted(allowed | used)
    with open(os.path.join(DATA_DIR, "words.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["word", "is_used", "generated"])
        used_set = set(used)
        for word in all_words:
            w.writerow([word, str(word in used_set).lower(), today])

    # Mirror to /public (so you can serve via GitHub Pages if you want)
    for fname in ("allowed.json", "used.json", "allowed_not_used.json"):
        mirror_to_public(fname)

    print(f"OK. allowed={len(allowed)} used={len(used)} diff={len(allowed_not_used)}")

if __name__ == "__main__":
    main()
