// Server-side RSS proxy — bypasses CORS for the browser and restricts
// fetches to a fixed allowlist so this endpoint can't be used as an
// open proxy for arbitrary URLs.
const ALLOWED_FEEDS = new Set([
  'https://feeds.bbci.co.uk/sport/football/teams/chelsea/rss.xml',
  'https://www.theguardian.com/football/chelsea/rss',
]);

module.exports = async (req, res) => {
  const url = req.query.url;
  if (!url || !ALLOWED_FEEDS.has(url)) {
    res.status(400).json({ error: 'feed not allowed' });
    return;
  }

  try {
    const upstream = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CFCBlueBridgeBot/1.0)' },
    });
    if (!upstream.ok) {
      res.status(502).json({ error: 'upstream error', status: upstream.status });
      return;
    }
    const text = await upstream.text();
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600');
    res.status(200).send(text);
  } catch (err) {
    res.status(502).json({ error: 'fetch failed' });
  }
};
