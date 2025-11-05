const axios = require('axios');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { URL } = require('url');
const cheerio = require('cheerio');

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

// دالة لتحويل الروابط إلى روابط proxy
const convertToProxyUrl = (originalUrl, baseUrl, proxyBase = '/api/proxy?url=') => {
  try {
    // إذا كانت الرابط بالفعل يستخدم الـ proxy، لا تقم بتحويله
    if (originalUrl.includes(proxyBase)) return originalUrl;
    
    const absoluteUrl = new URL(originalUrl, baseUrl).href;
    return proxyBase + encodeURIComponent(absoluteUrl);
  } catch {
    return originalUrl;
  }
};

// دالة لمعالجة HTML وتحويل الروابط
const processHtmlContent = (html, baseUrl) => {
  const $ = cheerio.load(html);
  
  // تحويل روابط CSS
  $('link[rel="stylesheet"]').each((i, elem) => {
    const href = $(elem).attr('href');
    if (href && !href.startsWith('data:')) {
      $(elem).attr('href', convertToProxyUrl(href, baseUrl));
    }
  });
  
  // تحويل روابط الصور
  $('img').each((i, elem) => {
    const src = $(elem).attr('src');
    if (src && !src.startsWith('data:')) {
      $(elem).attr('src', convertToProxyUrl(src, baseUrl));
    }
    
    // تحويل srcset للصور
    const srcset = $(elem).attr('srcset');
    if (srcset) {
      const newSrcset = srcset.split(',').map(part => {
        const [url, descriptor] = part.trim().split(/\s+/);
        if (url && !url.startsWith('data:')) {
          return convertToProxyUrl(url, baseUrl) + (descriptor ? ` ${descriptor}` : '');
        }
        return part;
      }).join(', ');
      $(elem).attr('srcset', newSrcset);
    }
  });
  
  // تحويل روابط JavaScript
  $('script').each((i, elem) => {
    const src = $(elem).attr('src');
    if (src && !src.startsWith('data:')) {
      $(elem).attr('src', convertToProxyUrl(src, baseUrl));
    }
  });
  
  // تحويل روابط الفيديو والصوت
  $('video source, audio source').each((i, elem) => {
    const src = $(elem).attr('src');
    if (src && !src.startsWith('data:')) {
      $(elem).attr('src', convertToProxyUrl(src, baseUrl));
    }
  });
  
  // تحويل روابط الـ favicon
  $('link[rel*="icon"]').each((i, elem) => {
    const href = $(elem).attr('href');
    if (href && !href.startsWith('data:')) {
      $(elem).attr('href', convertToProxyUrl(href, baseUrl));
    }
  });
  
  // تحويل روابط الـ @import في أنماط CSS المضمنة
  $('style').each((i, elem) => {
    let cssContent = $(elem).html();
    if (cssContent) {
      cssContent = cssContent.replace(/@import\s+url\(['"]?([^'")]+)['"]?\);/g, (match, url) => {
        return `@import url("${convertToProxyUrl(url, baseUrl)}");`;
      });
      cssContent = cssContent.replace(/url\(['"]?([^'")]+)['"]?\)/g, (match, url) => {
        if (!url.startsWith('data:') && !url.startsWith('#') && !url.startsWith('blob:')) {
          return `url("${convertToProxyUrl(url, baseUrl)}")`;
        }
        return match;
      });
      $(elem).html(cssContent);
    }
  });
  
  return $.html();
};

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

    const contentType = response.headers['content-type'] || '';
    let responseData = response.data;

    // إذا كان المحتوى HTML، قم بمعالجته لتحويل الروابط
    if (contentType.includes('text/html') || contentType.includes('application/xhtml+xml')) {
      try {
        const htmlContent = Buffer.from(responseData).toString('utf8');
        const processedHtml = processHtmlContent(htmlContent, targetUrl);
        responseData = Buffer.from(processedHtml, 'utf8');
        
        // تحديث طول المحتوى بعد المعالجة
        response.headers['content-length'] = Buffer.byteLength(responseData);
      } catch (htmlError) {
        console.error('Error processing HTML:', htmlError.message);
        // في حالة الخطأ، ارجع المحتوى الأصلي دون معالجة
      }
    }

    // إذا كان المحتوى CSS، قم بمعالجة روابط url()
    if (contentType.includes('text/css')) {
      try {
        const cssContent = Buffer.from(responseData).toString('utf8');
        const processedCss = cssContent.replace(/url\(['"]?([^'")]+)['"]?\)/g, (match, url) => {
          if (!url.startsWith('data:') && !url.startsWith('#') && !url.startsWith('blob:') && !url.includes('/api/proxy?')) {
            return `url("${convertToProxyUrl(url, targetUrl)}")`;
          }
          return match;
        });
        responseData = Buffer.from(processedCss, 'utf8');
        response.headers['content-length'] = Buffer.byteLength(responseData);
      } catch (cssError) {
        console.error('Error processing CSS:', cssError.message);
      }
    }

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

    res.status(response.status).send(responseData);
  } catch (err) {
    console.error('Proxy error:', err.message);
    res.status(502).json({ error: 'Upstream request failed', detail: err.message });
  }
};
