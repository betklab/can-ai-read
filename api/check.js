import { runCheck } from '../lib/check.js';
import { BlockedTarget } from '../lib/net.js';

// GET /api/check?url=example.com
export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  const url = (req.query && req.query.url) || new URL(req.url, 'http://x').searchParams.get('url');
  try {
    const result = await runCheck(url);
    res.status(200).json(result);
  } catch (e) {
    if (e instanceof BlockedTarget) return res.status(400).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Something went wrong while checking that site.' });
  }
}
