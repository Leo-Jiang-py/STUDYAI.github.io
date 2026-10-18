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
    let payload = { 
      model, 
      temperature: body.temperature || (mode === 'summarize' ? 0.3 : 0.5), 
      max_tokens: body.max_tokens || (mode === 'summarize' ? 3500 : 2500), 
      stream: shouldStream 
    };

    if (mode === 'summarize') {
      const source = body.source || body.text || '';
      const format = body.format || 'exhaustive';
      const level = body.level || 'max';

      payload.messages = [
        {
          role: 'system',
          content:
            'You are a world-class academic study assistant. Turn source content into an exhaustive, highly detailed, multi-section study breakdown using Markdown headers (##, ###). Include thorough descriptions, key terms, and review questions.'
        },
        {
          role: 'user',
          content: `FORMAT: ${format}\nDEPTH LEVEL: ${level}\n\nSOURCE CONTENT:\n${source}`
        }
      ];
    } else {
      const messages = Array.isArray(body.messages) 
        ? body.messages 
        : [{ role: 'user', content: body.prompt || body.content || '' }];
      payload.messages = messages;
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
      return res.status(response.status).json({ error: errText || 'OpenAI API request failed.' });
    }

    // Handle Streaming Output (Streams pure text chunks directly to client)
    if (shouldStream && response.body) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete trailing lines in buffer

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (trimmedLine.startsWith('data: ') && trimmedLine !== 'data: [DONE]') {
            try {
              const parsed = JSON.parse(trimmedLine.slice(6));
              const text = parsed.choices[0]?.delta?.content || '';
              if (text) {
                res.write(text);
              }
            } catch (e) {
              // Ignore partial JSON lines
            }
          }
        }
      }

      res.end();
      return;
    }

    // Handle Non-Streaming JSON Response
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || '';
    return res.status(200).json({ ok: true, content, choices: data?.choices });

  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unexpected server error.' });
  }
}
