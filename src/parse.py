# src/parse.py
import re
from bs4 import BeautifulSoup

W5 = re.compile(r"^[a-z]{5}$")

def normalize_words(words):
    out = set()
    for w in words:
        w = (w or "").strip().lower()
        if W5.match(w):
            out.add(w)
    return out

def extract_words_from_html(html: str) -> set:
    """
    Fallback parser: extract all 5-letter tokens from HTML text.
    Use as a last resort if structure-specific parsing fails.
    """
    tokens = set(m.group(0) for m in re.finditer(r"\b[a-zA-Z]{5}\b", html or ""))
    return normalize_words(tokens)

def parse_techradar(html: str) -> set:
    """
    Try to parse TechRadar's 'Past Wordle answers' page.
    We attempt structure-aware parsing first, then fallback to regex tokens.
    """
    soup = BeautifulSoup(html, "lxml")
    candidates = set()

    # TechRadar often uses <li> or table-like sections; gather text nodes
    for el in soup.select("li, p, td, strong, em, span"):
        text = (el.get_text(" ", strip=True) or "").lower()
        for m in re.finditer(r"\b[a-z]{5}\b", text):
            candidates.add(m.group(0))

    # Fallback
    if not candidates:
        candidates = extract_words_from_html(html)
    return normalize_words(candidates)

def parse_wordfinder(html: str) -> set:
    """
    Parse WordFinder's archive page. Similar approach.
    """
    soup = BeautifulSoup(html, "lxml")
    candidates = set()
    for el in soup.select("li, p, td, strong, em, span, a"):
        text = (el.get_text(" ", strip=True) or "").lower()
        for m in re.finditer(r"\b[a-z]{5}\b", text):
            candidates.add(m.group(0))
    if not candidates:
        candidates = extract_words_from_html(html)
    return normalize_words(candidates)
