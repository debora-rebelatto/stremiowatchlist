const { spawn } = require('child_process');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

function main() {
  const childEnv = { ...process.env };
  delete childEnv.SUPABASE_URL;
  delete childEnv.SUPABASE_KEY;
  delete childEnv.SUPABASE_SECRET_KEY;
  delete childEnv.SUPABASE_SERVICE_ROLE_KEY;
  delete childEnv.SUPABASE_PUBLISHABLE_KEY;
  delete childEnv.SUPABASE_ANON_KEY;

  childEnv.APP_ENV = 'development';
  childEnv.DB_MODE = 'memory';
  childEnv.VITE_POSTHOG_KEY = '';

  console.log('[Dev Memory] Starting server + Vite in 100% in-memory mode (no database writes)...');
  const child = spawn('npm run dev', {
    cwd: ROOT_DIR,
    env: childEnv,
    stdio: 'inherit',
    shell: true,
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}

main();
