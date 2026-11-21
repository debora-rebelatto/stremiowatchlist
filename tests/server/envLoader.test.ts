import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  parseEnvContent,
  getAppEnv,
  isTestRuntime,
  isCloudRuntime,
  isLocalSupabaseUrl,
  loadEnvironment,
  assertSafeDatabaseTarget,
  getDatabaseEnvironmentInfo,
} from '../../server/utils/envLoader';

const db = require('../../lib/db');
const { systemOperationService } = require('../../server/services');

describe('Environment Loader & Production Safety Guard (envLoader)', () => {
  let tempDir: string | null = null;

  afterEach(() => {
    jest.restoreAllMocks();
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  function createTempEnvDir(files: Record<string, string>): string {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'envloader-test-'));
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(tempDir, name), content, 'utf8');
    }
    return tempDir;
  }

  test('parseEnvContent strips comments, whitespace, and surrounding quotes', () => {
    const parsed = parseEnvContent(`
      # Comment line
      SUPABASE_URL="http://127.0.0.1:54321"
      SUPABASE_KEY='sb_secret_local_123'
      VITE_POSTHOG_KEY=
      PLAIN_VALUE=hello_world
    `);

    expect(parsed).toEqual({
      SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_KEY: 'sb_secret_local_123',
      VITE_POSTHOG_KEY: '',
      PLAIN_VALUE: 'hello_world',
    });
  });

  test('loadEnvironment follows Vite/Next precedence and preserves explicit empty overrides and shell vars', () => {
    const dir = createTempEnvDir({
      '.env': 'SUPABASE_URL=https://prod.supabase.co\nVITE_POSTHOG_KEY=phc_prod\nONLY_BASE=base\nSHELL_VAR=from_base\n',
      '.env.development': 'ONLY_DEV=dev\nVITE_POSTHOG_KEY=phc_dev\n',
      '.env.local': 'ONLY_LOCAL=local\nSUPABASE_URL=https://override-me.supabase.co\n',
      '.env.development.local':
        'SUPABASE_URL=http://127.0.0.1:54321\nVITE_POSTHOG_KEY=\nSHELL_VAR=from_dev_local\n',
    });

    const targetEnv: NodeJS.ProcessEnv = {
      APP_ENV: 'development',
      SHELL_VAR: 'from_shell',
    };

    const result = loadEnvironment({
      cwd: dir,
      env: targetEnv,
      allowInTest: true,
      allowInCloud: true,
    });

    expect(result.loadedFiles).toEqual([
      '.env.development.local',
      '.env.local',
      '.env.development',
      '.env',
    ]);
    expect(targetEnv.SUPABASE_URL).toBe('http://127.0.0.1:54321');
    expect(targetEnv.VITE_POSTHOG_KEY).toBe('');
    expect(targetEnv.SHELL_VAR).toBe('from_shell');
    expect(targetEnv.ONLY_LOCAL).toBe('local');
    expect(targetEnv.ONLY_DEV).toBe('dev');
    expect(targetEnv.ONLY_BASE).toBe('base');
  });

  test('loadEnvironment skips .env.local when appEnv is test', () => {
    const dir = createTempEnvDir({
      '.env.test': 'TEST_VAR=from_env_test\n',
      '.env.local': 'LOCAL_ONLY=should_not_load\nTEST_VAR=from_env_local\n',
    });

    const targetEnv: NodeJS.ProcessEnv = { APP_ENV: 'test' };
    const result = loadEnvironment({
      cwd: dir,
      env: targetEnv,
      allowInTest: true,
      allowInCloud: true,
    });

    expect(result.loadedFiles).toEqual(['.env.test']);
    expect(targetEnv.TEST_VAR).toBe('from_env_test');
    expect(targetEnv.LOCAL_ONLY).toBeUndefined();
  });

  test('loadEnvironment isolates Jest and cloud runtimes from disk .env files', () => {
    const dir = createTempEnvDir({
      '.env': 'SUPABASE_URL=https://prod.supabase.co\n',
    });

    const jestEnv: NodeJS.ProcessEnv = { JEST_WORKER_ID: '1' };
    const jestRes = loadEnvironment({ cwd: dir, env: jestEnv });
    expect(jestRes.skippedReason).toBe('test_runtime');
    expect(jestEnv.SUPABASE_URL).toBeUndefined();

    const vercelEnv: NodeJS.ProcessEnv = { VERCEL: '1', NODE_ENV: 'production' };
    const vercelRes = loadEnvironment({ cwd: dir, env: vercelEnv, allowInTest: true });
    expect(vercelRes.skippedReason).toBe('cloud_runtime');
    expect(vercelEnv.SUPABASE_URL).toBeUndefined();
  });

  test('isLocalSupabaseUrl recognizes only loopback and local Docker hostnames', () => {
    expect(isLocalSupabaseUrl('http://127.0.0.1:54321')).toBe(true);
    expect(isLocalSupabaseUrl('http://localhost:54321')).toBe(true);
    expect(isLocalSupabaseUrl('http://host.docker.internal:54321')).toBe(true);
    expect(isLocalSupabaseUrl('http://[::1]:54321')).toBe(true);

    expect(isLocalSupabaseUrl('https://qkedqxlmsafiogjnpaqh.supabase.co')).toBe(false);
    expect(isLocalSupabaseUrl('')).toBe(false);
    expect(isLocalSupabaseUrl(null)).toBe(false);
    expect(isLocalSupabaseUrl('not-a-valid-url')).toBe(false);
  });

  test('assertSafeDatabaseTarget blocks remote Supabase URLs in local development', () => {
    expect(() =>
      assertSafeDatabaseTarget('https://prod-ref.supabase.co', { APP_ENV: 'development' })
    ).toThrow(/DB Safety Guard.*prod-ref\.supabase\.co/);

    expect(() =>
      assertSafeDatabaseTarget('http://127.0.0.1:54321', { APP_ENV: 'development' })
    ).not.toThrow();

    expect(() =>
      assertSafeDatabaseTarget('https://prod-ref.supabase.co', {
        APP_ENV: 'development',
        ALLOW_REMOTE_DB_IN_DEV: 'true',
      })
    ).not.toThrow();

    expect(() =>
      assertSafeDatabaseTarget('https://prod-ref.supabase.co', {
        APP_ENV: 'development',
        DB_MODE: 'memory',
      })
    ).not.toThrow();

    expect(() =>
      assertSafeDatabaseTarget('https://prod-ref.supabase.co', { VERCEL: '1' })
    ).not.toThrow();

    expect(() =>
      assertSafeDatabaseTarget('https://prod-ref.supabase.co', { RENDER: 'true' })
    ).not.toThrow();

    expect(() =>
      assertSafeDatabaseTarget('https://prod-ref.supabase.co', { NODE_ENV: 'production' })
    ).not.toThrow();
  });

  test('runtime helpers classify app environment, test, cloud, and DB metadata accurately', () => {
    expect(getAppEnv({ APP_ENV: 'Staging' })).toBe('staging');
    expect(isTestRuntime({ JEST_WORKER_ID: '1' })).toBe(true);
    expect(isCloudRuntime({ VERCEL: '1' })).toBe(true);

    expect(
      getDatabaseEnvironmentInfo('http://127.0.0.1:54321', true, { APP_ENV: 'development' })
    ).toEqual({
      appEnv: 'development',
      dbTarget: 'local-docker',
      host: '127.0.0.1:54321',
      isLocal: true,
      isProduction: false,
    });

    expect(
      getDatabaseEnvironmentInfo('https://prod-ref.supabase.co', true, {
        NODE_ENV: 'production',
      })
    ).toEqual({
      appEnv: 'production',
      dbTarget: 'supabase-cloud',
      host: 'prod-ref.supabase.co',
      isLocal: false,
      isProduction: true,
    });

    expect(getDatabaseEnvironmentInfo('', false, { APP_ENV: 'development' })).toEqual({
      appEnv: 'development',
      dbTarget: 'in-memory',
      host: null,
      isLocal: false,
      isProduction: false,
    });
  });

  test('db.getSupabaseHeaders omits Authorization Bearer for sb_ keys and keeps it for legacy JWT keys', () => {
    const legacyHeaders = db.getSupabaseHeaders({}, 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.legacy');
    expect(legacyHeaders.apikey).toBe('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.legacy');
    expect(legacyHeaders.Authorization).toBe('Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.legacy');

    const secretHeaders = db.getSupabaseHeaders({ Prefer: 'return=minimal' }, 'sb_secret_local_key');
    expect(secretHeaders.apikey).toBe('sb_secret_local_key');
    expect(secretHeaders.Authorization).toBeUndefined();
    expect(secretHeaders.Prefer).toBe('return=minimal');

    const publishableHeaders = db.getSupabaseHeaders({}, 'sb_publishable_local_key');
    expect(publishableHeaders.apikey).toBe('sb_publishable_local_key');
    expect(publishableHeaders.Authorization).toBeUndefined();
  });

  test('systemOperationService.getHealthStatus exposes non-sensitive environment and dbTarget metadata', () => {
    const status = systemOperationService.getHealthStatus();
    expect(status.status).toBe('ok');
    expect(typeof status.supabase).toBe('boolean');
    expect(status.environment).toBeDefined();
    expect(['local-docker', 'supabase-cloud', 'in-memory']).toContain(status.dbTarget);
  });
});
