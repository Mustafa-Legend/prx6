import axios from "axios";
import { SocksProxyAgent } from "socks-proxy-agent";

export const config = {
  maxDuration: 10,
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error: "Missing ?url parameter" });

  try {
    // إعداد SOCKS5 (اختياري)
    // const agent = new SocksProxyAgent("socks5://user:pass@host:port");

    const response = await axios.get(targetUrl, {
      // httpsAgent: agent,
      responseType: "arraybuffer",
      headers: {
        "User-Agent": req.headers["user-agent"] || "Mozilla/5.0",
        "Accept-Encoding": "identity", // تجنب gzip لتفادي مشاكل فك الضغط
      },
      timeout: 8000,
    });

    const contentType = response.headers["content-type"] || "text/plain";

    // ✨ تعديل HTML فقط
    if (contentType.includes("text/html")) {
      let html = Buffer.from(response.data).toString("utf-8");
      const baseUrl = new URL(targetUrl).origin;

      html = html
        // تعديل الروابط المطلقة والنسبية
        .replace(/(href|src)=["'](?!https?:|\/\/)([^"']+)["']/gi, (m, attr, path) => {
          const abs = new URL(path, baseUrl).href;
          return `${attr}="/api/proxy?url=${abs}"`;
        })
        .replace(/(href|src)=["'](https?:\/\/[^"']+)["']/gi, (m, attr, fullUrl) => {
          return `${attr}="/api/proxy?url=${fullUrl}"`;
        });

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(html);
    }

    // الملفات غير النصية (CSS, JS, صور...)
    res.setHeader("Content-Type", contentType);
    res.status(response.status).send(Buffer.from(response.data));
  } catch (err) {
    console.error("Proxy error:", err.message);
    res.status(500).json({ error: "Proxy failed", details: err.message });
  }
}
