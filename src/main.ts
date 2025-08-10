import { parseAndExecuteFile } from './compiler';

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node dist/main.js <file.ailang>');
    process.exit(1);
  }
  try {
    const result = await parseAndExecuteFile(file);
    // Prefer a single %out if present; otherwise dump all outputs
    const keys = Object.keys(result.outputs);
    if (keys.length === 1) {
      console.log(JSON.stringify(result.outputs[keys[0]]));
    } else {
      console.log(JSON.stringify(result.outputs, null, 2));
    }
  } catch (err: any) {
    console.error('Error:', err.message || err);
    process.exit(2);
  }
}

main();
