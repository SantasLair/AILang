import * as http from 'http';
import { parseAndExecuteSource, parseSource } from './compiler';
import { compileToBytecode, runBytecode } from './bytecode';

const PORT = Number(process.env.PORT || 8787);

type Json = Record<string, any>;

function send(res: http.ServerResponse, code: number, body: any, headers?: http.OutgoingHttpHeaders) {
  const isBuffer = body instanceof Uint8Array || body instanceof Buffer;
  const h: http.OutgoingHttpHeaders = {
    'Content-Type': isBuffer ? 'application/octet-stream' : 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    ...headers,
  };
  res.writeHead(code, h);
  res.end(isBuffer ? body : JSON.stringify(body));
}

function notFound(res: http.ServerResponse) { send(res, 404, { error: 'not_found' }); }
function bad(res: http.ServerResponse, msg: string) { send(res, 400, { error: msg }); }

function readBody(req: http.IncomingMessage): Promise<{ raw: Buffer; text: string; json?: any }>
{ return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      const text = raw.toString('utf8');
      let json: any = undefined;
      const ctype = (req.headers['content-type'] || '').toString();
      if (ctype.includes('application/json')) {
        try { json = JSON.parse(text); } catch { /* ignore */ }
      }
      resolve({ raw, text, json });
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    if (req.method === 'GET' && url.pathname === '/health') {
      send(res, 200, { ok: true, ts: Date.now() });
      return;
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }
    if (req.method === 'POST' && url.pathname === '/run') {
      const { json, text } = await readBody(req);
      const source = json?.source ?? text;
      if (!source || typeof source !== 'string') return bad(res, 'expected source in body');
      const result = parseAndExecuteSource(source);
      send(res, 200, { outputs: result.outputs, context: result.context });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/compile') {
      const { json, text } = await readBody(req);
      const source = json?.source ?? text;
      if (!source || typeof source !== 'string') return bad(res, 'expected source in body');
      const ast = parseSource(source);
      const bc = compileToBytecode(ast);
      // Return as base64 to keep it JSON friendly
      send(res, 200, { bytecode: Buffer.from(bc).toString('base64'), bytes: bc.byteLength });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/runbc') {
      const { json } = await readBody(req);
      if (!json || typeof json.bytecode !== 'string') return bad(res, 'expected { bytecode: base64 }');
      const bc = Buffer.from(json.bytecode, 'base64');
      const result = runBytecode(new Uint8Array(bc));
      send(res, 200, { outputs: result.outputs, context: result.context });
      return;
    }
    notFound(res);
  } catch (err: any) {
    send(res, 500, { error: err?.message || String(err) });
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`AILang server listening on http://localhost:${PORT}`);
});
