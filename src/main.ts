import { parseAndExecuteFile, parseSource, parseAndExecuteSource } from './compiler';
import * as fs from 'fs';
import { compileToBytecode, runBytecode } from './bytecode';
import * as readline from 'readline';

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node dist/src/main.js <file.ailang> | --stdin | --repl | --watch <file.ailang> | --compile <in.ailang> <out.albc> | --runbc <file.albc>');
    process.exit(1);
  }
  try {
    if (args[0] === '--stdin') {
      const src = await readAllStdin();
      const result = parseAndExecuteSource(src);
      printOutputs(result.outputs);
      return;
    }
    if (args[0] === '--repl') {
      await startRepl();
      return;
    }
    if (args[0] === '--watch') {
      const file = args[1];
      if (!file) throw new Error('Missing file for --watch');
      await runAndPrint(file);
      fs.watch(file, { persistent: true }, async (evt) => {
        if (evt === 'change') {
          try { await runAndPrint(file); } catch (e: any) { console.error('Error:', e.message || e); }
        }
      });
      return; // keep process alive
    }
    if (args[0] === '--compile') {
      const inFile = args[1];
      const outFile = args[2] || (inFile.replace(/\.ailang$/i, '') + '.albc');
      const src = await fs.promises.readFile(inFile, 'utf8');
      const ast = parseSource(src);
      const bc = compileToBytecode(ast);
      await fs.promises.writeFile(outFile, bc);
      console.log(`wrote ${outFile} (${bc.byteLength} bytes)`);
      return;
    }
    if (args[0] === '--runbc') {
      const inFile = args[1];
      const bc = new Uint8Array(await fs.promises.readFile(inFile));
      const result = runBytecode(bc);
      const keys = Object.keys(result.outputs);
      if (keys.length === 1) {
        console.log(JSON.stringify(result.outputs[keys[0]]));
      } else {
        console.log(JSON.stringify(result.outputs, null, 2));
      }
      return;
    }
    const file = args[0];
    await runAndPrint(file);
  } catch (err: any) {
    console.error('Error:', err.message || err);
    process.exit(2);
  }
}

async function runAndPrint(file: string) {
  const result = await parseAndExecuteFile(file);
  printOutputs(result.outputs);
}

function printOutputs(outputs: Record<string, any>) {
  const keys = Object.keys(outputs);
  if (keys.length === 1) console.log(JSON.stringify(outputs[keys[0]]));
  else console.log(JSON.stringify(outputs, null, 2));
}

function readAllStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
  });
}

async function startRepl() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  console.log('AILang REPL: enter a full program, end with a single line containing RUN. Commands: :reset, :exit');
  let buf: string[] = [];
  const prompt = () => rl.setPrompt('> ') as any, next = () => rl.prompt();
  prompt(); next();
  rl.on('line', (line) => {
    const t = line.trim();
    if (t === ':exit') { rl.close(); return; }
    if (t === ':reset') { buf = []; console.log('(reset)'); next(); return; }
    if (t === 'RUN') {
      const src = buf.join('\n');
      try {
        const result = parseAndExecuteSource(src);
        printOutputs(result.outputs);
      } catch (e: any) {
        console.error('Error:', e.message || e);
      }
      buf = [];
      next();
      return;
    }
    buf.push(line);
    next();
  });
  rl.on('close', () => process.exit(0));
}

main();
