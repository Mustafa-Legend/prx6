const axios = require('axios');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { URL } = require('url');

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

const agent = createAgentIfNeeded();

module.exports = async (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-API-KEY');
    if (req.method === 'OPTIONS') return res.status(204).end();

    const requiredKey = process.env.API_KEY;
    if (requiredKey) {
      const clientKey = req.headers['x-api-key'];
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
