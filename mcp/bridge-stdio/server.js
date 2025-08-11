#!/usr/bin/env node
// Minimal MCP-compatible JSON-RPC server over stdio that exposes a single tool
// "assist" and forwards to the AILang server /assist endpoint.

const AILANG_SERVER = process.env.AILANG_SERVER || 'http://localhost:8790';
const DEBUG = !!process.env.DEBUG;
const { request: httpReq } = require('http');
const { request: httpsReq } = require('https');
const { URL } = require('url');

function log(...args) { if (DEBUG) { console.error('[bridge]', ...args); } }

function postJson(urlStr, body) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(urlStr);
      const isHttps = u.protocol === 'https:';
      const req = (isHttps ? httpsReq : httpReq)({
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: u.pathname + (u.search || ''),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try { resolve(JSON.parse(text)); }
          catch { resolve({ raw: text, status: res.statusCode }); }
        });
      });
      req.on('error', reject);
      req.end(JSON.stringify(body ?? {}));
    } catch (e) { reject(e); }
  });
}

function writeMessage(msg) {
  const json = JSON.stringify(msg);
  const header = `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n`;
  process.stdout.write(header);
  process.stdout.write(json);
}

let buf = Buffer.alloc(0);
function tryRead() {
  while (true) {
    const sep = buf.indexOf('\r\n\r\n');
    if (sep === -1) return;
    const headerPart = buf.slice(0, sep).toString('utf8');
    const headers = Object.fromEntries(headerPart.split('\r\n').map(l => {
      const i = l.indexOf(':');
      return [l.slice(0, i).trim().toLowerCase(), l.slice(i + 1).trim()];
    }));
    const len = parseInt(headers['content-length'] || '0', 10);
    const total = sep + 4 + len;
    if (buf.length < total) return;
    const body = buf.slice(sep + 4, total).toString('utf8');
    buf = buf.slice(total);
    try { handleMessage(JSON.parse(body)); }
    catch (e) { log('JSON parse error', e?.message); }
  }
}

async function handleMessage(msg) {
  log('<=', msg.method || 'resp', msg.id ?? '');
  if (msg.method === 'initialize') {
    writeMessage({ jsonrpc: '2.0', id: msg.id, result: {
      protocolVersion: '0.1',
      serverInfo: { name: 'ailang-bridge', version: '0.1.0' },
      capabilities: { tools: {} },
    }});
    return;
  }
  if (msg.method === 'tools/list') {
    const tools = [{
      name: 'assist',
      description: 'Proxy to AILang /assist. Args: { prompt: string, input?: any, mode?: "plan"|"run"|"compile" }',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string' },
          input: {},
          mode: { type: 'string', enum: ['plan','run','compile'], default: 'plan' },
        },
        required: ['prompt']
      },
    }];
    writeMessage({ jsonrpc: '2.0', id: msg.id, result: { tools } });
    return;
  }
  if (msg.method === 'tools/call') {
    const params = msg.params || {};
    const name = params.name || params.tool || '';
    const args = params.arguments || params.args || {};
    if (name !== 'assist') {
      writeMessage({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Unknown tool: ${name}` }});
      return;
    }
    try {
      const data = await postJson(`${AILANG_SERVER}/assist`, args);
      writeMessage({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'json', json: data }] } });
    } catch (e) {
      writeMessage({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: String(e?.message || e) } });
    }
    return;
  }
  if (msg.method === 'shutdown') {
    writeMessage({ jsonrpc: '2.0', id: msg.id, result: null });
    return;
  }
  if (msg.method === 'exit') {
    process.exit(0);
  }
}

process.stdin.on('data', (c) => { buf = Buffer.concat([buf, Buffer.isBuffer(c) ? c : Buffer.from(c)]); tryRead(); });
process.stdin.on('error', (e) => log('stdin error', e?.message));
log('AILang MCP bridge started. Target:', AILANG_SERVER);
