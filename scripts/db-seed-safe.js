const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT_DIR, runCommand, assertLocalCliSafe, assertDockerRunning } = require('./db-guard');

function readSupabaseProjectId() {
  const configPath = path.join(ROOT_DIR, 'supabase', 'config.toml');
  if (fs.existsSync(configPath)) {
    const content = fs.readFileSync(configPath, 'utf8');
    const match = content.match(/^\s*project_id\s*=\s*["']([^"']+)["']/m);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return 'stremio-watchlist-test-db';
}

function findLocalDbContainer() {
  const projectId = readSupabaseProjectId();
  const ps = runCommand(
    `docker ps --filter "label=com.supabase.cli.project=${projectId}" --format "{{.Names}}"`,
    { stdio: 'pipe' }
  );
  if (ps.status !== 0 || !ps.stdout) {
    return null;
  }
  const names = ps.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return names.find((name) => name.startsWith('supabase_db_')) || null;
}

function main() {
  assertLocalCliSafe('db:seed');
  assertDockerRunning();

  const seedPath = path.join(ROOT_DIR, 'supabase', 'seed.sql');
  if (!fs.existsSync(seedPath)) {
    console.error('[DB Seed] Missing supabase/seed.sql file.');
    process.exit(1);
  }

  const dbContainer = findLocalDbContainer();
  if (!dbContainer) {
    console.error(
      '[DB Seed] Local Supabase Postgres container is not running. Run "npm run db:start" first.'
    );
    process.exit(1);
  }

  console.log(`[DB Seed] Applying supabase/seed.sql to local Docker container (${dbContainer})...`);
  const seedSql = fs.readFileSync(seedPath, 'utf8');
  const res = spawnSync(
    'docker',
    ['exec', '-i', dbContainer, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    {
      cwd: ROOT_DIR,
      input: seedSql,
      encoding: 'utf8',
      stdio: ['pipe', 'inherit', 'inherit'],
    }
  );

  if (res.status !== 0) {
    process.exit(res.status || 1);
  }
  console.log('✓ Synthetic seed data applied cleanly to local Docker Supabase database.');
}

main();
