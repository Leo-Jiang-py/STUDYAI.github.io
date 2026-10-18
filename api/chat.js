export default async function handler(req, res) {
  // Allow cross-origin requests if needed
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENAI_API_KEY environment variable is not configured on Vercel.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const messages = Array.isArray(body.messages) ? body.messages : [{ role: 'user', content: body.prompt || '' }];
    
    // Increased default token limit to support long-form exhaustive study notes
    const max_tokens = body.max_tokens || 4000;
    const temperature = body.temperature ?? 0.5;
    const model = body.model || 'gpt-4o-mini';

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens,
        temperature,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ 
        error: data.error?.message || 'OpenAI API Error',
        details: data
      });
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error('api/chat error:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}
