import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnvFile } from 'node:process';
if (existsSync('.env')) loadEnvFile('.env');
const filename = join(process.env.DATA_DIR ?? '.mtg-data', 'operations.json');
try {
  const snapshot = JSON.parse(await readFile(filename, 'utf8'));
  console.info(JSON.stringify(snapshot, null, 2));
} catch {
  console.error(
    'Diagnostics are not available yet. Start the server and allow its first maintenance check to finish.',
  );
  process.exitCode = 1;
}
