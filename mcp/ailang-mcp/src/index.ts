import { Server, Tool } from "@modelcontextprotocol/sdk";
import fetch from "node-fetch";

const AILANG_SERVER = process.env.AILANG_SERVER || "http://localhost:8790";

const assistTool: Tool = {
  name: "assist",
  description: "Forward a prompt and optional input to the AILang server's /assist endpoint. Input must be JSON.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string" },
      input: {},
      mode: { type: "string", enum: ["plan", "run", "compile"], default: "plan" }
    },
    required: ["prompt"]
  },
  async handler(args: any) {
    const res = await fetch(`${AILANG_SERVER}/assist`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args)
    });
    const text = await res.text();
    let data: any;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { content: [{ type: 'json', json: data }] } as any;
  }
};

async function main() {
  const server = new Server({
    name: "ailang-mcp",
    version: "0.1.0",
    tools: [assistTool],
  });
  await server.start();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
