export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Missing OPENAI_API_KEY environment variable.' });
  }

  const body = req.body || {};
  const mode = body.mode || 'chat';
  const model = body.model || 'gpt-4o-mini';
  const shouldStream = body.stream !== false && (body.stream === true || body.streaming === true || mode === 'chat' || mode === 'summarize');

  try {
    let payload = { model, temperature: 0.2, max_tokens: 1200, stream: shouldStream };

    if (mode === 'summarize') {
      const source = body.source || '';
      const format = body.format || 'bullets';
      const level = body.level || 'balanced';

      payload.messages = [
        {
          role: 'system',
          content:
            'You are a study assistant. Turn the source content into concise study notes. Return exactly the structure below, no extra commentary. ===HTML_START=== [valid HTML fragment] ===HTML_END=== ===TEXT_START=== [plain text notes] ===TEXT_END===' 
        },
        {
          role: 'user',
          content: `FORMAT: ${format}\nCONCISENESS: ${level}\n\nSOURCE:\n${source}`
        }
      ];
    } else {
      const messages = Array.isArray(body.messages) ? body.messages : [{ role: 'user', content: body.prompt || '' }];
      payload.messages = messages;
      payload.max_tokens = body.max_tokens || 800;
      payload.temperature = body.temperature || 0.3;
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: errText || 'OpenAI request failed' });
    }

    if (shouldStream && response.body) {
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        res.write(chunk);
      }

      res.end();
      return;
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || '';
    return res.status(200).json({ ok: true, content });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unexpected server error.' });
  }
}
