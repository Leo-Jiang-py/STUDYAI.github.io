// api/chat.js (temporarily disabled)
// This route now returns 503 for all requests so the chat backend is effectively disabled.

export default async function handler(req, res) {
  // Allow simple preflight and basic CORS so the frontend receives a clear response
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Immediately return a clear "disabled" response
  return res.status(503).json({
    error: 'Chat is temporarily disabled by the site owner.',
    code: 'chat_disabled'
  });
}
