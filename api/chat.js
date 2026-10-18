// api/chat.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Missing OPENAI_API_KEY on the server. Add it in Vercel project settings.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const model = body.model || 'gpt-4o-mini';
    const messages = Array.isArray(body.messages)
      ? body.messages
      : [{ role: 'user', content: body.prompt || 'Hello' }];

    const openAiResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: body.temperature ?? 0.7,
        max_tokens: body.max_tokens ?? 800,
        stream: false
      })
    });

    const data = await openAiResp.json();

    if (!openAiResp.ok) {
      return res.status(openAiResp.status).json({
        error: data?.error?.message || 'OpenAI request failed',
        details: data
      });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error('api/chat error:', err);
    return res.status(500).json({ error: err.message || 'Unexpected server error' });
  }
}
