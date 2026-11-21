const { runCommand, assertLocalCliSafe, assertDockerRunning } = require('./db-guard');

function main() {
  assertLocalCliSafe('db:reset');
  assertDockerRunning();

  console.log('[DB Reset] Resetting local Docker Supabase database (migrations + supabase/seed.sql)...');
  const res = runCommand('npx supabase db reset', { stdio: 'inherit' });
  if (res.status !== 0) {
    process.exit(res.status || 1);
  }
  console.log('✓ Local Docker Supabase database reset and seeded.');
}

main();
