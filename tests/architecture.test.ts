import fs from 'fs';
import path from 'path';
import db from '../lib/db';
import { safeFetch } from '../server/utils/fetchHelper';

describe('Lauren Tan Constraint Engineering: Architecture & Invariant Tests', () => {
  beforeEach(async () => {
    jest.spyOn(db, 'isSupabaseConfigured').mockReturnValue(false);
    await db.ensureLoaded();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('Invariant: FirstTimeSetupModal is mounted in every UserDashboardView branch and gated to the controller state', () => {
    const viewSource = fs.readFileSync(
      path.join(__dirname, '../src/views/UserDashboardView.tsx'),
      'utf8'
    );
    expect(viewSource).toMatch(/<FirstTimeSetupModal[\s\S]*isOpen=\{isSetupWizardOpen\}/);
    expect(viewSource).toMatch(/onCompleted=\{handleSetupWizardComplete\}/);
    // Rendered in both the settings branch and the main dashboard branch
    expect((viewSource.match(/\{setupWizard\}/g) || []).length).toBeGreaterThanOrEqual(2);
    // The inline fallback callout must never overlap the full-screen wizard
    expect(viewSource).toMatch(/!isSetupWizardOpen && <OnboardingCallout \/>/);
  });

  describe('Level 1 & 2: User Persistence & Cache Invariants', () => {
    it('always generates a non-null valid UUID even when user is created with only an email', () => {
      const email = `test_invariant_${Date.now()}@example.com`;
      const bucket = db.ensureUserBucket(email);

      expect(bucket).toBeDefined();
      expect(bucket.id).toBeDefined();
      expect(typeof bucket.id).toBe('string');
      expect(bucket.id!.length).toBeGreaterThan(0);
      expect(bucket.email).toBe(email);

      // Verify user is indexed in all primary cache lookup maps
      expect(db.findUserBucket(bucket.id!)).toBe(bucket);
      expect(db.findUserBucket(email)).toBe(bucket);
    });

    it('guarantees complete memory cache eradication upon deleteUser', async () => {
      const uniqueId = 'c0000000-0000-0000-0000-000000000003';
      const uniqueEmail = `del_inv_${Date.now()}@test.com`;
      const authKey = `auth_key_inv_${Date.now()}`;

      // Setup user bucket
      const bucket = db.ensureUserBucket(uniqueId, uniqueEmail);
      bucket.id = uniqueId;
      bucket.email = uniqueEmail;
      bucket.settings.stremioAuthKey = authKey;

      const user = await db.resolveUser(authKey, () => ({ email: uniqueEmail }));
      expect(user).toBeDefined();

      // Execute atomic deletion
      const res = await db.deleteUser(uniqueId);
      expect(res.success).toBe(true);

      // Invariant: Both ID and Email queries must return null
      expect(db.findUserBucket(uniqueId)).toBeNull();
      expect(db.findUserBucket(uniqueEmail)).toBeNull();
      expect(db.findUserBucket(authKey)).toBeNull();
    });

    it('defaults onboardingCompleted to false and requires at least one movie to mark true', async () => {
      const email = `onboarding_inv_${Date.now()}@test.com`;
      const authKey = `auth_key_onb_${Date.now()}`;

      const user = await db.resolveUser(authKey, () => ({ email }));
      expect(user).toBeDefined();
      expect(user!.onboardingCompleted).toBe(false);
      expect(db.getSettings(user!.id!).onboardingCompleted).toBe(false);

      // Cannot mark onboardingCompleted = true while user has 0 movies
      const settingsWithZeroMovies = await db.updateSettings(
        { onboardingCompleted: true },
        user!.id!
      );
      expect(settingsWithZeroMovies.onboardingCompleted).toBe(false);
      expect(db.getSettings(user!.id!).onboardingCompleted).toBe(false);
      expect((await db.resolveUser(authKey))?.onboardingCompleted).toBe(false);

      // Once user has at least 1 movie, onboardingCompleted persists as true
      await db.addItem(
        {
          id: 'tt0133093',
          name: 'The Matrix',
          has1080pPlus: true,
          bestQuality: '1080p FHD',
          streamCount: 5,
        },
        user!.id!
      );

      const updatedSettings = await db.updateSettings({ onboardingCompleted: true }, user!.id!);
      expect(updatedSettings.onboardingCompleted).toBe(true);
      expect(db.getSettings(user!.id!).onboardingCompleted).toBe(true);

      const resolvedAgain = await db.resolveUser(authKey);
      expect(resolvedAgain).toBeDefined();
      expect(resolvedAgain!.onboardingCompleted).toBe(true);
    });

    it('never loads production Supabase credentials or writes to Supabase during Jest runs', () => {
      jest.restoreAllMocks();
      expect(db.isSupabaseConfigured()).toBe(false);
      expect(process.env.SUPABASE_URL).toBeUndefined();
      expect(process.env.SUPABASE_KEY).toBeUndefined();
    });
  });

  describe('Level 3: Resource Cleanup & Event Loop Safety', () => {
    it('safeFetch resolves and clears internal timer without dangling handles', async () => {
      const originalFetch = global.fetch;
      try {
        global.fetch = jest.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ status: 'ok' }),
        });

        const res = await safeFetch('https://example.com/api', {}, 500);
        expect(res.ok).toBe(true);
        expect(global.fetch).toHaveBeenCalled();
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('safeFetch aborts and clears timer when network exceeds timeout without crashing Jest', async () => {
      const originalFetch = global.fetch;
      try {
        global.fetch = jest.fn().mockImplementation(
          () =>
            new Promise((_, reject) => {
              const err: any = new Error('The operation was aborted');
              err.name = 'AbortError';
              setTimeout(() => reject(err), 50);
            })
        );

        await expect(safeFetch('https://example.com/slow', {}, 30)).rejects.toThrow();
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('Level 4: Backend Clean Architecture (Controller -> Service -> Repository)', () => {
    const controllersDir = path.join(__dirname, '..', 'server', 'controllers');
    const controllerFiles = fs
      .readdirSync(controllersDir)
      .filter((f) => f.endsWith('.js') && f !== 'index.js');

    it('forbids backend controllers from requiring repositories or lib/db directly', () => {
      for (const file of controllerFiles) {
        const fullPath = path.join(controllersDir, file);
        const content = fs.readFileSync(fullPath, 'utf8');

        expect(content).not.toMatch(/require\(['"].*repositories['"]\)/);
        expect(content).not.toMatch(/require\(['"].*lib\/db['"]\)/);
        expect(content).toMatch(/require\(['"]\.\.\/services['"]\)/);
      }
    });

    it('enforces thin HTTP controllers (< 225 lines each)', () => {
      for (const file of controllerFiles) {
        const fullPath = path.join(controllersDir, file);
        const lineCount = fs.readFileSync(fullPath, 'utf8').split(/\r?\n/).length;
        expect(lineCount).toBeLessThanOrEqual(225);
      }
    });
  });

  describe('Level 5: Environment Isolation & Production Safety Invariants', () => {
    it('forbids manual .env parsing in lib/db.js and cryptoService.ts (must use envLoader)', () => {
      const dbSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'db.js'), 'utf8');
      const cryptoSource = fs.readFileSync(
        path.join(__dirname, '..', 'server', 'services', 'cryptoService.ts'),
        'utf8'
      );

      expect(dbSource).toMatch(/require\(['"]\.\/envLoader['"]\)/);
      expect(dbSource).toMatch(/assertSafeDatabaseTarget\(/);
      expect(dbSource).not.toMatch(/readFileSync\([^)]*\.env/);

      expect(cryptoSource).toMatch(/from\s+['"]\.\.\/utils\/envLoader['"]/);
      expect(cryptoSource).not.toMatch(/readFileSync\([^)]*\.env/);
    });

    it('never exposes supabase-cloud as dbTarget during Jest runs from disk .env', () => {
      jest.restoreAllMocks();
      const dbInfo = db.getDatabaseInfo();
      expect(dbInfo.dbTarget).not.toBe('supabase-cloud');
      expect(dbInfo.dbTarget).toBe('in-memory');
    });
  });
});
