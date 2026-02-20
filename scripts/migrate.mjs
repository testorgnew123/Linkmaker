import { neon } from '@neondatabase/serverless';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '..', 'migrations');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const sql = neon(url);

const files = readdirSync(migrationsDir)
  .filter(f => f.endsWith('.sql'))
  .sort();

console.log(`Running ${files.length} migration(s)...\n`);

for (const file of files) {
  const path = join(migrationsDir, file);
  const raw = readFileSync(path, 'utf-8');
  console.log(`  → ${file}`);

  // Split on semicolons that end a line, but respect $$ dollar-quoted blocks
  const statements = [];
  let current = '';
  let inDollarQuote = false;
  for (const line of raw.split('\n')) {
    current += (current ? '\n' : '') + line;
    if (line.includes('$$')) {
      inDollarQuote = !inDollarQuote;
    }
    if (!inDollarQuote && line.trimEnd().endsWith(';')) {
      const stmt = current.trim().replace(/;$/, '').trim();
      if (stmt.length) statements.push(stmt);
      current = '';
    }
  }
  if (current.trim().length) {
    const stmt = current.trim().replace(/;$/, '').trim();
    if (stmt.length) statements.push(stmt);
  }

  for (const stmt of statements) {
    try {
      await sql(stmt);
    } catch (err) {
      if (err.message?.includes('already exists')) {
        console.log(`    ⊘ skipped (already exists)`);
      } else {
        console.error(`    ✗ failed:`, err.message);
        process.exit(1);
      }
    }
  }
  console.log(`    ✓ done (${statements.length} statements)`);
}

console.log('\nAll migrations complete.');
