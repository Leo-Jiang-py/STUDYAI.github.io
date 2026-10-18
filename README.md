# LeoJStudyLens AI

This repository contains a static study-notes app with optional OpenAI-powered summarization and chat support.

## Files

- `index.html` — study notes app UI and client logic
- `api/chat.js` — Vercel serverless endpoint that keeps the OpenAI API key on the server

## Why the browser cannot safely use an API key

The app used to send requests directly to OpenAI from the browser. That is not safe for a public static website because:

- the key would be exposed to anyone viewing the page code or browser storage
- the browser would often hit CORS / fetch errors on GitHub Pages or static-hosted sites
- a production app should never ship a secret key in client-side JavaScript

The secure pattern is:

- browser calls your own backend route like `/api/chat`
- backend stores `OPENAI_API_KEY` in Vercel environment variables
- backend forwards the request to OpenAI 
- OpenAI response is returned to the browser without exposing the key

## Vercel deployment setup

1. Push this repo to GitHub.
2. Import the repo into Vercel.
3. In Vercel, open the project → Settings → Environment Variables.
4. Add:
   - `OPENAI_API_KEY=your_openai_key_here`
5. Deploy the project.
6. Visit the live URL and use the AI features normally.

## Serverless function for Vercel

Create a file at `api/chat.js` with this code:

```javascript
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'Missing OPENAI_API_KEY on the server. Add it in Vercel settings.'
    });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const model = body.model || 'gpt-4o-mini';
    const messages = Array.isArray(body.messages)
      ? body.messages
      : [{ role: 'user', content: 'Hello' }];

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.7,
        stream: false
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || 'OpenAI request failed',
        details: data
      });
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error('AI proxy error:', error);
    return res.status(500).json({
      error: error.message || 'Unexpected server error'
    });
  }
}
```

## Frontend call pattern

The browser should call the Vercel route instead of OpenAI directly:

```javascript
const response = await fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'You are a helpful study assistant.' },
      { role: 'user', content: 'Explain photosynthesis in 3 bullet points.' }
    ]
  })
});
```

## Local testing mode

The page includes a demo fallback for local static use when no backend route is configured. That is useful for testing the UI, but it is not a production-safe way to use OpenAI.

## Notes

- Do not store OpenAI keys in `localStorage` for production use.
- Do not put a secret key inside `index.html`.
- Use Vercel environment variables and a secure backend proxy for deployed apps.
- This repo is intended for static hosting plus serverless AI processing.
