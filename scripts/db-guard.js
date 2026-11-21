const path = require('path');
const { spawnSync } = require('child_process');
const { getAppEnv, isCloudRuntime, isLocalSupabaseUrl } = require('../lib/envLoader');

const ROOT_DIR = path.resolve(__dirname, '..');

function runCommand(commandString, options = {}) {
  return spawnSync(commandString, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    shell: true,
    ...options,
  });
}

function assertLocalCliSafe(actionName) {
  const appEnv = getAppEnv(process.env);
  if (appEnv === 'production' || process.env.NODE_ENV === 'production' || isCloudRuntime(process.env)) {
    console.error(
      `[DB Safety Guard] Refusing to run "${actionName}" in "${appEnv}" or cloud environment.`
    );
    process.exit(1);
  }

  const shellUrl = process.env.SUPABASE_URL;
  if (shellUrl && !isLocalSupabaseUrl(shellUrl)) {
    console.error(
      `[DB Safety Guard] Refusing to run "${actionName}" while shell SUPABASE_URL points to a non-local host (${shellUrl}).`
    );
    process.exit(1);
  }
}

function assertDockerRunning() {
  const check = runCommand('docker info', { stdio: 'ignore' });
  if (check.status !== 0) {
    console.error(
      '[Docker] Docker Desktop is not running. Please start Docker Desktop and try again.'
    );
    process.exit(1);
  }
}

module.exports = {
  ROOT_DIR,
  runCommand,
  assertLocalCliSafe,
  assertDockerRunning,
};
