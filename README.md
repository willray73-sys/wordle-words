# wordle-words

A public dataset and tiny pipeline that tracks **all 5-letter words accepted by Wordle** and flags which have **already been used** as answers.

- **Allowed list**: pulled from community mirrors of the in-game dictionary (e.g., Tab Atkins’ `wordle-list`).
- **Used answers**: scraped from multiple archives (e.g., TechRadar, WordFinder) and cross-checked.
- **Artifacts**: JSON & CSV in `/data` (also mirrored in `/public` for static hosting).
- **Updates**: GitHub Actions runs daily to refresh and commit changes.

> Owner: `willray73-sys`

## What you get

- `data/allowed.json` – all accepted guess words (lowercase, 5 letters)
- `data/used.json` – answers that *have* appeared (by word; optionally date/No. when available)
- `data/allowed_not_used.json` – the difference (never used as answers yet)
- `data/words.csv` – convenient combined CSV with a boolean `is_used`

## How it works

1. **Fetch allowed list** from a well-known mirror of Wordle's accepted guesses.
2. **Fetch used answers** from two independent sources (primary & secondary).
3. **Normalize** (lowercase, 5 letters), **cross-check** and **diff**.
4. **Emit** JSON/CSV artifacts. If artifacts changed, CI commits them.

By default the workflow runs daily at **05:12 UTC**, which is after midnight in **America/Toronto** most of the year. Adjust in `.github/workflows/update.yml` if you like.

## Quick start (local)

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python src/fetch_wordle_data.py
```

Outputs land in `data/` and are mirrored to `public/`.

## Optional: serve as a static “API”

If you enable GitHub Pages (root `/public`), you’ll get static endpoints like:

- `/allowed.json`
- `/used.json`
- `/allowed_not_used.json`

Or deploy the included minimal FastAPI app to Vercel/Render and serve endpoints dynamically.

## Sources (at runtime)

- Allowed list (guess dictionary): Tab Atkins’s `wordle-list`.
- Used answers: TechRadar, WordFinder (cross-checked).

> This project is **community-derived** and not affiliated with The New York Times or Wordle. Respect their IP and terms; this repo provides factual lists with attribution.

## License

MIT – see `LICENSE`.
