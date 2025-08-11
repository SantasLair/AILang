import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
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
  if (isBuffer) { res.end(body); return; }
  if (typeof body === 'string') { res.end(body); return; }
  res.end(JSON.stringify(body));
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

    // Health
    if (req.method === 'GET' && url.pathname === '/health') {
      send(res, 200, { ok: true, ts: Date.now() });
      return;
    }

    // Web UI: serve static file if present, otherwise built-in page
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/ui')) {
      const filePath = path.resolve(process.cwd(), 'public', 'webcli.html');
      try {
        const html = fs.readFileSync(filePath);
        send(res, 200, html, { 'Content-Type': 'text/html; charset=utf-8' });
      } catch {
        send(res, 200, defaultWebCliHtml(), { 'Content-Type': 'text/html; charset=utf-8' });
      }
      return;
    }

    // Static under /public
    if (req.method === 'GET' && url.pathname.startsWith('/public/')) {
      const safe = path.normalize(url.pathname).replace(/^\\|\/+/g, '');
      const base = path.resolve(process.cwd(), 'public');
      const target = path.resolve(base, safe.replace(/^public\//, ''));
      if (!target.startsWith(base)) return notFound(res);
      try {
        const data = fs.readFileSync(target);
        const ctype = contentTypeByExt(path.extname(target));
        send(res, 200, data, { 'Content-Type': ctype });
      } catch {
        notFound(res);
      }
      return;
    }

    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    // Run source
    if (req.method === 'POST' && url.pathname === '/run') {
      const { json, text } = await readBody(req);
      const source = json?.source ?? text;
      if (!source || typeof source !== 'string') return bad(res, 'expected source in body');
      const result = parseAndExecuteSource(source);
      send(res, 200, { outputs: result.outputs, context: result.context });
      return;
    }

    // Assist (plan/run/compile)
    if (req.method === 'POST' && url.pathname === '/assist') {
      const { json } = await readBody(req);
      const prompt = json?.prompt as string | undefined;
      const input = json?.input;
      const mode = (json?.mode as string | undefined) || 'plan';
      if (!prompt || typeof prompt !== 'string') return bad(res, 'expected { prompt: string }');
      const source = synthesizeProgram(prompt, input);
      if (mode === 'run') {
        const result = parseAndExecuteSource(source);
        send(res, 200, { source, outputs: result.outputs, context: result.context });
        return;
      }
      if (mode === 'compile') {
        const ast = parseSource(source);
        const bc = compileToBytecode(ast);
        send(res, 200, { source, bytecode: Buffer.from(bc).toString('base64'), bytes: bc.byteLength });
        return;
      }
      send(res, 200, { source });
      return;
    }

    // Compile source to bytecode
    if (req.method === 'POST' && url.pathname === '/compile') {
      const { json, text } = await readBody(req);
      const source = json?.source ?? text;
      if (!source || typeof source !== 'string') return bad(res, 'expected source in body');
      const ast = parseSource(source);
      const bc = compileToBytecode(ast);
      send(res, 200, { bytecode: Buffer.from(bc).toString('base64'), bytes: bc.byteLength });
      return;
    }

    // Run bytecode
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

server.on('error', (err: any) => {
  // eslint-disable-next-line no-console
  console.error('Server error:', err?.code || err?.message || err);
});

server.listen(PORT, '0.0.0.0', () => {
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : PORT;
  // eslint-disable-next-line no-console
  console.log(`AILang server listening on http://localhost:${port}`);
});

function synthesizeProgram(prompt: string, input?: any): string {
  const p = prompt.toLowerCase();
  const inputBlock = input !== undefined ? JSON.stringify(input, null, 0) : '{}';
  // SORT intents
  if (/(sort|order|rank)/.test(p)) {
    const inArr = Array.isArray(input) ? JSON.stringify(input) : '[9,1,5,6,2,5]';
    return [
      '@autosort:',
      '%in:',
      inArr,
      '%model:sort{algorithm=bubble}',
      '%out: sorted',
    ].join('\n');
  }
  // WRITE FILE intents
  if (/(write).*(file)|file.*(write)/.test(p)) {
    const file = (input && input.file) || 'examples/out.txt';
    const content = (input && input.content) || 'hello';
    const srcLines = [
      '@writefile:',
      '%in:',
      JSON.stringify({ file, content }),
      '%model:tool{name=fs.write, file=file, content=content}',
      '!if true then emit plan',
    ];
    return srcLines.join('\n');
  }
  // DEFAULT: echo input and expose as out
  return [
    '@task:',
    '%in:',
    inputBlock,
    '%out: result',
  ].join('\n');
}

function contentTypeByExt(ext: string): string {
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.js': return 'text/javascript; charset=utf-8';
    case '.map': return 'application/json; charset=utf-8';
    default: return 'application/octet-stream';
  }
}

function defaultWebCliHtml(): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>AILang Web CLI</title>
  <style>
    html, body { height: 100%; margin: 0; background: #0b0e14; color: #e6e1cf; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .wrap { display: flex; flex-direction: column; height: 100%; }
    .head { padding: 8px 12px; background: #11151c; border-bottom: 1px solid #20242b; }
    .term { flex: 1; padding: 12px; overflow: auto; white-space: pre-wrap; }
    .line { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid #20242b; background: #11151c; }
    .prompt { color: #6db3ce; }
    .in { flex: 1; background: #0b0e14; color: #e6e1cf; border: 1px solid #20242b; border-radius: 6px; padding: 8px 10px; }
    .in:focus { outline: none; border-color: #2f89b3; box-shadow: 0 0 0 2px rgba(47,137,179,0.2); }
    a { color: #6db3ce; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="head">AILang Web CLI — try: <code>assist plan "sort these numbers" [1,9,3]</code></div>
    <div id="out" class="term"></div>
    <div class="line">
      <div class="prompt">&gt;</div>
      <input id="in" class="in" placeholder="type a command and hit Enter (help)" />
    </div>
  </div>
  <script>
  const outEl = document.getElementById('out');
  const inEl = document.getElementById('in');
  const base = location.origin;
  const hist = []; let hi = -1;
  function print(txt) { const div = document.createElement('div'); div.textContent = txt; outEl.appendChild(div); outEl.scrollTop = outEl.scrollHeight; }
  function printJson(obj) { const pre = document.createElement('pre'); pre.textContent = JSON.stringify(obj, null, 2); outEl.appendChild(pre); outEl.scrollTop = outEl.scrollHeight; }
  function help() {
    print('Commands:');
    print('  help');
    print('  health');
    print('  clear');
    print('  assist plan "<prompt>" [<jsonInput>]');
    print('  assist run "<prompt>" [<jsonInput>]');
    print('  assist compile "<prompt>" [<jsonInput>]');
    print('Notes: prompt may use "double", \"single\", or smart quotes, or be unquoted.');
  }
  function parseAssist(line) {
    // Expected: assist <mode> "prompt" [json] OR assist <mode> prompt words [json]
    let rest = line.trim();
    if (!rest.toLowerCase().startsWith('assist ')) return { error: 'not_assist' };
    rest = rest.slice(7).trim(); // after 'assist '
    const sp = rest.indexOf(' ');
    if (sp < 0) return { error: 'bad_mode' };
    const mode = rest.slice(0, sp).toLowerCase();
    if (!['plan','run','compile'].includes(mode)) return { error: 'bad_mode' };
    rest = rest.slice(sp + 1).trim();
    let prompt = '';
    let used = 0;
    const qStart = rest[0];
    const quotes = [['"','"'], ['\'','\''], ['“','”'], ['”','“']];
    const qPair = quotes.find(q => q[0] === qStart);
    if (qPair) {
      const idx = rest.indexOf(qPair[1], 1);
      if (idx > 0) { prompt = rest.slice(1, idx); used = idx + 1; }
    }
    if (!prompt) {
      const brace = rest.search(/[\[{]/);
      if (brace > 0) { prompt = rest.slice(0, brace).trim(); used = brace; }
      else { prompt = rest.trim(); used = rest.length; }
    }
    let input;
    const tail = rest.slice(used).trim();
    if (tail) {
      try { input = JSON.parse(tail); } catch { return { error: 'bad_json', message: 'Invalid JSON input.' }; }
    }
    return { mode, prompt, input };
  }
  async function cmd(line) {
    if (line === 'help') { help(); return; }
    if (line === 'clear') { outEl.innerHTML=''; return; }
    if (line === 'health') { const r = await fetch(base + '/health'); printJson(await r.json()); return; }
    if (line.startsWith('assist ')) {
      const parsed = parseAssist(line);
      if (parsed.error) { print(parsed.message || 'Unknown command. Type: help'); return; }
      try {
        const r = await fetch(base + '/assist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed) });
        const j = await r.json();
        printJson(j);
      } catch (e) { print(String(e)); }
      return;
    }
    print('Unknown command. Type: help');
  }
  inEl.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { const line = inEl.value.trim(); if (!line) return; hist.unshift(line); hi = -1; print('> ' + line); inEl.value=''; cmd(line); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); hi = Math.min(hi + 1, hist.length - 1); inEl.value = hist[hi] ?? inEl.value; }
    else if (ev.key === 'ArrowDown') { ev.preventDefault(); hi = Math.max(hi - 1, -1); inEl.value = hi === -1 ? '' : hist[hi]; }
  });
  print('Welcome to AILang Web CLI. Type "help".');
  </script>
</body>
</html>`;
}
