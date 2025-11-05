# 🧩 Vercel Reverse Proxy with SOCKS5 & API Key

A simple and secure reverse proxy for **Vercel**, supporting:
- CORS
- SOCKS5 upstream proxy
- API key authentication
- Allowed host restriction

## 🛠 Installation
1. Copy files.
2. Push to GitHub.
3. Deploy on Vercel.

## ⚙️ Environment Variables
| Name | Description | Example |
|------|--------------|----------|
| `API_KEY` | Required key for access | `mysecret123` |
| `UPSTREAM_SOCKS5` | Optional SOCKS5 proxy URL | `socks5://user:pass@host:1080` |
| `ALLOWED_HOSTS` | Comma-separated whitelist | `example.com,api.google.com` |
| `CORS_ORIGIN` | Allowed CORS origin | `*` |

## 🚀 Usage
GET: `https://your-vercel-domain.vercel.app/api/proxy?url=https://httpbin.org/get`
