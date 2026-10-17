# LeoJStudyLens AI

This repo contains a static study-notes app with optional OpenAI-powered summarization and chat support.

## Files

- `index.html` — study notes app UI and client logic
- `api/openai.js` — Vercel serverless route for secure OpenAI requests

## Secure Vercel setup

1. Connect this repo to Vercel.
2. Add the environment variable:
   - `OPENAI_API_KEY=your_openai_key_here`
3. Deploy the app.
4. Open the deployed site and use the chat/summarization features normally.

## How the app works

- The frontend calls `/api/openai` when available.
- The Vercel function keeps the OpenAI API key on the server and forwards requests securely.
- If a local browser key is present and the server route is unavailable, the page falls back to a direct browser call for local testing.

## Local testing

You can test the interface locally by entering your API key in the UI from the browser. This is convenient for local work, but for real deployment it is better to use the Vercel server route and environment variable.

## OpenAI request examples

### Summarize example

```bash
curl -X POST "https://<your-vercel-app>.vercel.app/api/openai" \
  -H "Content-Type: application/json" \
  -d '{
    "mode":"summarize",
    "format":"bullets",
    "level":"balanced",
    "source":"Your source text goes here...",
    "model":"gpt-4o-mini"
  }'
```

### Chat example

```bash
curl -X POST "https://<your-vercel-app>.vercel.app/api/openai" \
  -H "Content-Type: application/json" \
  -d '{
    "mode":"chat",
    "model":"gpt-4o-mini",
    "messages":[
      {"role":"system","content":"You are a helpful study assistant."},
      {"role":"user","content":"Explain photosynthesis in 3 bullet points."}
    ],
    "temperature":0.3,
    "max_tokens":800
  }'
```

## Notes

- The browser stores API keys in localStorage only for quick local testing.
- Production deployments should prefer the Vercel server route and secret environment variable.
- The UI removes the site URL footer as requested.
