// Simple JSON-RPC test client for the stdio MCP bridge
const { spawn } = require('child_process');
const path = require('path');

const BRIDGE = path.resolve(__dirname, 'server.js');
const env = { ...process.env, AILANG_SERVER: process.env.AILANG_SERVER || 'http://localhost:8790', DEBUG: '1' };

function frame(msg) {
  const s = JSON.stringify(msg);
  return `Content-Length: ${Buffer.byteLength(s, 'utf8')}\r\n\r\n${s}`;
}

const child = spawn(process.execPath, [BRIDGE], { env, stdio: ['pipe', 'pipe', 'inherit'] });
let buf = Buffer.alloc(0);
child.stdout.on('data', (c) => {
  buf = Buffer.concat([buf, Buffer.isBuffer(c) ? c : Buffer.from(c)]);
  while (true) {
    const sep = buf.indexOf('\r\n\r\n');
    if (sep === -1) break;
    const headerPart = buf.slice(0, sep).toString('utf8');
    const lenMatch = /Content-Length:\s*(\d+)/i.exec(headerPart);
    const len = lenMatch ? parseInt(lenMatch[1], 10) : 0;
    const total = sep + 4 + len;
    if (buf.length < total) break;
    const body = buf.slice(sep + 4, total).toString('utf8');
    buf = buf.slice(total);
    try { console.log('<=', JSON.parse(body)); } catch { console.log('<= raw', body); }
  }
});

function send(msg) {
  const s = frame(msg);
  child.stdin.write(s);
}

let id = 1;
// initialize
send({ jsonrpc: '2.0', id: id++, method: 'initialize', params: {} });
// list tools
setTimeout(() => send({ jsonrpc: '2.0', id: id++, method: 'tools/list' }), 50);
// call assist
setTimeout(() => send({ jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name: 'assist', arguments: { prompt: 'Sort these numbers', input: [9,1,5,6,2,5], mode: 'plan' } } }), 100);
// shutdown and exit after a bit
setTimeout(() => send({ jsonrpc: '2.0', id: id++, method: 'shutdown' }), 200);
setTimeout(() => send({ jsonrpc: '2.0', method: 'exit' }), 250);
