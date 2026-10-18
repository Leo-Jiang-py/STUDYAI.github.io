export default async function handler(req, res) {
  // 1. CORS Headers Setup
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  // 2. Validate API Key
  const authHeader = req.headers.authorization;
  const clientKey = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
  const apiKey = clientKey || process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'Missing OPENAI_API_KEY. Please set it in Vercel settings or enter it in the app.' });
  }

  const body = req.body || {};
  const mode = body.mode || 'chat';
  const model = body.model || 'gpt-4o-mini';
  const targetLanguage = body.language || 'auto';
  const shouldStream = body.stream === true;

  // 3. Map Language Codes to Prompt Instructions
  const languageNames = {
    en: 'English',
    es: 'Spanish',
    fr: 'French',
    de: 'German',
    zh: 'Simplified Chinese',
    ja: 'Japanese',
    auto: 'the same language as the input text'
  };

  const selectedLangName = languageNames[targetLanguage] || 'English';

  try {
    let payloadMessages = [];

    // Mode: Summarize / Study Notes Generation
    if (mode === 'summarize') {
      const source = body.source || body.text || '';
      const format = body.format || 'bullets';
      const level = body.level || 'balanced';

      payloadMessages = [
        {
          role: 'system',
          content: `You are LeoJStudyLens AI, a world-class academic assistant.
CRITICAL LANGUAGE INSTRUCTION: You MUST output all response content in ${selectedLangName}.
If the user provided text in another language, translate and summarize it into ${selectedLangName}.
Format output using clear Markdown headers (##, ###), bullet points (-), and bold key terms.`
        },
        {
          role: 'user',
          content: `STUDY FORMAT: ${format}\nCONCISENESS LEVEL: ${level}\nTARGET RESPONSE LANGUAGE: ${selectedLangName}\n\nSOURCE MATERIAL:\n${source}`
        }
      ];
    } else {
      // Mode: Interactive Chat / Q&A
      const incomingMessages = Array.isArray(body.messages) ? body.messages : [{ role: 'user', content: body.prompt || body.content || '' }];

      const systemInstruction = {
        role: 'system',
        content: `You are LeoJStudyLens AI study tutor. Always answer strictly in ${selectedLangName} regardless of the question language, unless explicitly requested otherwise.`
      };

      payloadMessages = [systemInstruction, ...incomingMessages];
    }

    const payload = {
      model,
      temperature: mode === 'summarize' ? 0.3 : 0.5,
      max_tokens: body.max_tokens || 3000,
      stream: shouldStream,
      messages: payloadMessages
    };

    // 4. Send request to OpenAI API
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `OpenAI Error: ${errText}` });
    }

    // 5. Handle Streaming Response
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
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (trimmedLine.startsWith('data: ') && trimmedLine !== 'data: [DONE]') {
            try {
              const parsed = JSON.parse(trimmedLine.slice(6));
              const textChunk = parsed.choices[0]?.delta?.content || '';
              if (textChunk) {
                res.write(textChunk);
              }
            } catch (e) {
              // Ignore partial JSON chunks
            }
          }
        }
      }

      res.end();
      return;
    }

    // 6. Handle Standard Non-Streaming Response
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || '';
    return res.status(200).json({ ok: true, content, choices: data?.choices });

  } catch (error) {
    return res.status(500).json({ error: error.message || 'Internal server error.' });
  }
}
