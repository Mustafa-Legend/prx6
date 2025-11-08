const axios = require('axios');
const { SocksProxyAgent } = require('socks-proxy-agent');

// Configure axios with better defaults for serverless
const axiosInstance = axios.create({
  timeout: 10000, // Reduced timeout for serverless
  maxContentLength: 10485760,
  maxBodyLength: 10485760,
  validateStatus: () => true
});

// SOCKS5 proxy configuration with multiple fallbacks
const getProxyAgent = () => {
  try {
    // Multiple proxy options - try them in order
    const proxyOptions = [
      process.env.SOCKS5_PROXY, // Your main proxy
      'socks5://gw.dataimpulse.com:824:59b29a23f8bc3ce6bb65__cr.au,us:93aa23f81ee1080e',
      process.env.SOCKS5_BACKUP_1,
      process.env.SOCKS5_BACKUP_2
    ].filter(Boolean);

    for (const proxyUrl of proxyOptions) {
      try {
        console.log(`Attempting proxy: ${proxyUrl.substring(0, 50)}...`);
        const agent = new SocksProxyAgent(proxyUrl);
        
        // Test the agent (optional - adds overhead)
        return agent;
      } catch (agentError) {
        console.warn(`Proxy failed: ${agentError.message}`);
        continue;
      }
    }
    
    return null; // No working proxy found
  } catch (error) {
    console.error('Proxy configuration error:', error.message);
    return null;
  }
};

// Enhanced fetch function with proxy fallback
const fetchWithProxyFallback = async (url, options = {}) => {
  const maxRetries = 2;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt === 0) {
        // First attempt: Try with SOCKS5 proxy
        const agent = getProxyAgent();
        if (agent) {
          console.log(`Attempt ${attempt + 1}: Using SOCKS5 proxy`);
          const response = await axiosInstance.get(url, {
            ...options,
            httpsAgent: agent,
            httpAgent: agent,
            timeout: 8000
          });
          return response;
        }
      } else if (attempt === 1) {
        // Second attempt: Try HTTP proxy if available
        const httpProxy = process.env.HTTP_PROXY;
        if (httpProxy) {
          console.log(`Attempt ${attempt + 1}: Using HTTP proxy`);
          const { HttpsProxyAgent } = require('https-proxy-agent');
          const agent = new HttpsProxyAgent(httpProxy);
          const response = await axiosInstance.get(url, {
            ...options,
            httpsAgent: agent,
            timeout: 8000
          });
          return response;
        }
      } else {
        // Final attempt: Direct connection (no proxy)
        console.log(`Attempt ${attempt + 1}: Using direct connection`);
        const response = await axiosInstance.get(url, {
          ...options,
          timeout: 8000
        });
        return response;
      }
    } catch (error) {
      console.warn(`Attempt ${attempt + 1} failed: ${error.message}`);
      
      if (attempt === maxRetries) {
        throw error; // All attempts failed
      }
      
      // Wait briefly before retry (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
};

// Updated main function with proxy support
module.exports = async (req, res) => {
  // Immediate response for OPTIONS
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-API-KEY');
    return res.status(204).end();
  }

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');

  try {
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

    // Host validation
    const isAllowedHost = (hostname) => {
      const raw = process.env.ALLOWED_HOSTS || '';
      if (!raw) return true;
      const list = raw.split(',').map(s => s.trim()).filter(Boolean);
      return list.includes(hostname);
    };

    if (!isAllowedHost(parsed.hostname)) {
      return res.status(403).json({ error: 'Host not allowed by ALLOWED_HOSTS' });
    }

    // Prepare request options
    const forwardHeaders = { ...req.headers };
    delete forwardHeaders.host;
    delete forwardHeaders['x-forwarded-for'];
    delete forwardHeaders['x-api-key'];
    delete forwardHeaders['content-length'];

    const requestOptions = {
      method: req.method,
      url: targetUrl,
      headers: forwardHeaders,
      data: req.body,
      responseType: 'arraybuffer'
    };

    // Remove body for GET/HEAD requests
    if (req.method === 'GET' || req.method === 'HEAD') {
      delete requestOptions.data;
    }

    // Use proxy with fallback
    const response = await fetchWithProxyFallback(targetUrl, requestOptions);

    // Process response content (your existing HTML/CSS processing)
    const contentType = response.headers['content-type'] || '';
    let responseData = response.data;

    // Your existing content processing functions
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

    const processHtmlContent = (html, baseDomain) => {
      // Your existing HTML processing logic
      return html.replace(/<link([^>]*?)href=(["'])(.*?)\2/gi, (match, attrs, quote, href) => {
        if (href) {
          const directUrl = convertProxyToDirect(href, baseDomain);
          return `<link${attrs}href=${quote}${directUrl}${quote}`;
        }
        return match;
      });
      // Include all your other HTML processing rules...
    };

    const processCssContent = (css, baseDomain) => {
      return css.replace(/url\((['"]?)(.*?)\1\)/gi, (match, quote, url) => {
        if (url && !url.startsWith('data:') && !url.startsWith('#') && !url.startsWith('blob:')) {
          const directUrl = convertProxyToDirect(url, baseDomain);
          return `url(${quote}${directUrl}${quote})`;
        }
        return match;
      });
    };

    // Apply content processing
    if (contentType.includes('text/html')) {
      try {
        const htmlContent = Buffer.from(responseData).toString('utf8');
        const processedHtml = processHtmlContent(htmlContent, 'https://prx8.vercel.app');
        responseData = Buffer.from(processedHtml, 'utf8');
        response.headers['content-length'] = Buffer.byteLength(responseData);
      } catch (htmlError) {
        console.error('Error processing HTML:', htmlError.message);
      }
    }

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

    return res.status(response.status).send(responseData);

  } catch (err) {
    console.error('Proxy error:', err.message);
    
    // Enhanced error handling with proxy-specific errors
    if (err.code === 'ECONNABORTED') {
      return res.status(504).json({ 
        error: 'Proxy request timeout',
        suggestion: 'Try without proxy or use different proxy server'
      });
    }
    
    if (err.message.includes('SOCKS')) {
      return res.status(502).json({
        error: 'SOCKS proxy connection failed',
        detail: 'SOCKS proxies may not work in serverless environments',
        suggestion: 'Try using HTTP proxy or direct connection'
      });
    }
    
    if (err.response) {
      return res.status(502).json({ 
        error: 'Upstream request failed', 
        detail: `${err.response.status}: ${err.message}`
      });
    }
    
    return res.status(502).json({ 
      error: 'Request failed',
      detail: err.message,
      suggestion: 'Check if the URL is accessible and try again'
    });
  }
};
