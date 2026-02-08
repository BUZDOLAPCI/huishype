import { execSync } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import postgres from 'postgres';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const API_DIR = resolve(__dirname, '..');

function formatTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function run(cmd: string, label: string): void {
  console.log(`\n${'='.repeat(60)}`);
  console.log(label);
  console.log('='.repeat(60));
  const start = Date.now();
  execSync(cmd, {
    cwd: API_DIR,
    stdio: 'inherit',
    timeout: 60 * 60 * 1000, // 60 min
    env: { ...process.env },
  });
  console.log(`\n  Completed in ${formatTime(Date.now() - start)}`);
}

async function dbReset() {
  const totalStart = Date.now();
  const args = process.argv.slice(2);
  const skipExtract = args.includes('--skip-extract');

  console.log('='.repeat(60));
  console.log('HuisHype Database Reset');
  console.log('='.repeat(60));
  console.log('This will DROP all tables and rebuild from scratch.');
  console.log('');

  // Step 1: Drop and recreate schema
  const databaseUrl = process.env.DATABASE_URL || 'postgresql://huishype:huishype_dev@localhost:5440/huishype';
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });

  try {
    console.log('\nStep 1: Drop all tables...');
    const start = Date.now();
    // Terminate any lingering connections first
    await sql.unsafe(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()`);
    await sql.unsafe('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await sql.unsafe('DROP SCHEMA public CASCADE');
    await sql.unsafe('CREATE SCHEMA public');
    await sql.unsafe('CREATE EXTENSION IF NOT EXISTS postgis');
    console.log(`  Schema reset in ${formatTime(Date.now() - start)}`);
  } finally {
    await sql.end();
  }

  // Step 2: Run migrations
  run('npx drizzle-kit migrate', 'Step 2: Run migrations');

  // Step 3: Seed BAG properties
  const seedFlags = skipExtract ? ' --skip-extract' : '';
  run(`npx tsx scripts/seed.ts${seedFlags}`, 'Step 3: Seed BAG properties');

  // Step 4: Seed listings
  run('npx tsx scripts/seed-listings.ts', 'Step 4: Seed listings from mirrors');

  // Step 5: Final ANALYZE
  const sqlFinal = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    console.log('\nStep 5: Final ANALYZE...');
    const start = Date.now();
    await sqlFinal.unsafe('ANALYZE');
    console.log(`  ANALYZE complete in ${formatTime(Date.now() - start)}`);
  } finally {
    await sqlFinal.end();
  }

  console.log('\n' + '='.repeat(60));
  console.log('Database Reset Complete');
  console.log('='.repeat(60));
  console.log(`Total time: ${formatTime(Date.now() - totalStart)}`);
}

dbReset().catch((error) => {
  console.error('\nDatabase reset failed:', error);
  process.exit(1);
});
