import fs from 'fs';
import path from 'path';

export interface LoadEnvOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  allowInTest?: boolean;
  allowInCloud?: boolean;
}

export interface LoadEnvResult {
  loadedFiles: string[];
  skippedReason?: string;
  appEnv: string;
}

export type DatabaseTarget = 'local-docker' | 'supabase-cloud' | 'in-memory';

export interface DatabaseEnvInfo {
  appEnv: string;
  dbTarget: DatabaseTarget;
  host: string | null;
  isLocal: boolean;
  isProduction: boolean;
}

const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', 'host.docker.internal']);

function resolveRepoRoot(cwd?: string): string {
  if (cwd) {
    return path.resolve(cwd);
  }

  const currentDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
  const candidates = [
    process.cwd(),
    path.resolve(currentDir, '..'),
    path.resolve(currentDir, '..', '..'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      return candidate;
    }
  }

  return process.cwd();
}

/**
 * Parses dotenv file text into key-value pairs without executing shell interpolation.
 */
export function parseEnvContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) {
      continue;
    }

    const key = trimmed.slice(0, eqIdx).trim();
    if (!key) {
      continue;
    }

    const rawVal = trimmed.slice(eqIdx + 1).trim();
    const unquoted =
      (rawVal.startsWith('"') && rawVal.endsWith('"')) ||
      (rawVal.startsWith("'") && rawVal.endsWith("'"))
        ? rawVal.slice(1, -1)
        : rawVal;

    result[key] = unquoted;
  }

  return result;
}

export function getAppEnv(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.APP_ENV || env.VERCEL_ENV || env.NODE_ENV || 'development';
  return String(raw).trim().toLowerCase() || 'development';
}

export function isTestRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.JEST_WORKER_ID || env.NODE_ENV === 'test');
}

export function isCloudRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.VERCEL || env.RENDER || env.CI);
}

/**
 * Returns true only when the Supabase URL points to a local loopback or Docker host.
 */
export function isLocalSupabaseUrl(url?: string | null): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }

  const trimmed = url.trim();
  if (!trimmed) {
    return false;
  }

  try {
    const parsed = new URL(trimmed);
    const hostname = parsed.hostname.toLowerCase();
    return LOCAL_HOSTNAMES.has(hostname);
  } catch {
    return false;
  }
}

function getEnvFileLoadOrder(appEnv: string): string[] {
  const files = [`.env.${appEnv}.local`];
  if (appEnv !== 'test') {
    files.push('.env.local');
  }
  files.push(`.env.${appEnv}`, '.env');
  return Array.from(new Set(files));
}

/**
 * Loads .env files following standard Vite/Next precedence while preserving
 * pre-existing process environment variables and isolating Jest/cloud runtimes.
 */
export function loadEnvironment(options: LoadEnvOptions = {}): LoadEnvResult {
  const env = options.env ?? process.env;
  const appEnv = getAppEnv(env);

  if (!options.allowInTest && isTestRuntime(env)) {
    return { loadedFiles: [], skippedReason: 'test_runtime', appEnv };
  }

  if (!options.allowInCloud && isCloudRuntime(env)) {
    return { loadedFiles: [], skippedReason: 'cloud_runtime', appEnv };
  }

  const baseDir = resolveRepoRoot(options.cwd);
  const loadedFiles: string[] = [];
  const lockedKeys = new Set<string>();

  for (const key of Object.keys(env)) {
    if (env[key] !== undefined) {
      lockedKeys.add(key);
    }
  }

  for (const fileName of getEnvFileLoadOrder(appEnv)) {
    const filePath = path.join(baseDir, fileName);
    if (!fs.existsSync(filePath)) {
      continue;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = parseEnvContent(content);
      for (const [key, value] of Object.entries(parsed)) {
        if (!lockedKeys.has(key)) {
          env[key] = value;
          lockedKeys.add(key);
        }
      }
      loadedFiles.push(fileName);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[EnvLoader] Failed to read ${fileName}:`, message);
    }
  }

  return { loadedFiles, appEnv };
}

function extractUrlHost(url?: string | null): string | null {
  if (!url || typeof url !== 'string' || !url.trim()) {
    return null;
  }
  try {
    return new URL(url.trim()).host || null;
  } catch {
    return null;
  }
}

/**
 * Poka-Yoke guard: prevents accidental connection to a remote/production Supabase project
 * while running locally in development mode.
 */
export function assertSafeDatabaseTarget(
  supabaseUrl?: string | null,
  env: NodeJS.ProcessEnv = process.env
): void {
  if (!supabaseUrl || !supabaseUrl.trim()) {
    return;
  }

  if (String(env.DB_MODE || '').trim().toLowerCase() === 'memory') {
    return;
  }

  if (isCloudRuntime(env) || isTestRuntime(env)) {
    return;
  }

  const appEnv = getAppEnv(env);
  if (appEnv === 'production' || env.NODE_ENV === 'production') {
    return;
  }

  if (isLocalSupabaseUrl(supabaseUrl)) {
    return;
  }

  if (env.ALLOW_REMOTE_DB_IN_DEV === 'true') {
    return;
  }

  const host = extractUrlHost(supabaseUrl) || supabaseUrl.trim();
  throw new Error(
    `[DB Safety Guard] Refusing to connect to remote Supabase host (${host}) in "${appEnv}" mode. ` +
      `Run "npm run db:start" to use your local Docker Supabase database (.env.development.local), ` +
      `run "npm run dev:memory" for in-memory mode, or set ALLOW_REMOTE_DB_IN_DEV=true if you explicitly intend to target a remote database.`
  );
}

/**
 * Returns non-sensitive database environment metadata for startup banners and /health checks.
 */
export function getDatabaseEnvironmentInfo(
  supabaseUrl?: string | null,
  isConfigured = false,
  env: NodeJS.ProcessEnv = process.env
): DatabaseEnvInfo {
  const appEnv = getAppEnv(env);
  const isLocal = isLocalSupabaseUrl(supabaseUrl);
  const host = extractUrlHost(supabaseUrl);
  const dbTarget: DatabaseTarget = !isConfigured
    ? 'in-memory'
    : isLocal
      ? 'local-docker'
      : 'supabase-cloud';

  return {
    appEnv,
    dbTarget,
    host,
    isLocal,
    isProduction: appEnv === 'production',
  };
}
