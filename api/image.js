// Server-side image proxy — lets the poster canvas draw news thumbnails
// without tainting (the source CDNs don't send CORS headers). Restricted
// to an allowlist of known news-image hosts, https only, to avoid this
// becoming an open proxy / SSRF vector.
const ALLOWED_HOST_PATTERNS = [
  /(^|\.)bbci\.co\.uk$/,
  /(^|\.)bbc\.co\.uk$/,
  /(^|\.)guim\.co\.uk$/,
  /(^|\.)theguardian\.com$/,
  /(^|\.)caughtoffside\.com$/,
  /(^|\.)substackcdn\.com$/,
  /^substack-post-media\.s3\.amazonaws\.com$/,
];

module.exports = async (req, res) => {
  const raw = req.query.url;
  if (!raw) {
    res.status(400).json({ error: 'missing url' });
    return;
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    res.status(400).json({ error: 'bad url' });
    return;
  }

  if (parsed.protocol !== 'https:' || !ALLOWED_HOST_PATTERNS.some((rx) => rx.test(parsed.hostname))) {
    res.status(400).json({ error: 'host not allowed' });
    return;
  }

  try {
    const upstream = await fetch(parsed.toString());
    if (!upstream.ok) {
      res.status(502).json({ error: 'upstream error', status: upstream.status });
      return;
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    res.status(200).send(buf);
  } catch (err) {
    res.status(502).json({ error: 'fetch failed' });
  }
};
