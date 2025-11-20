const axios = require('axios');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { URL } = require('url');

// Axios instance مع إعدادات محسنة
const axiosInstance = axios.create({
  timeout: 100000,
  maxContentLength: 10485760,
  maxBodyLength: 10485760,
  validateStatus: () => true
});

// إنشاء agent للبروكسي إذا كان محدد
const createAgentIfNeeded = () => {
  const upstream = process.env.UPSTREAM_SOCKS5 || null;
  if (!upstream) return null;
  return new SocksProxyAgent(upstream);
};

const agent = createAgentIfNeeded();

// التحقق من الـ allowed hosts
const isAllowedHost = (hostname) => {
  const raw = process.env.ALLOWED_HOSTS || '';
  if (!raw) return true;
  const list = raw.split(',').map(s => s.trim()).filter(Boolean);
  return list.includes(hostname);
};

// تحويل روابط proxy إلى مباشرة
const convertProxyToDirect = (proxyUrl, baseDomain = 'https://prx8.vercel.app') => {
  try {
    if (!proxyUrl.includes('/api/proxy?url=')) return proxyUrl;
    const urlObj = new URL(proxyUrl, baseDomain);
    const originalUrl = urlObj.searchParams.get('url');
    return originalUrl ? decodeURIComponent(originalUrl) : proxyUrl;
  } catch {
    return proxyUrl;
  }
};

// معالجة HTML
const processHtmlContent = (html, baseDomain) => {
  let processedHtml = html;

  // روابط CSS
  processedHtml = processedHtml.replace(/<link([^>]*?)href=(["'])(.*?)\2/gi, (m, a, q, h) =>
    h ? `<link${a}href=${q}${convertProxyToDirect(h, baseDomain)}${q}` : m
  );

  // صور
  processedHtml = processedHtml.replace(/<img([^>]*?)src=(["'])(.*?)\2/gi, (m, a, q, s) =>
    s ? `<img${a}src=${q}${convertProxyToDirect(s, baseDomain)}${q}` : m
  );

  // JavaScript
  processedHtml = processedHtml.replace(/<script([^>]*?)src=(["'])(.*?)\2/gi, (m, a, q, s) =>
    s ? `<script${a}src=${q}${convertProxyToDirect(s, baseDomain)}${q}` : m
  );

  // srcset
  processedHtml = processedHtml.replace(/srcset=(["'])(.*?)\1/gi, (m, q, v) => {
    const newSrcset = v.split(',').map(p => {
      const trimmed = p.trim();
      const url = trimmed.split(/\s+/)[0];
      return url ? trimmed.replace(url, convertProxyToDirect(url, baseDomain)) : trimmed;
    }).join(', ');
    return `srcset=${q}${newSrcset}${q}`;
  });

  // فيديو/صوت
  processedHtml = processedHtml.replace(/<source([^>]*?)src=(["'])(.*?)\2/gi, (m, a, q, s) =>
    s ? `<source${a}src=${q}${convertProxyToDirect(s, baseDomain)}${q}` : m
  );

  // favicon
  processedHtml = processedHtml.replace(/<link([^>]*?)rel=(["'])[^"']*icon[^"']*\2([^>]*?)href=(["'])(.*?)\4/gi, (m, a1, q1, a2, q2, h) =>
    h ? `<link${a1}rel=${q1}icon${q1}${a2}href=${q2}${convertProxyToDirect(h, baseDomain)}${q2}` : m
  );

  return processedHtml;
};

// معالجة CSS
const processCssContent = (css, baseDomain) => {
  return css.replace(/url\((['"]?)(.*?)\1\)/gi, (m, q, u) => {
    if (u && !u.startsWith('data:') && !u.startsWith('#') && !u.startsWith('blob:')) {
      return `url(${q}${convertProxyToDirect(u, baseDomain)}${q})`;
    }
    return m;
  });
};

// الدالة الأساسية للـ proxy
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-API-KEY,X-Facebook-Cookies');
    return res.status(204).end();
  }

  try {
    res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');

    const targetUrl = req.query.url || req.headers['x-target-url'];
    if (!targetUrl) return res.status(400).json({ error: 'Missing target URL (?url=)' });

    let parsed;
    try { parsed = new URL(targetUrl); } catch { return res.status(400).json({ error: 'Invalid target URL' }); }

    if (!isAllowedHost(parsed.hostname)) return res.status(403).json({ error: 'Host not allowed by ALLOWED_HOSTS' });

    const forwardHeaders = { ...req.headers };
    delete forwardHeaders.host;
    delete forwardHeaders['x-forwarded-for'];
    delete forwardHeaders['x-api-key'];
    delete forwardHeaders['content-length'];

    // إضافة كوكيز فيسبوك إذا تم إرسالها
    if (req.headers['x-facebook-cookies']) {
      forwardHeaders['cookie'] = req.headers['x-facebook-cookies'];
    }

    const axiosOptions = {
      method: req.method,
      url: targetUrl,
      headers: forwardHeaders,
      data: req.body,
      responseType: 'arraybuffer',
      timeout: 8000,
      httpAgent: agent,
      httpsAgent: agent
    };

    if (req.method === 'GET' || req.method === 'HEAD') delete axiosOptions.data;

    const response = await axiosInstance(axiosOptions);
    const contentType = response.headers['content-type'] || '';
    let responseData = response.data;

    if (contentType.includes('text/html')) {
      try {
        const htmlContent = Buffer.from(responseData).toString('utf8');
        responseData = Buffer.from(processHtmlContent(htmlContent, 'https://prx8.vercel.app'), 'utf8');
        response.headers['content-length'] = Buffer.byteLength(responseData);
      } catch (err) { console.error('HTML processing error:', err.message); }
    }

    if (contentType.includes('text/css')) {
      try {
        const cssContent = Buffer.from(responseData).toString('utf8');
        responseData = Buffer.from(processCssContent(cssContent, 'https://prx8.vercel.app'), 'utf8');
        response.headers['content-length'] = Buffer.byteLength(responseData);
      } catch (err) { console.error('CSS processing error:', err.message); }
    }

    const excludedHeaders = [
      'connection', 'keep-alive', 'proxy-authenticate',
      'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'
    ];

    Object.entries(response.headers).forEach(([key, value]) => {
      if (!excludedHeaders.includes(key.toLowerCase())) res.setHeader(key, value);
    });

    res.status(response.status).send(responseData);

  } catch (err) {
    console.error('Proxy error:', err.message);
    if (err.code === 'ECONNABORTED') return res.status(504).json({ error: 'Upstream request timeout' });
    if (err.response) return res.status(502).json({ error: 'Upstream request failed', detail: `${err.response.status}: ${err.message}` });
    res.status(502).json({ error: 'Upstream request failed', detail: err.message });
  }
};
