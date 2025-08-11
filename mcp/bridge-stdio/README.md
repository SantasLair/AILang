# AILang MCP Bridge (stdio)

A minimal MCP-compatible JSON-RPC server over stdio that exposes a single tool `assist` and forwards calls to your AILang server `/assist` endpoint.

## Run

- Ensure AILang server is running, e.g.:
  - `cd F:\AILang; npm run build; $env:PORT=8790; node .\dist\src\server.js`
- Start the bridge:
  - `cd F:\AILang\mcp\bridge-stdio`
  - `node .\server.js` (optionally set `AILANG_SERVER` to a different base URL)

## Configure GitHub Copilot (MCP)

Add a provider entry pointing to this Node script via stdio, with environment:

- Command: `node`
- Args: `["F:\\AILang\\mcp\\bridge-stdio\\server.js"]`
- Env: `{ "AILANG_SERVER": "http://localhost:8790" }`

The tool `assist` accepts:

```
{
  "name": "assist",
  "arguments": {
    "prompt": "Sort these numbers",
    "input": [9,1,5,6,2,5],
    "mode": "run"
  }
}
```

It returns the JSON from `/assist`.
