const crypto = require('crypto');
const { encryptText, decryptText } = require('./crypto');
const {
  loadEnvironment,
  isTestRuntime,
  assertSafeDatabaseTarget,
  getDatabaseEnvironmentInfo,
} = require('./envLoader');

loadEnvironment();
const IS_TEST_ENV = isTestRuntime();
const FORCE_IN_MEMORY = String(process.env.DB_MODE || '').trim().toLowerCase() === 'memory';

// Supabase configuration from environment variables
const SUPABASE_URL = FORCE_IN_MEMORY ? '' : (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = FORCE_IN_MEMORY
  ? ''
  : process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    '';

assertSafeDatabaseTarget(SUPABASE_URL);

const DEFAULT_SETTINGS = {
  stremioAuthKey: null,
  minQuality: '1080p', // '1080p' ou '4k'
  autoSyncWatched: false, // Sincronização automática em background desativada por padrão
  trackWatchlistWatched: true, // Rastrear filmes da lista assistidos após adição (ativo por padrão)
  syncPreviouslyWatched: false, // Sincronizar filmes assistidos anteriormente no Stremio (desativado por padrão)
  onboardingCompleted: false, // Whether first-login setup wizard was completed
};

const BUILTIN_EXCLUDED_USER_IDS = new Set([
  '0ae027a6-56e6-41d5-a25b-86fc1e04aed4',
  'aa1bdc75-f539-4e11-8c90-510c0e998ce8',
]);

function isUserAdmin(bucketOrUser) {
  if (!bucketOrUser) return false;
  // 1. Column in Supabase table watchlist_users
  if (bucketOrUser.is_admin === true || bucketOrUser.isAdmin === true) {
    return true;
  }

  // 2. Private environment variable (outside of Git)
  const email = bucketOrUser.email ? normalizeKey(bucketOrUser.email) : '';
  const adminEnv = (process.env.ADMIN_EMAIL || process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => normalizeKey(e))
    .filter(Boolean);

  if (email && adminEnv.includes(email)) {
    return true;
  }

  return false;
}

let memoryCache = null;
let supabaseLoaded = false;
let lastSupabaseSync = 0;
const DB_CACHE_TTL_MS = parseInt(process.env.DB_CACHE_TTL_MS || '180000', 10);
let initPromise = null;

function isSupabaseConfigured() {
  if (IS_TEST_ENV || FORCE_IN_MEMORY) return false;
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

function normalizeKey(str) {
  if (!str || typeof str !== 'string') return '';
  return str.trim().toLowerCase();
}

function cleanImdbId(rawId) {
  if (!rawId) return '';
  const str = String(rawId).trim();
  if (str.toLowerCase().startsWith('tmdb:')) return str;
  return str.includes(':') ? str.split(':').pop() : str;
}

/**
 * Validates whether an ID belongs to a legitimate movie (IMDb 'tt...' or TMDB 'tmdb:...').
 * Ignores third-party utility IDs (e.g. 'dlrealdebrid', 'delete_all', etc.).
 */
function isLegitimateMovieId(rawId) {
  if (!rawId) return false;
  const str = String(rawId).trim().toLowerCase();
  return /^tt\d+$/.test(str) || /^tmdb:\d+$/.test(str);
}

function getDatabaseInfo() {
  return getDatabaseEnvironmentInfo(SUPABASE_URL, isSupabaseConfigured());
}

function getSupabaseHeaders(extra = {}, apiKey = SUPABASE_KEY) {
  const headers = {
    apikey: apiKey,
    'Content-Type': 'application/json',
    ...extra,
  };
  // New sb_publishable_ / sb_secret_ keys are not JWTs; sending them as Bearer fails with Invalid JWT.
  if (apiKey && !String(apiKey).startsWith('sb_')) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

function isItemReady(item, globalMinQuality = '1080p') {
  if (!item) return false;
  const target = globalMinQuality || '1080p';
  const rawQuality = String(item.bestQuality || '').toLowerCase();
  if (target === '4k') {
    return rawQuality.includes('4k') || rawQuality.includes('2160p') || rawQuality.includes('uhd');
  }
  return Boolean(item.has1080pPlus);
}

function isItemUnreleased(item) {
  if (!item || item.has1080pPlus || item.isWatched) return false;
  const q = String(item.bestQuality || '').toLowerCase();
  if (
    q.includes('unreleased') ||
    q.includes('not released') ||
    q.includes('unavailable') ||
    q.includes('não lançado') ||
    q.includes('indisponível')
  )
    return true;
  if ((!item.streamCount || item.streamCount === 0) && !q.includes('cam')) return true;
  return false;
}

// Converte linha do Postgres (snake_case) para objeto da aplicação (camelCase)
function rowToItem(row) {
  const imdbId = row.imdb_id;
  const has1080pPlus = Boolean(row.has_1080p_plus);
  return {
    id: imdbId,
    rowId: row.id,
    userId: row.user_id, // UUID único do usuário
    type: 'movie',
    name: row.name || imdbId,
    year: row.year || '',
    poster: row.poster || '',
    imdbRating: row.imdb_rating || row.imdbRating || '',
    addedAt: row.added_at || new Date().toISOString(),
    has1080pPlus,
    bestQuality: row.best_quality || 'Pending',
    streamCount: Number(row.stream_count || 0),
    lastChecked: row.last_checked || null,
    readyAt: row.ready_at || (has1080pPlus ? row.last_checked || row.added_at : null),
    isWatched: Boolean(row.is_watched),
    watchedAt: row.watched_at || null,
    customLists: Array.isArray(row.custom_lists) ? row.custom_lists : [],
  };
}

// Converte objeto da aplicação para linha relacional do Postgres
function itemToRow(item, userUuid) {
  const imdbId = cleanImdbId(item.id || item.imdbId);
  const has1080pPlus = Boolean(item.has1080pPlus);
  return {
    user_id: userUuid,
    imdb_id: imdbId,
    name: item.name || imdbId,
    year: item.year ? String(item.year) : '',
    poster: item.poster || '',
    added_at: item.addedAt || new Date().toISOString(),
    has_1080p_plus: has1080pPlus,
    best_quality: item.bestQuality || 'Pending',
    stream_count: Number(item.streamCount || 0),
    last_checked: item.lastChecked || null,
    ready_at: has1080pPlus ? item.readyAt || new Date().toISOString() : null,
    is_watched: Boolean(item.isWatched),
    watched_at: item.watchedAt || null,
    custom_lists: Array.isArray(item.customLists) ? item.customLists : [],
  };
}

function normalizeItem(item, userUuid) {
  const imdbId = cleanImdbId(item.id);
  const has1080pPlus = Boolean(item.has1080pPlus);
  const readyAt = has1080pPlus ? item.readyAt || new Date().toISOString() : null;
  return {
    id: imdbId,
    userId: userUuid || item.userId || '',
    type: 'movie',
    name: item.name || imdbId,
    year: item.year || '',
    poster: item.poster || '',
    imdbRating: item.imdbRating
      ? String(item.imdbRating)
      : item.imdb_rating
        ? String(item.imdb_rating)
        : '',
    addedAt: item.addedAt || new Date().toISOString(),
    has1080pPlus,
    bestQuality: item.bestQuality || 'Pending',
    streamCount: Number(item.streamCount || 0),
    lastChecked: item.lastChecked || null,
    readyAt,
    isWatched: Boolean(item.isWatched),
    watchedAt: item.watchedAt || null,
    customLists: Array.isArray(item.customLists)
      ? item.customLists
      : Array.isArray(item.custom_lists)
        ? item.custom_lists
        : [],
  };
}

function initMemoryCache() {
  if (!memoryCache) {
    memoryCache = {
      usersById: {}, // uuid -> userBucket
      usersByEmail: {}, // email -> userBucket
      users: {}, // key (uuid ou email) -> userBucket
      authKeyMap: {}, // authKey -> userBucket
    };
  }
  return memoryCache;
}

function findUserBucket(identifier) {
  if (!identifier) return null;
  const cache = initMemoryCache();
  const key = normalizeKey(String(identifier));
  return cache.usersById[key] || cache.usersByEmail[key] || cache.users[key] || null;
}

function ensureUserBucket(identifier, emailFallback = '') {
  const cache = initMemoryCache();
  let bucket = findUserBucket(identifier);
  if (bucket) {
    if (!bucket.id) {
      bucket.id = crypto.randomUUID ? crypto.randomUUID() : 'usr_' + Date.now();
      cache.usersById[bucket.id] = bucket;
      cache.users[bucket.id] = bucket;
    }
    return bucket;
  }

  const key = normalizeKey(String(identifier));
  const isEmail = key.includes('@');
  const email = isEmail ? key : normalizeKey(emailFallback);
  const id =
    !isEmail && key
      ? key
      : crypto.randomUUID
        ? crypto.randomUUID()
        : 'usr_' + Date.now() + Math.random().toString(36).substring(2, 7);

  bucket = {
    id: id,
    email: email,
    isAdmin: false,
    settings: { ...DEFAULT_SETTINGS },
    items: [],
    customLists: [],
  };

  if (id) {
    cache.usersById[id] = bucket;
    cache.users[id] = bucket;
  }
  if (email) {
    cache.usersByEmail[email] = bucket;
    cache.users[email] = bucket;
  }

  return bucket;
}

// -------------------------------------------------------------
// SUPABASE CLOUD OPERATIONS (PostgREST API)
// -------------------------------------------------------------

async function supabaseSaveUser(bucket) {
  if (!isSupabaseConfigured() || !bucket || !bucket.email) return false;
  try {
    const rawKey = bucket.settings?.stremioAuthKey;
    const encryptedKey = rawKey ? encryptText(rawKey) : null;

    const row = {
      email: bucket.email,
      stremio_auth_key: encryptedKey,
      min_quality: bucket.settings?.minQuality || '1080p',
      auto_sync_watched: Boolean(bucket.settings?.autoSyncWatched),
      track_watchlist_watched: bucket.settings?.trackWatchlistWatched !== false,
      sync_previously_watched: Boolean(bucket.settings?.syncPreviouslyWatched),
      onboarding_completed: Boolean(bucket.settings?.onboardingCompleted),
      updated_at: new Date().toISOString(),
    };
    if (bucket.id) {
      row.id = bucket.id;
    }

    const res = await fetch(`${SUPABASE_URL}/rest/v1/watchlist_users?on_conflict=email`, {
      method: 'POST',
      headers: getSupabaseHeaders({
        Prefer: 'resolution=merge-duplicates,return=representation',
      }),
      body: JSON.stringify([row]),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Status ${res.status}: ${errText}`);
    }

    const savedRows = await res.json();
    if (Array.isArray(savedRows) && savedRows[0] && savedRows[0].id) {
      const assignedId = savedRows[0].id;
      bucket.id = assignedId;
      const cache = initMemoryCache();
      cache.usersById[assignedId] = bucket;
      cache.users[assignedId] = bucket;
    }
    return true;
  } catch (err) {
    console.error('[Supabase] Erro ao salvar usuário no banco:', err.message);
    return false;
  }
}

async function supabaseUpsertItems(items, userIdentifier) {
  let bucket = findUserBucket(userIdentifier);
  if (
    !isSupabaseConfigured() ||
    !bucket ||
    !bucket.id ||
    !Array.isArray(items) ||
    items.length === 0
  ) {
    return false;
  }
  try {
    const rows = items.map((item) => itemToRow(item, bucket.id));
    const res = await fetch(`${SUPABASE_URL}/rest/v1/watchlist_items?on_conflict=user_id,imdb_id`, {
      method: 'POST',
      headers: getSupabaseHeaders({
        Prefer: 'resolution=merge-duplicates,return=minimal',
      }),
      body: JSON.stringify(rows),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Status ${res.status}: ${errText}`);
    }
    return true;
  } catch (err) {
    console.error('[Supabase] Erro ao salvar item(ns):', err.message);
    return false;
  }
}

async function supabaseDeleteItem(imdbId, userIdentifier) {
  const bucket = findUserBucket(userIdentifier);
  const cleanId = cleanImdbId(imdbId);
  if (!isSupabaseConfigured() || !bucket || !bucket.id || !cleanId) return false;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/watchlist_items?user_id=eq.${encodeURIComponent(bucket.id)}&imdb_id=eq.${encodeURIComponent(cleanId)}`,
      {
        method: 'DELETE',
        headers: getSupabaseHeaders(),
      }
    );
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Status ${res.status}: ${errText}`);
    }
    return true;
  } catch (err) {
    console.error('[Supabase] Erro ao remover item:', err.message);
    return false;
  }
}

/**
 * Busca todas as linhas paginadas do Supabase caso ultrapassem o limite padrão (1000 rows).
 */
async function fetchAllSupabaseRows(tablePath) {
  const pageSize = 1000;
  let offset = 0;
  const allRows = [];
  while (true) {
    const sep = tablePath.includes('?') ? '&' : '?';
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${tablePath}${sep}limit=${pageSize}&offset=${offset}`, {
      headers: getSupabaseHeaders(),
    });
    if (!res.ok) {
      if (offset === 0) return null;
      break;
    }
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) break;
    allRows.push(...rows);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return allRows;
}

/**
 * Sincroniza usuários e itens do Supabase para o cache em memória.
 */
async function syncFromSupabase(force = false) {
  initMemoryCache();
  if (!isSupabaseConfigured()) {
    return memoryCache;
  }

  const now = Date.now();
  if (!force && supabaseLoaded && now - lastSupabaseSync < DB_CACHE_TTL_MS) {
    return memoryCache;
  }

  try {
    const [uRows, listsRows, iRows] = await Promise.all([
      fetchAllSupabaseRows('watchlist_users?select=*'),
      fetchAllSupabaseRows('watchlist_custom_lists?select=*&order=created_at.asc'),
      fetchAllSupabaseRows('watchlist_items?select=*&order=added_at.desc'),
    ]);

    const newUsersById = {};
    const newUsersByEmail = {};
    const newUsers = {};
    const newAuthKeyMap = {};

    if (Array.isArray(uRows)) {
      for (const u of uRows) {
        const userUuid = u.id;
        const email = normalizeKey(u.email);
        if (!userUuid || !email) continue;
        const decryptedKey = u.stremio_auth_key ? decryptText(u.stremio_auth_key) : null;
        const bucket = {
          id: userUuid,
          email: email,
          isAdmin: isUserAdmin(u),
          settings: {
            stremioAuthKey: decryptedKey,
            minQuality: u.min_quality || '1080p',
            autoSyncWatched: Boolean(u.auto_sync_watched),
            trackWatchlistWatched: u.track_watchlist_watched !== false,
            syncPreviouslyWatched: Boolean(u.sync_previously_watched),
            onboardingCompleted: Boolean(u.onboarding_completed),
          },
          items: [],
          customLists: [],
        };
        newUsersById[userUuid] = bucket;
        newUsersByEmail[email] = bucket;
        newUsers[userUuid] = bucket;
        newUsers[email] = bucket;
        if (decryptedKey) {
          newAuthKeyMap[decryptedKey] = bucket;
        }
      }
    }

    if (Array.isArray(listsRows)) {
      for (const l of listsRows) {
        const userUuid = l.user_id;
        const bucket = newUsersById[userUuid] || newUsersByEmail[normalizeKey(userUuid)] || newUsers[userUuid];
        if (bucket) {
          bucket.customLists.push({
            id: l.id,
            userId: l.user_id,
            name: l.name,
            emoji: l.emoji || '',
            createdAt: l.created_at,
            updatedAt: l.updated_at,
          });
        }
      }
    }

    if (Array.isArray(iRows)) {
      for (const row of iRows) {
        const item = rowToItem(row);
        const userUuid = row.user_id;
        let bucket = newUsersById[userUuid] || newUsersByEmail[normalizeKey(userUuid)] || newUsers[userUuid];
        if (!bucket && userUuid) {
          const isEmail = String(userUuid).includes('@');
          bucket = {
            id: userUuid,
            email: isEmail ? normalizeKey(userUuid) : '',
            isAdmin: false,
            settings: { ...DEFAULT_SETTINGS },
            items: [],
            customLists: [],
          };
          newUsersById[userUuid] = bucket;
          newUsers[userUuid] = bucket;
          if (isEmail) newUsersByEmail[bucket.email] = bucket;
        }
        if (bucket) {
          if (!bucket.items.some((i) => i.id === item.id)) {
            bucket.items.push(item);
          }
        }
      }
    }

    memoryCache.usersById = newUsersById;
    memoryCache.usersByEmail = newUsersByEmail;
    memoryCache.users = newUsers;
    memoryCache.authKeyMap = newAuthKeyMap;
    supabaseLoaded = true;
    lastSupabaseSync = Date.now();
    return memoryCache;
  } catch (err) {
    console.error('[Supabase] Falha de conexão ao sincronizar:', err.message);
    return memoryCache;
  }
}

async function ensureLoaded(force = false) {
  if (!isSupabaseConfigured()) {
    return initMemoryCache();
  }
  if (!initPromise || force || Date.now() - lastSupabaseSync > DB_CACHE_TTL_MS) {
    initPromise = syncFromSupabase(force).finally(() => {
      initPromise = null;
    });
  }
  return initPromise;
}

/**
 * Resolve uma authKey para o objeto do usuário { id: UUID, email: string }.
 * Cria o usuário com UUID único no banco se ainda não estiver cadastrado.
 */
async function resolveUser(identifier, getUserInfoFn) {
  if (!identifier || typeof identifier !== 'string') return null;
  await ensureLoaded();

  // 1. Check if identifier is already a userId (UUID) or email
  const directBucket = findUserBucket(identifier);
  if (directBucket && directBucket.id) {
    if (isUserAdmin(directBucket)) directBucket.isAdmin = true;
    return {
      id: directBucket.id,
      email: directBucket.email,
      isAdmin: Boolean(directBucket.isAdmin),
      onboardingCompleted: Boolean(directBucket.settings?.onboardingCompleted),
    };
  }

  // 2. Check if authKey is in cache map
  const cachedBucket = memoryCache.authKeyMap[identifier];
  if (cachedBucket && cachedBucket.id) {
    if (isUserAdmin(cachedBucket)) cachedBucket.isAdmin = true;
    return {
      id: cachedBucket.id,
      email: cachedBucket.email,
      isAdmin: Boolean(cachedBucket.isAdmin),
      onboardingCompleted: Boolean(cachedBucket.settings?.onboardingCompleted),
    };
  }

  // 3. If it's a Stremio authKey, resolve via Stremio API
  if (typeof getUserInfoFn === 'function') {
    const stremioUser = await getUserInfoFn(identifier);
    if (stremioUser && stremioUser.email) {
      const email = normalizeKey(stremioUser.email);
      let bucket = memoryCache.usersByEmail[email];
      if (!bucket) {
        bucket = ensureUserBucket(email);
      }
      bucket.settings.stremioAuthKey = identifier;
      if (isUserAdmin(bucket)) bucket.isAdmin = true;
      await supabaseSaveUser(bucket);
      memoryCache.authKeyMap[identifier] = bucket;
      return {
        id: bucket.id,
        email: bucket.email,
        isAdmin: Boolean(bucket.isAdmin),
        onboardingCompleted: Boolean(bucket.settings?.onboardingCompleted),
      };
    }
  }
  return null;
}

// -------------------------------------------------------------
// CRUD METHODS (ISOLADOS POR USUÁRIO VIA ID ÚNICO)
// -------------------------------------------------------------

function getItems(userIdentifier) {
  const bucket = findUserBucket(userIdentifier);
  return bucket ? bucket.items : [];
}

function getAllUsersItems() {
  const cache = initMemoryCache();
  const result = [];
  const processedUids = new Set();
  for (const bucket of Object.values(cache.usersById)) {
    if (!bucket || !bucket.id || processedUids.has(bucket.id)) continue;
    processedUids.add(bucket.id);
    for (const item of bucket.items || []) {
      result.push({ userId: bucket.id, userEmail: bucket.email, item });
    }
  }
  return result;
}

function getAllUsers() {
  const cache = initMemoryCache();
  const users = [];
  const processed = new Set();
  for (const bucket of Object.values(cache.usersById)) {
    if (!bucket || !bucket.id || processed.has(bucket.id)) continue;
    processed.add(bucket.id);
    users.push({
      id: bucket.id,
      email: bucket.email,
      isAdmin: Boolean(bucket.isAdmin),
      authKey: bucket.settings?.stremioAuthKey || null,
      settings: bucket.settings || {},
      customLists: bucket.customLists || [],
      itemsCount: (bucket.items || []).length,
    });
  }
  return users;
}

function getItem(id, userIdentifier) {
  const cleanId = cleanImdbId(id);
  const items = getItems(userIdentifier);
  return items.find((item) => item.id === cleanId);
}

async function addItem(item, userIdentifier) {
  let bucket = findUserBucket(userIdentifier);
  if (!bucket) {
    bucket = ensureUserBucket(userIdentifier);
    if (!bucket.id) {
      await supabaseSaveUser(bucket);
    }
  }
  if (!bucket || !bucket.id) return null;

  const cleanId = cleanImdbId(item.id);
  if (!isLegitimateMovieId(cleanId)) return null;
  const existingIndex = bucket.items.findIndex((i) => i.id === cleanId);
  const newItem = normalizeItem(
    {
      ...(existingIndex >= 0 ? bucket.items[existingIndex] : {}),
      ...item,
      id: cleanId,
    },
    bucket.id
  );

  if (existingIndex >= 0) {
    bucket.items[existingIndex] = newItem;
  } else {
    bucket.items.unshift(newItem);
  }

  await supabaseUpsertItems([newItem], bucket.id);
  return newItem;
}

async function updateItem(id, updates, userIdentifier) {
  const bucket = findUserBucket(userIdentifier);
  if (!bucket || !bucket.id) return null;
  const cleanId = cleanImdbId(id);
  const index = bucket.items.findIndex((i) => i.id === cleanId);
  if (index >= 0) {
    bucket.items[index] = normalizeItem(
      { ...bucket.items[index], ...updates, id: cleanId },
      bucket.id
    );
    await supabaseUpsertItems([bucket.items[index]], bucket.id);
    return bucket.items[index];
  }
  return null;
}

async function removeItem(id, userIdentifier) {
  const bucket = findUserBucket(userIdentifier);
  if (!bucket || !bucket.id) return false;
  const cleanId = cleanImdbId(id);
  const initialLength = bucket.items.length;
  bucket.items = bucket.items.filter((i) => i.id !== cleanId);
  const removed = bucket.items.length < initialLength;
  if (removed) {
    await supabaseDeleteItem(cleanId, bucket.id);
  }
  return removed;
}

async function setWatched(id, isWatched, userIdentifier) {
  const bucket = findUserBucket(userIdentifier);
  if (!bucket || !bucket.id) return null;
  const cleanId = cleanImdbId(id);
  const index = bucket.items.findIndex((i) => i.id === cleanId);
  if (index >= 0) {
    const item = bucket.items[index];
    item.isWatched = Boolean(isWatched);
    item.watchedAt = isWatched ? new Date().toISOString() : null;
    await supabaseUpsertItems([item], bucket.id);
    return item;
  }
  return null;
}

function getSettings(userIdentifier) {
  const bucket = findUserBucket(userIdentifier);
  if (!bucket) return { ...DEFAULT_SETTINGS };
  return {
    ...DEFAULT_SETTINGS,
    ...(bucket.settings || {}),
    stremioAuthKey: bucket.settings?.stremioAuthKey ? '********' : null,
    minQuality: bucket.settings?.minQuality || '1080p',
    autoSyncWatched: Boolean(bucket.settings?.autoSyncWatched),
    trackWatchlistWatched: bucket.settings?.trackWatchlistWatched !== false,
    syncPreviouslyWatched: Boolean(bucket.settings?.syncPreviouslyWatched),
    onboardingCompleted: Boolean(bucket.settings?.onboardingCompleted),
  };
}

async function updateSettings(newSettings, userIdentifier) {
  let bucket = findUserBucket(userIdentifier);
  if (!bucket) {
    bucket = ensureUserBucket(userIdentifier);
  }

  const safeSettings = { ...newSettings };
  delete safeSettings.id;
  if (safeSettings.stremioAuthKey === '********' || safeSettings.stremioAuthKey === undefined) {
    delete safeSettings.stremioAuthKey;
  }
  if (safeSettings.autoSyncWatched !== undefined) {
    safeSettings.autoSyncWatched = Boolean(safeSettings.autoSyncWatched);
  }
  if (safeSettings.trackWatchlistWatched !== undefined) {
    safeSettings.trackWatchlistWatched = Boolean(safeSettings.trackWatchlistWatched);
  }
  if (safeSettings.syncPreviouslyWatched !== undefined) {
    safeSettings.syncPreviouslyWatched = Boolean(safeSettings.syncPreviouslyWatched);
  }
  if (safeSettings.onboardingCompleted !== undefined) {
    const hasMovies = Array.isArray(bucket.items) && bucket.items.length > 0;
    safeSettings.onboardingCompleted = Boolean(safeSettings.onboardingCompleted) && hasMovies;
  }

  bucket.settings = { ...DEFAULT_SETTINGS, ...bucket.settings, ...safeSettings };
  if (bucket.settings.stremioAuthKey) {
    memoryCache.authKeyMap[bucket.settings.stremioAuthKey] = bucket;
  }

  await supabaseSaveUser(bucket);
  return getSettings(bucket.id || userIdentifier);
}

function getStats(userIdentifier) {
  const bucket = findUserBucket(userIdentifier);
  const items = bucket ? bucket.items : [];
  const minQuality = bucket?.settings?.minQuality || '1080p';

  const unwatched = items.filter((i) => !i.isWatched);
  const watched = items.filter((i) => i.isWatched).length;

  const ready = unwatched.filter((i) => isItemReady(i, minQuality)).length;
  const unreleased = unwatched.filter(
    (i) => !isItemReady(i, minQuality) && isItemUnreleased(i)
  ).length;
  const pending = unwatched.filter(
    (i) => !isItemReady(i, minQuality) && !isItemUnreleased(i)
  ).length;

  return {
    total: unwatched.length,
    ready,
    pending,
    unreleased,
    watched,
  };
}

async function syncWatchedWithStremio(authKey, userIdentifier, options = {}) {
  const bucket = findUserBucket(userIdentifier);
  if (!bucket || !bucket.id || !authKey) {
    return {
      count: 0,
      newlyMarked: 0,
      newlyAdded: 0,
      totalWatched: 0,
      stats: getStats(userIdentifier),
    };
  }

  const settings = getSettings(bucket.id);
  const trackWatchlist =
    options.trackWatchlistWatched !== undefined
      ? Boolean(options.trackWatchlistWatched)
      : settings.trackWatchlistWatched !== false;
  const syncPrevious =
    options.syncPreviouslyWatched !== undefined
      ? Boolean(options.syncPreviouslyWatched)
      : Boolean(settings.syncPreviouslyWatched);

  if (!trackWatchlist && !syncPrevious) {
    return {
      count: 0,
      newlyMarked: 0,
      newlyAdded: 0,
      totalWatched: bucket.items.filter((i) => i.isWatched).length,
      stats: getStats(bucket.id),
    };
  }

  const { getStremioWatchedMovies } = require('./stremioAuth');
  const watchedFromStremio = await getStremioWatchedMovies(authKey);
  if (!Array.isArray(watchedFromStremio) || watchedFromStremio.length === 0) {
    return {
      count: 0,
      newlyMarked: 0,
      newlyAdded: 0,
      totalWatched: bucket.items.filter((i) => i.isWatched).length,
      stats: getStats(bucket.id),
    };
  }

  const itemsToUpsert = [];
  let newlyMarked = 0;
  let newlyAdded = 0;
  const { getMeta } = require('./cinemeta');

  for (const watchedItem of watchedFromStremio) {
    const cleanId = cleanImdbId(watchedItem.id);
    if (!isLegitimateMovieId(cleanId)) continue;
    const existingIndex = bucket.items.findIndex((i) => i.id === cleanId);

    // Se o item do Stremio vier sem ano, busca da Cinemeta
    if ((!watchedItem.year || String(watchedItem.year).trim() === '') && cleanId) {
      try {
        const meta = await getMeta(watchedItem.type || 'movie', cleanId);
        if (meta && meta.year) {
          watchedItem.year = String(meta.year);
          if (meta.name && (!watchedItem.name || watchedItem.name === cleanId)) {
            watchedItem.name = meta.name;
          }
          if (meta.poster && !watchedItem.poster) {
            watchedItem.poster = meta.poster;
          }
          if (meta.imdbRating) {
            watchedItem.imdbRating = String(meta.imdbRating);
          }
        }
      } catch (err) {
        console.warn('[DB] Cinemeta enrichment skipped during watched sync:', err.message);
      }
    }

    if (existingIndex >= 0) {
      const existing = bucket.items[existingIndex];
      let changed = false;

      if (!existing.isWatched) {
        const watchedTime = watchedItem.watchedAt ? new Date(watchedItem.watchedAt).getTime() : 0;
        const addedTime = existing.addedAt ? new Date(existing.addedAt).getTime() : 0;

        // Watched after being added to watchlist (with 60-second clock tolerance)
        const watchedAfterAdded =
          watchedTime > 0 && addedTime > 0 && watchedTime >= addedTime - 60000;

        let shouldMarkWatched = false;
        if (watchedAfterAdded && trackWatchlist) {
          shouldMarkWatched = true;
        } else if (!watchedAfterAdded && syncPrevious) {
          shouldMarkWatched = true;
        }

        if (shouldMarkWatched) {
          existing.isWatched = true;
          existing.watchedAt = watchedItem.watchedAt || new Date().toISOString();
          changed = true;
          newlyMarked++;
        }
      }

      if (!existing.year && watchedItem.year) {
        existing.year = watchedItem.year;
        changed = true;
      }
      if (!existing.imdbRating && watchedItem.imdbRating) {
        existing.imdbRating = watchedItem.imdbRating;
        changed = true;
      }
      if (changed) {
        itemsToUpsert.push(existing);
      }
    } else {
      // Movie was NOT in the user's watchlist: only sync if syncPreviouslyWatched is true
      if (syncPrevious) {
        const newItem = normalizeItem(
          {
            ...watchedItem,
            id: cleanId,
            isWatched: true,
          },
          bucket.id
        );
        bucket.items.push(newItem);
        itemsToUpsert.push(newItem);
        newlyAdded++;
      }
    }
  }

  if (itemsToUpsert.length > 0) {
    await supabaseUpsertItems(itemsToUpsert, bucket.id);
  }

  return {
    count: itemsToUpsert.length,
    newlyMarked,
    newlyAdded,
    totalWatched: bucket.items.filter((i) => i.isWatched).length,
    stats: getStats(bucket.id),
  };
}

// -------------------------------------------------------------
// CUSTOM LISTS (LISTAS PERSONALIZADAS POR USUÁRIO)
// -------------------------------------------------------------

function getCustomLists(userIdentifier) {
  const bucket = findUserBucket(userIdentifier);
  return bucket && Array.isArray(bucket.customLists) ? bucket.customLists : [];
}

async function createCustomList(userIdentifier, { name, emoji = '' }) {
  let bucket = findUserBucket(userIdentifier);
  if (!bucket) {
    bucket = ensureUserBucket(userIdentifier);
    if (!bucket.id) await supabaseSaveUser(bucket);
  }
  if (!bucket || !bucket.id) throw new Error('User not found');

  const listName = (name || '').trim();
  if (!listName) throw new Error('Nome da lista é obrigatório');

  const row = {
    user_id: bucket.id,
    name: listName,
    emoji: emoji ? String(emoji).trim() : '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (isSupabaseConfigured()) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/watchlist_custom_lists`, {
      method: 'POST',
      headers: getSupabaseHeaders({
        Prefer: 'return=representation',
      }),
      body: JSON.stringify([row]),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Erro ao criar lista no Supabase: ${errText}`);
    }

    const saved = await res.json();
    if (Array.isArray(saved) && saved[0] && saved[0].id) {
      row.id = saved[0].id;
    }
  } else {
    row.id = 'list_' + Date.now();
  }

  const listObj = {
    id: row.id,
    userId: bucket.id,
    name: row.name,
    emoji: row.emoji,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  if (!Array.isArray(bucket.customLists)) {
    bucket.customLists = [];
  }
  bucket.customLists.push(listObj);
  return listObj;
}

async function updateCustomList(userIdentifier, listId, { name, emoji }) {
  const bucket = findUserBucket(userIdentifier);
  if (!bucket || !bucket.id) throw new Error('User not found');

  if (!Array.isArray(bucket.customLists)) bucket.customLists = [];
  const listIndex = bucket.customLists.findIndex((l) => l.id === listId);
  if (listIndex === -1) throw new Error('Lista não encontrada');

  const updatedName = name !== undefined ? name.trim() : bucket.customLists[listIndex].name;
  const updatedEmoji =
    emoji !== undefined
      ? emoji
        ? String(emoji).trim()
        : ''
      : bucket.customLists[listIndex].emoji || '';
  const now = new Date().toISOString();

  if (isSupabaseConfigured()) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/watchlist_custom_lists?id=eq.${encodeURIComponent(listId)}&user_id=eq.${encodeURIComponent(bucket.id)}`,
      {
        method: 'PATCH',
        headers: getSupabaseHeaders(),
        body: JSON.stringify({
          name: updatedName,
          emoji: updatedEmoji,
          updated_at: now,
        }),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Erro ao atualizar lista no Supabase: ${errText}`);
    }
  }

  bucket.customLists[listIndex].name = updatedName;
  bucket.customLists[listIndex].emoji = updatedEmoji;
  bucket.customLists[listIndex].updatedAt = now;
  return bucket.customLists[listIndex];
}

async function deleteCustomList(userIdentifier, listId) {
  const bucket = findUserBucket(userIdentifier);
  if (!bucket || !bucket.id) throw new Error('User not found');

  if (isSupabaseConfigured()) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/watchlist_custom_lists?id=eq.${encodeURIComponent(listId)}&user_id=eq.${encodeURIComponent(bucket.id)}`,
      {
        method: 'DELETE',
        headers: getSupabaseHeaders(),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Erro ao deletar lista no Supabase: ${errText}`);
    }
  }

  bucket.customLists = (bucket.customLists || []).filter((l) => l.id !== listId);

  // When a list is deleted, movies that belonged to it must be removed from the watchlist.
  // If an item also belongs to another custom list, remove listId from its customLists and keep it.
  // If an item only belonged to this list, remove it completely from the watchlist.
  const itemsInList = (bucket.items || []).filter(
    (item) => Array.isArray(item.customLists) && item.customLists.includes(listId)
  );

  const itemsToDelete = [];
  const itemsToUpdate = [];

  for (const item of itemsInList) {
    const remainingLists = (item.customLists || []).filter((id) => id !== listId);
    if (remainingLists.length === 0) {
      itemsToDelete.push(item);
    } else {
      item.customLists = remainingLists;
      itemsToUpdate.push(item);
    }
  }

  if (itemsToDelete.length > 0) {
    const deleteIds = new Set(itemsToDelete.map((i) => i.id));
    bucket.items = (bucket.items || []).filter((i) => !deleteIds.has(i.id));

    if (isSupabaseConfigured()) {
      for (const item of itemsToDelete) {
        await supabaseDeleteItem(item.id, bucket.id);
      }
    }
  }

  if (itemsToUpdate.length > 0) {
    await supabaseUpsertItems(itemsToUpdate, bucket.id);
  }

  return {
    success: true,
    deletedItemsCount: itemsToDelete.length,
    deletedItemIds: itemsToDelete.map((i) => i.id),
  };
}

async function setItemCustomLists(userIdentifier, imdbId, listIds) {
  const bucket = findUserBucket(userIdentifier);
  if (!bucket || !bucket.id) throw new Error('User not found');
  const cleanId = cleanImdbId(imdbId);
  const item = (bucket.items || []).find((i) => i.id === cleanId);
  if (!item) throw new Error('Filme não encontrado na sua watchlist');

  const validListIds = Array.isArray(listIds) ? listIds.map(String) : [];
  item.customLists = validListIds;

  await supabaseUpsertItems([item], bucket.id);
  return item;
}

/**
 * Registra um evento de telemetria/analytics na tabela public.analytics_events do Supabase.
 */
async function recordAnalyticsEvent(eventName, metadata = {}, userId = null) {
  if (!eventName || typeof eventName !== 'string') return false;
  if (!isSupabaseConfigured()) return false;
  if (userId && BUILTIN_EXCLUDED_USER_IDS.has(String(userId).toLowerCase())) {
    return false;
  }
  try {
    const row = {
      event_name: eventName.trim(),
      metadata: metadata && typeof metadata === 'object' ? metadata : {},
      user_id: userId || null,
    };
    const res = await fetch(`${SUPABASE_URL}/rest/v1/analytics_events`, {
      method: 'POST',
      headers: getSupabaseHeaders({
        Prefer: 'return=minimal',
      }),
      body: JSON.stringify([row]),
    });
    return res.ok;
  } catch (err) {
    console.error('[Analytics] Erro ao gravar evento no Supabase:', err.message);
    return false;
  }
}

/**
 * Retorna contagem agregada de eventos gravados.
 */
async function getAnalyticsStats() {
  if (!isSupabaseConfigured()) return {};
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/analytics_events?select=event_name,created_at&order=created_at.desc&limit=5000`,
      {
        method: 'GET',
        headers: getSupabaseHeaders(),
      }
    );
    if (!res.ok) return {};
    const rows = await res.json();
    const counts = {};
    for (const r of rows) {
      counts[r.event_name] = (counts[r.event_name] || 0) + 1;
    }
    return {
      totalEvents: rows.length,
      eventsBreakdown: counts,
      recentEvents: rows.slice(0, 10),
    };
  } catch (err) {
    console.error('[Analytics] Erro ao obter stats:', err.message);
    return {};
  }
}

/**
 * Returns raw telemetry events with metadata and timestamps for admin analytics.
 */
async function getAnalyticsRawEvents(limit = 5000) {
  if (!isSupabaseConfigured()) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/analytics_events?select=event_name,metadata,user_id,created_at&order=created_at.desc&limit=${limit}`,
      {
        method: 'GET',
        headers: getSupabaseHeaders(),
      }
    );
    if (!res.ok) return [];
    return await res.json();
  } catch (err) {
    console.error('[Analytics] Erro ao obter raw events:', err.message);
    return [];
  }
}

/**
 * Completely deletes a user and bulldoze all associated data from Supabase and memory cache.
 */
async function deleteUser(userIdentifier) {
  if (!userIdentifier) return { success: false, error: 'User identifier required' };

  let bucket = findUserBucket(userIdentifier);
  let userId = bucket ? bucket.id : null;
  let userEmail = bucket ? bucket.email : null;

  const cache = initMemoryCache();
  for (const b of [
    ...Object.values(cache.usersById),
    ...Object.values(cache.usersByEmail),
    ...Object.values(cache.users),
  ]) {
    if (!b) continue;
    if (
      b.id === userIdentifier ||
      b.email === userIdentifier ||
      normalizeKey(b.email || '') === normalizeKey(userIdentifier)
    ) {
      bucket = bucket || b;
      userId = userId || b.id;
      userEmail = userEmail || b.email;
    }
  }

  if (isSupabaseConfigured()) {
    // If not found in memory bucket, try to query user from Supabase
    if (!userId || !userEmail) {
      try {
        const queryVal = String(userIdentifier).trim();
        const checkRes = await fetch(
          `${SUPABASE_URL}/rest/v1/watchlist_users?or=(id.eq.${encodeURIComponent(queryVal)},email.eq.${encodeURIComponent(queryVal.toLowerCase())})`,
          { headers: getSupabaseHeaders() }
        );
        if (checkRes.ok) {
          const rows = await checkRes.json();
          if (Array.isArray(rows) && rows[0]) {
            userId = rows[0].id || userId;
            userEmail = rows[0].email || userEmail;
          }
        }
      } catch (err) {
        console.error('[Supabase] Error finding user before delete:', err.message);
      }
    }

    const deletePromises = [];

    if (userId) {
      // 1. Delete user custom lists
      deletePromises.push(
        fetch(
          `${SUPABASE_URL}/rest/v1/watchlist_custom_lists?user_id=eq.${encodeURIComponent(userId)}`,
          { method: 'DELETE', headers: getSupabaseHeaders() }
        ).catch((err) => console.error('[Supabase] Error deleting user custom lists:', err.message))
      );

      // 2. Delete user watchlist items
      deletePromises.push(
        fetch(`${SUPABASE_URL}/rest/v1/watchlist_items?user_id=eq.${encodeURIComponent(userId)}`, {
          method: 'DELETE',
          headers: getSupabaseHeaders(),
        }).catch((err) =>
          console.error('[Supabase] Error deleting user watchlist items:', err.message)
        )
      );

      // 3. Delete user analytics events
      deletePromises.push(
        fetch(`${SUPABASE_URL}/rest/v1/analytics_events?user_id=eq.${encodeURIComponent(userId)}`, {
          method: 'DELETE',
          headers: getSupabaseHeaders(),
        }).catch((err) =>
          console.error('[Supabase] Error deleting user analytics events:', err.message)
        )
      );

      // 4. Delete user record by id
      deletePromises.push(
        fetch(`${SUPABASE_URL}/rest/v1/watchlist_users?id=eq.${encodeURIComponent(userId)}`, {
          method: 'DELETE',
          headers: getSupabaseHeaders(),
        }).catch((err) =>
          console.error('[Supabase] Error deleting user record by id:', err.message)
        )
      );
    }

    if (userEmail) {
      // Delete user record by email
      deletePromises.push(
        fetch(
          `${SUPABASE_URL}/rest/v1/watchlist_users?email=eq.${encodeURIComponent(normalizeKey(userEmail))}`,
          { method: 'DELETE', headers: getSupabaseHeaders() }
        ).catch((err) =>
          console.error('[Supabase] Error deleting user record by email:', err.message)
        )
      );
    }

    await Promise.all(deletePromises);
  }

  // Memory cache cleanup
  const keysToRemove = new Set(
    [
      userIdentifier,
      userId,
      userEmail,
      normalizeKey(userIdentifier),
      userEmail ? normalizeKey(userEmail) : null,
    ].filter(Boolean)
  );

  for (const map of [cache.usersById, cache.usersByEmail, cache.users]) {
    for (const [k, b] of Object.entries(map)) {
      const match =
        !b ||
        b === bucket ||
        (userId && b.id === userId) ||
        (userEmail && b.email === userEmail) ||
        (userEmail && normalizeKey(b.email || '') === normalizeKey(userEmail)) ||
        (userEmail && (k === userEmail || normalizeKey(k) === normalizeKey(userEmail))) ||
        (userId && (k === userId || normalizeKey(k) === normalizeKey(userId))) ||
        keysToRemove.has(k) ||
        keysToRemove.has(normalizeKey(k));

      if (match) {
        if (b) {
          b.id = null;
          b.email = null;
          b.items = [];
          b.customLists = [];
          b.settings = {};
        }
        delete map[k];
      }
    }
  }

  for (const [authK, b] of Object.entries(cache.authKeyMap)) {
    if (
      b &&
      (b === bucket || (userId && b.id === userId) || (userEmail && b.email === userEmail))
    ) {
      delete cache.authKeyMap[authK];
    }
  }

  if (bucket) {
    bucket.id = null;
    bucket.email = null;
    bucket.items = [];
    bucket.customLists = [];
    bucket.settings = {};
  }

  return { success: true, userId, userEmail };
}

/**
 * Salva o voto do usuário na enquete de roadmap.
 */
async function savePollVote(userId, option, customText = '') {
  if (!userId || !option)
    return { success: false, error: 'User ID and selected option are required' };
  if (!isSupabaseConfigured()) return { success: false, error: 'Database not configured' };
  try {
    const row = {
      user_id: userId,
      selected_option: String(option).trim(),
      custom_text: String(customText || '')
        .trim()
        .slice(0, 500),
    };
    const res = await fetch(`${SUPABASE_URL}/rest/v1/poll_votes?on_conflict=user_id`, {
      method: 'POST',
      headers: getSupabaseHeaders({
        Prefer: 'resolution=merge-duplicates,return=representation',
      }),
      body: JSON.stringify([row]),
    });
    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: errText };
    }
    const saved = await res.json();
    return { success: true, vote: saved[0] };
  } catch (err) {
    console.error('[Poll] Error saving vote:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Retorna o voto do usuário caso já tenha votado.
 */
async function getPollVote(userId) {
  if (!userId || !isSupabaseConfigured()) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/poll_votes?user_id=eq.${encodeURIComponent(userId)}&limit=1`,
      {
        method: 'GET',
        headers: getSupabaseHeaders(),
      }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  } catch (err) {
    console.error('[Poll] Error getting vote:', err.message);
    return null;
  }
}

/**
 * Retorna resultados agregados da enquete para o roadmap.
 */
async function getPollResults() {
  const emptyRes = { totalVotes: 0, breakdown: {}, votes: {}, feedbackList: [], customFeedback: [] };
  if (!isSupabaseConfigured()) return emptyRes;
  try {
    const rows = await fetchAllSupabaseRows('poll_votes?select=*&order=created_at.desc');
    if (!Array.isArray(rows)) return emptyRes;

    const breakdown = {};
    const feedbackList = [];
    for (const r of rows) {
      if (!r || !r.selected_option) continue;
      const opt = String(r.selected_option).trim();
      breakdown[opt] = (breakdown[opt] || 0) + 1;

      if (r.custom_text && String(r.custom_text).trim()) {
        const textVal = String(r.custom_text).trim();
        feedbackList.push({
          option: opt,
          text: textVal,
          customText: textVal,
          createdAt: r.created_at,
        });
      }
    }
    return {
      totalVotes: rows.length,
      breakdown,
      votes: breakdown,
      feedbackList: feedbackList.slice(0, 100),
      customFeedback: feedbackList.slice(0, 100),
    };
  } catch (err) {
    console.error('[Poll] Error getting poll results:', err.message);
    return emptyRes;
  }
}

module.exports = {
  isSupabaseConfigured,
  getDatabaseInfo,
  getSupabaseHeaders,
  ensureLoaded,
  isUserAdmin,
  resolveUser,
  resolveUserId: async (authKey, getUserInfoFn) => {
    const u = await resolveUser(authKey, getUserInfoFn);
    return u ? u.id : null;
  },
  findUser: findUserBucket,
  findUserBucket,
  ensureUserBucket,
  deleteUser,
  getItems,
  getAllUsers,
  getAllUsersItems,
  getItem,
  addItem,
  updateItem,
  removeItem,
  setWatched,
  syncWatchedWithStremio,
  getCustomLists,
  createCustomList,
  updateCustomList,
  deleteCustomList,
  setItemCustomLists,
  supabaseUpsertItems,
  getSettings,
  updateSettings,
  getStats,
  isItemReady,
  isItemUnreleased,
  recordAnalyticsEvent,
  getAnalyticsStats,
  getAnalyticsRawEvents,
  savePollVote,
  getPollVote,
  getPollResults,
  cleanImdbId,
  isLegitimateMovieId,
};
