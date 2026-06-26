#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { runCanvasCommand } from './commands.js';

export { runCanvasCommand } from './commands.js';

async function main(): Promise<void> {
  const code = await runCanvasCommand(process.argv.slice(2));
  process.exit(code);
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  main().catch((err) => {
    console.error(`canvas-cli: ${(err as Error).message}`);
    process.exit(1);
  });
}
