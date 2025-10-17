# src/sources.py
# Centralized endpoints and constants

ALLOWED_URLS = [
    # Community mirror of the accepted guess dictionary
    # If the first fails, later ones can be tried.
    "https://raw.githubusercontent.com/tabatkins/wordle-list/main/words",
]

# Sites that list past Wordle answers (used solutions)
# We pull at least two and cross-check.
USED_SOURCES = {
    "techradar": "https://www.techradar.com/news/past-wordle-answers",
    "wordfinder": "https://wordfinder.yourdictionary.com/wordle/answers/",
}

# Optional: allow a date threshold (e.g., do not accept 'future' solutions)
# None means disabled
DATE_FENCE = None  # e.g., "2025-10-16"
