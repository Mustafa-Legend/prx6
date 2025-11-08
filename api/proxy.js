const axios = require('axios');

// Simplified axios instance for serverless
const axiosInstance = axios.create({
  timeout: 8000,
  maxRedirects: 5,
  validateStatus: () => true
});

module.exports = async (req, res) => {
  // Handle OPTIONS immediately
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-API-KEY');
    return res.status(204).end();
  }

  try {
    res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');

    // URL validation
    const targetUrl = req.query.url || req.headers['x-target-url'];
    if (!targetUrl) {
      return res.status(400).json({ error: 'Missing target URL (?url=)' });
    }

    // Simple request without proxy
    const response = await axiosInstance({
      method: req.method,
      url: targetUrl,
      headers: {
        ...req.headers,
        host: undefined, // Remove host header
        'x-forwarded-for': undefined,
      },
      data: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
      responseType: 'arraybuffer'
    });

    // Forward response
    Object.entries(response.headers).forEach(([key, value]) => {
      if (!['connection', 'keep-alive'].includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

    return res.status(response.status).send(response.data);

  } catch (err) {
    console.error('Proxy error:', err.message);
    
    if (err.code === 'ECONNABORTED' || err.message.includes('timeout')) {
      return res.status(504).json({ error: 'Request timeout' });
    }
    
    return res.status(502).json({ 
      error: 'Upstream request failed', 
      detail: err.message 
    });
  }
};
