import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseContainer, serializeContainer } from '@crypton/core';
import { FileCekCache } from './cache';
import { ViewerClient } from './protocol';

const CACHE_PATH = join(homedir(), '.crypton', 'viewer-cek.json');

function usage(): void {
  console.error('usage:');
  console.error('  viewer info <file.crypton>');
  console.error('  viewer open <file.crypton> [--out <decrypted-output>]');
  console.error('');
  console.error('env: CRYPTON_SERVER_URL overrides the server URL embedded in the container');
}

function printInfo(file: string): void {
  const { manifest: m } = parseContainer(readFileSync(file));
  console.log(`title : ${m.title}`);
  console.log(`doc   : ${m.doc}`);
  console.log(`copyId: ${m.copyId}`);
  console.log(`token : ${m.token.tid}`);
  console.log(`exp   : ${new Date(m.token.exp * 1000).toISOString()}`);
  console.log(`server: ${m.server}`);
}

async function openFile(file: string, out: string | undefined): Promise<number> {
  const container = parseContainer(readFileSync(file));
  const serverBase = process.env.CRYPTON_SERVER_URL;
  const client = new ViewerClient({ cache: new FileCekCache(CACHE_PATH) });
  const outcome = await client.open(container, serverBase ? { serverBase } : {});

  if (!outcome.ok || !outcome.content) {
    console.error(`VIEW DENIED: ${outcome.reason ?? 'unknown'}`);
    return 2;
  }
  // Persist the rotated container back to disk so the embedded token advances (S390).
  if (outcome.container) writeFileSync(file, serializeContainer(outcome.container));
  const tag = outcome.offline ? ' (offline grace)' : '';
  console.log(`VIEW GRANTED${tag}: "${outcome.title}" — ${outcome.content.length} bytes decrypted`);
  if (out) {
    writeFileSync(out, outcome.content);
    console.log(`decrypted payload → ${out}`);
  }
  return 0;
}

async function main(): Promise<void> {
  const [cmd, file, ...rest] = process.argv.slice(2);
  if (!cmd || !file) {
    usage();
    process.exit(1);
  }
  if (cmd === 'info') {
    printInfo(file);
    return;
  }
  if (cmd === 'open') {
    const outIdx = rest.indexOf('--out');
    const out = outIdx >= 0 ? rest[outIdx + 1] : undefined;
    process.exit(await openFile(file, out));
  }
  usage();
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
