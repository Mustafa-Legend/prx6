const axios = require('axios');
const { SocksProxyAgent } = require('socks-proxy-agent');

// Configure axios with better defaults for serverless
const axiosInstance = axios.create({
  timeout: 10000, // 10 second timeout
  maxContentLength: 10485760, // 10MB limit
  maxBodyLength: 10485760,
  validateStatus: () => true
});

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
  // Immediate response for OPTIONS
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-API-KEY');
    return res.status(204).end();
  }

  try {
    res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');

    // API Key validation
    const requiredKey = process.env.API_KEY;
    if (requiredKey) {
      const clientKey = req.headers['x-api-key'];
      if (!clientKey || clientKey !== requiredKey) {
        return res.status(403).json({ error: 'Invalid or missing API key' });
      }
    }

    // URL validation
    const targetUrl = req.query.url || req.headers['x-target-url'];
    if (!targetUrl) {
      return res.status(400).json({ error: 'Missing target URL (?url=)' });
    }

    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return res.status(400).json({ error: 'Invalid target URL' });
    }

    if (!isAllowedHost(parsed.hostname)) {
      return res.status(403).json({ error: 'Host not allowed by ALLOWED_HOSTS' });
    }

    // Prepare request
    const forwardHeaders = { ...req.headers };
    delete forwardHeaders.host;
    delete forwardHeaders['x-forwarded-for'];
    delete forwardHeaders['x-api-key'];
    delete forwardHeaders['content-length']; // Let axios calculate this

    const axiosOptions = {
      method: req.method,
      url: targetUrl,
      headers: forwardHeaders,
      data: req.body,
      responseType: 'stream', // Stream response to avoid memory issues
      timeout: 8000, // Slightly less than function timeout
      httpAgent: agent,
      httpsAgent: agent
    };

    // Remove body for GET/HEAD requests
    if (req.method === 'GET' || req.method === 'HEAD') {
      delete axiosOptions.data;
    }

    const response = await axiosInstance(axiosOptions);

    // Set response headers
    const excludedHeaders = [
      'connection', 'keep-alive', 'proxy-authenticate',
      'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'
    ];
    
    Object.entries(response.headers).forEach(([key, value]) => {
      const lowerKey = key.toLowerCase();
      if (!excludedHeaders.includes(lowerKey)) {
        res.setHeader(key, value);
      }
    });

    res.status(response.status);
    
    // Stream the response instead of buffering
    response.data.pipe(res);

  } catch (err) {
    console.error('Proxy error:', err.message);
    
    if (err.code === 'ECONNABORTED') {
      return res.status(504).json({ error: 'Upstream request timeout' });
    }
    if (err.response) {
      return res.status(502).json({ 
        error: 'Upstream request failed', 
        detail: `${err.response.status}: ${err.message}`
      });
    }
    
    res.status(502).json({ 
      error: 'Upstream request failed', 
      detail: err.message 
    });
  }
};
