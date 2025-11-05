import axios from "axios";
import { SocksProxyAgent } from "socks-proxy-agent";

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
      // httpsAgent: agent, // فعّل هذا السطر إن أردت بروكسي
      responseType: "arraybuffer",
      headers: {
        "User-Agent": req.headers["user-agent"] || "Mozilla/5.0",
      },
    });

    let contentType = response.headers["content-type"] || "text/plain";

    // 🧠 تعديل الروابط داخل صفحات HTML فقط
    if (contentType.includes("text/html")) {
      let html = response.data.toString("utf-8");

      const baseUrl = new URL(targetUrl).origin;

      // تعديل جميع الروابط
      html = html
        .replace(/(href|src)=["'](?!https?:|\/\/)([^"']+)["']/gi, (match, attr, path) => {
          const absoluteUrl = new URL(path, baseUrl).href;
          return `${attr}="/api/proxy?url=${absoluteUrl}"`;
        })
        .replace(/(href|src)=["'](https?:\/\/[^"']+)["']/gi, (match, attr, fullUrl) => {
          return `${attr}="/api/proxy?url=${fullUrl}"`;
        });

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(html);
    }

    // الملفات الأخرى (CSS, JS, صور، الخ)
    res.setHeader("Content-Type", contentType);
    res.status(response.status).send(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
