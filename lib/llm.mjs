// OpenAI-compatible chat against the local llama-server. The API key is discovered at runtime
// (env, then the running server's command line) and never written anywhere.
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.RESKIN_LLM_URL || 'http://127.0.0.1:8080';
export const MODEL = process.env.RESKIN_MODEL || 'gemma-4-12b';

let cachedKey;
export function apiKey() {
  if (cachedKey !== undefined) return cachedKey;
  cachedKey = process.env.LLAMA_API_KEY || process.env.RESKIN_API_KEY || '';
  if (!cachedKey && process.platform === 'win32') {
    try {
      const cmd = execFileSync('powershell', ['-NoProfile', '-Command',
        "(Get-CimInstance Win32_Process -Filter \"name='llama-server.exe'\" | Where-Object { $_.CommandLine -match '--port[ =]8080' }).CommandLine"],
      { encoding: 'utf8', timeout: 15000 });
      cachedKey = (cmd.match(/--api-key[ =](\S+)/) || [])[1] || '';
    } catch { cachedKey = ''; }
  }
  return cachedKey;
}

function post(path, body, timeoutMs) {
  const u = new URL(path, BASE);
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), authorization: `Bearer ${apiKey()}` } }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`llm HTTP ${res.statusCode}: ${buf.slice(0, 200)}`));
        try { resolve(JSON.parse(buf)); } catch (e) { reject(e); }
      });
    });
    // node:http has no headers timeout of its own; a stalled shared server gets reported, not retried.
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`llm stalled: no answer in ${timeoutMs / 1000}s (server not restarted)`)));
    req.on('error', reject);
    req.end(data);
  });
}

// Cached by prompt hash so re-runs and gallery rebuilds don't touch the shared server.
export async function chat(messages, { maxTokens = 2200, temperature = 0.4, cacheDir, timeoutMs = 420000 } = {}) {
  const body = { model: MODEL, messages, max_tokens: maxTokens, temperature, chat_template_kwargs: { enable_thinking: false } };
  const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16);
  const file = cacheDir && join(cacheDir, `${hash}.json`);
  if (file && existsSync(file)) return { ...JSON.parse(readFileSync(file, 'utf8')), cached: true };
  const t0 = Date.now();
  const res = await post('/v1/chat/completions', body, timeoutMs);
  const out = { content: res.choices[0].message.content || '', finish: res.choices[0].finish_reason, usage: res.usage, ms: Date.now() - t0, model: res.model };
  if (file) { mkdirSync(cacheDir, { recursive: true }); writeFileSync(file, JSON.stringify(out, null, 1)); }
  return out;
}
