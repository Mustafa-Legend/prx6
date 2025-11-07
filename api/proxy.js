const axios = require('axios');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { URL } = require('url');

// Configure axios with better defaults for serverless
const axiosInstance = axios.create({
  timeout: 100000, // 10 second timeout
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

// دالة لتحويل روابط Proxy إلى روابط مباشرة
const convertProxyToDirect = (proxyUrl, baseDomain = 'https://prx8.vercel.app') => {
  try {
    // إذا كانت الرابط ليس رابط proxy، تركه كما هو
    if (!proxyUrl.includes('/api/proxy?url=')) {
      return proxyUrl;
    }
    
    // استخراج الرابط الأصلي من رابط الـ proxy
    const urlObj = new URL(proxyUrl, baseDomain);
    const originalUrl = urlObj.searchParams.get('url');
    
    if (originalUrl) {
      return decodeURIComponent(originalUrl);
    }
    
    return proxyUrl;
  } catch {
    return proxyUrl;
  }
};

// دالة لمعالجة HTML وتحويل روابط Proxy إلى روابط مباشرة
const processHtmlContent = (html, baseDomain) => {
  let processedHtml = html;
  
  // تحويل روابط CSS من Proxy إلى مباشر
  processedHtml = processedHtml.replace(/<link([^>]*?)href=(["'])(.*?)\2/gi, (match, attrs, quote, href) => {
    if (href) {
      const directUrl = convertProxyToDirect(href, baseDomain);
      return `<link${attrs}href=${quote}${directUrl}${quote}`;
    }
    return match;
  });
  
  // تحويل روابط الصور من Proxy إلى مباشر
  processedHtml = processedHtml.replace(/<img([^>]*?)src=(["'])(.*?)\2/gi, (match, attrs, quote, src) => {
    if (src) {
      const directUrl = convertProxyToDirect(src, baseDomain);
      return `<img${attrs}src=${quote}${directUrl}${quote}`;
    }
    return match;
  });
  
  // تحويل روابط JavaScript من Proxy إلى مباشر
  processedHtml = processedHtml.replace(/<script([^>]*?)src=(["'])(.*?)\2/gi, (match, attrs, quote, src) => {
    if (src) {
      const directUrl = convertProxyToDirect(src, baseDomain);
      return `<script${attrs}src=${quote}${directUrl}${quote}`;
    }
    return match;
  });
  
  // تحويل روابط srcset
  processedHtml = processedHtml.replace(/srcset=(["'])(.*?)\1/gi, (match, quote, srcset) => {
    const newSrcset = srcset.split(',').map(part => {
      const trimmed = part.trim();
      const url = trimmed.split(/\s+/)[0];
      if (url) {
        const directUrl = convertProxyToDirect(url, baseDomain);
        return trimmed.replace(url, directUrl);
      }
      return trimmed;
    }).join(', ');
    return `srcset=${quote}${newSrcset}${quote}`;
  });
  
  // تحويل روابط الفيديو والصوت
  processedHtml = processedHtml.replace(/<source([^>]*?)src=(["'])(.*?)\2/gi, (match, attrs, quote, src) => {
    if (src) {
      const directUrl = convertProxyToDirect(src, baseDomain);
      return `<source${attrs}src=${quote}${directUrl}${quote}`;
    }
    return match;
  });
  
  // تحويل روابط الـ favicon
  processedHtml = processedHtml.replace(/<link([^>]*?)rel=(["'])[^"']*icon[^"']*\2([^>]*?)href=(["'])(.*?)\4/gi, (match, attrs1, quote1, attrs2, quote2, href) => {
    if (href) {
      const directUrl = convertProxyToDirect(href, baseDomain);
      return `<link${attrs1}rel=${quote1}icon${quote1}${attrs2}href=${quote2}${directUrl}${quote2}`;
    }
    return match;
  });
  
  return processedHtml;
};

// دالة لمعالجة محتوى CSS
const processCssContent = (css, baseDomain) => {
  return css.replace(/url\((['"]?)(.*?)\1\)/gi, (match, quote, url) => {
    if (url && !url.startsWith('data:') && !url.startsWith('#') && !url.startsWith('blob:')) {
      const directUrl = convertProxyToDirect(url, baseDomain);
      return `url(${quote}${directUrl}${quote})`;
    }
    return match;
  });
};

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

    // 🚫 API KEY VALIDATION REMOVED - No authentication required
    
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
    delete forwardHeaders['x-api-key']; // Still remove if sent, but don't validate
    delete forwardHeaders['content-length']; // Let axios calculate this

    const axiosOptions = {
      method: req.method,
      url: targetUrl,
      headers: forwardHeaders,
      data: req.body,
      responseType: 'arraybuffer', // Changed back to arraybuffer for content processing
      timeout: 8000, // Slightly less than function timeout
      httpAgent: agent,
      httpsAgent: agent
    };

    // Remove body for GET/HEAD requests
    if (req.method === 'GET' || req.method === 'HEAD') {
      delete axiosOptions.data;
    }

    const response = await axiosInstance(axiosOptions);

    const contentType = response.headers['content-type'] || '';
    let responseData = response.data;

    // إذا كان المحتوى HTML، قم بمعالجته لتحويل روابط Proxy إلى مباشرة
    if (contentType.includes('text/html')) {
      try {
        const htmlContent = Buffer.from(responseData).toString('utf8');
        const processedHtml = processHtmlContent(htmlContent, 'https://prx8.vercel.app');
        responseData = Buffer.from(processedHtml, 'utf8');
        
        // تحديث طول المحتوى بعد المعالجة
        response.headers['content-length'] = Buffer.byteLength(responseData);
      } catch (htmlError) {
        console.error('Error processing HTML:', htmlError.message);
        // استمر بالمحتوى الأصلي في حالة الخطأ
      }
    }

    // إذا كان المحتوى CSS، قم بمعالجة روابط url()
    if (contentType.includes('text/css')) {
      try {
        const cssContent = Buffer.from(responseData).toString('utf8');
        const processedCss = processCssContent(cssContent, 'https://prx8.vercel.app');
        responseData = Buffer.from(processedCss, 'utf8');
        response.headers['content-length'] = Buffer.byteLength(responseData);
      } catch (cssError) {
        console.error('Error processing CSS:', cssError.message);
      }
    }

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

    res.status(response.status).send(responseData);

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
