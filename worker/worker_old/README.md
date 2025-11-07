# Cloudflare Worker API for wordle-words

A tiny API that serves dynamic endpoints over the static dataset in your `wordle-words` repo.

## Endpoints

- `GET /v1/words?is_used=true|false&q=pat&limit=100&offset=0`
- `GET /v1/words/{word}`
- `GET /v1/stats`

CORS is open (`*`). Responses cache for 1 hour at the edge.

## Deploy

```bash
npm i -g wrangler
wrangler login
wrangler deploy
```
Edit `index.js` if your GitHub username/repo differs.
