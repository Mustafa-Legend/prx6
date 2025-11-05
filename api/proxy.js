const axios = require('axios');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { URL } = require('url');

// Random user agents array
const randomUserAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/119.0.0.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPad; CPU OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.210 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.210 Mobile Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.210 Mobile Safari/537.36'
];

const createAgentIfNeeded = () => {
  const upstream = process.env.UPSTREAM_SOCKS5 || null;
  if (!upstream) return null;
  return new SocksProxyAgent(upstream);
};

const isAllowedHost = (hostname) => {
  const raw = process.env.ALLOWED_HOSTS || '';
  if (!raw) return true;
  const list = raw.split(',').map(s => s.trim()).filter(Boolean);
  return list.includes(hostname);
};

const getRandomUserAgent = () => {
  return randomUserAgents[Math.floor(Math.random() * randomUserAgents.length)];
};

const agent = createAgentIfNeeded();

module.exports = async (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-API-KEY');
    if (req.method === 'OPTIONS') return res.status(204).end();

    const requiredKey = process.env.API_KEY;
    if (requiredKey) {
      const clientKey = req.headers['mysecret123'];
      if (!clientKey || clientKey !== requiredKey) {
        return res.status(403).json({ error: 'Invalid or missing API key' });
      }
    }

    const targetUrl = req.query.url || req.headers['x-target-url'];
    if (!targetUrl) return res.status(400).json({ error: 'Missing target URL (?url=)' });

    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return res.status(400).json({ error: 'Invalid target URL' });
    }

    if (!isAllowedHost(parsed.hostname)) {
      return res.status(403).json({ error: 'Host not allowed by ALLOWED_HOSTS' });
    }

    const forwardHeaders = { ...req.headers };
    delete forwardHeaders.host;
    delete forwardHeaders['x-forwarded-for'];
    delete forwardHeaders['x-api-key'];
    
    // Add random user agent if no user-agent header is present
    if (!forwardHeaders['user-agent']) {
      forwardHeaders['user-agent'] = getRandomUserAgent();
    }

    const axiosOptions = {
      method: req.method,
      url: targetUrl,
      headers: forwardHeaders,
      data: req.body || undefined,
      responseType: 'arraybuffer',
      validateStatus: () => true
    };

    if (agent) {
      axiosOptions.httpAgent = agent;
      axiosOptions.httpsAgent = agent;
    }

    const response = await axios(axiosOptions);

    const excludedHeaders = [
      'connection', 'keep-alive', 'proxy-authenticate',
      'proxy-authorization', 'te', 'trailer',
      'transfer-encoding', 'upgrade'
    ];
    Object.entries(response.headers || {}).forEach(([k, v]) => {
      if (!excludedHeaders.includes(k.toLowerCase())) {
        res.setHeader(k, v);
      }
    });

    res.status(response.status).send(Buffer.from(response.data));
  } catch (err) {
    console.error('Proxy error:', err.message);
    res.status(502).json({ error: 'Upstream request failed', detail: err.message });
  }
};
