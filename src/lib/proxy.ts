/**
 * Outbound HTTP(S) proxy bootstrap.
 *
 * If HTTPS_PROXY (or HTTP_PROXY) is set in the environment, route every
 * outbound HTTP/HTTPS call through it. Covers three transport layers
 * actually used by this codebase:
 *
 *   1. axios            — rankigi.ts, providers/ollama.ts, tools/web-search.ts
 *   2. native fetch     — memory/memos-client.ts, OpenAI SDK (Node 18+)
 *   3. node http(s)     — @anthropic-ai/sdk (uses node-fetch polyfill / http.Agent),
 *                         node-telegram-bot-api (uses `request` lib)
 *
 * If no proxy env var is set, this module is a no-op — behavior is
 * exactly as before. Import this module FIRST, before any code that
 * constructs HTTP clients.
 */
import fs from "fs";
import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { HttpProxyAgent } from "http-proxy-agent";
import { ProxyAgent, setGlobalDispatcher } from "undici";

export const proxyUrl: string | undefined =
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy;

const caPath = process.env.NODE_EXTRA_CA_CERTS;
const ca = caPath && fs.existsSync(caPath)
  ? fs.readFileSync(caPath)
  : undefined;

export const httpsAgent = proxyUrl ? new HttpsProxyAgent(proxyUrl, { ca }) : undefined;
export const httpAgent = proxyUrl ? new HttpProxyAgent(proxyUrl) : undefined;

if (proxyUrl) {
  // 1. axios — set defaults so every axios.* and axios.create() call inherits.
  //    `proxy: false` disables axios's own (broken) HTTPS-over-CONNECT handling
  //    in favor of the explicit agent.
  axios.defaults.httpsAgent = httpsAgent;
  axios.defaults.httpAgent = httpAgent;
  axios.defaults.proxy = false;

  // 2. undici / native fetch — Node 18+ fetch is undici under the hood.
  //    setGlobalDispatcher routes every fetch() through the proxy.
  setGlobalDispatcher(new ProxyAgent(proxyUrl));

  console.log(`[PROXY] Routing all outbound HTTP through ${proxyUrl}`);
}
