Object.defineProperty(exports, "__esModule", {
    value: true
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, { configurable: true, 
        enumerable: true,
        get: Object.getOwnPropertyDescriptor(all, name).get
    });
}
_export(exports, {
    get assertSafeDatabaseTarget () {
        return assertSafeDatabaseTarget;
    },
    get getAppEnv () {
        return getAppEnv;
    },
    get getDatabaseEnvironmentInfo () {
        return getDatabaseEnvironmentInfo;
    },
    get isCloudRuntime () {
        return isCloudRuntime;
    },
    get isLocalSupabaseUrl () {
        return isLocalSupabaseUrl;
    },
    get isTestRuntime () {
        return isTestRuntime;
    },
    get loadEnvironment () {
        return loadEnvironment;
    },
    get parseEnvContent () {
        return parseEnvContent;
    }
});
const _fs = /*#__PURE__*/ _interop_require_default(require("fs"));
const _path = /*#__PURE__*/ _interop_require_default(require("path"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const LOCAL_HOSTNAMES = new Set([
    '127.0.0.1',
    'localhost',
    '::1',
    '[::1]',
    'host.docker.internal'
]);
function resolveRepoRoot(cwd) {
    if (cwd) {
        return _path.default.resolve(cwd);
    }
    const currentDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
    const candidates = [
        process.cwd(),
        _path.default.resolve(currentDir, '..'),
        _path.default.resolve(currentDir, '..', '..')
    ];
    for (const candidate of candidates){
        if (_fs.default.existsSync(_path.default.join(candidate, 'package.json'))) {
            return candidate;
        }
    }
    return process.cwd();
}
function parseEnvContent(content) {
    const result = {};
    const lines = content.split(/\r?\n/);
    for (const rawLine of lines){
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
        const unquoted = rawVal.startsWith('"') && rawVal.endsWith('"') || rawVal.startsWith("'") && rawVal.endsWith("'") ? rawVal.slice(1, -1) : rawVal;
        result[key] = unquoted;
    }
    return result;
}
function getAppEnv(env = process.env) {
    const raw = env.APP_ENV || env.VERCEL_ENV || env.NODE_ENV || 'development';
    return String(raw).trim().toLowerCase() || 'development';
}
function isTestRuntime(env = process.env) {
    return Boolean(env.JEST_WORKER_ID || env.NODE_ENV === 'test');
}
function isCloudRuntime(env = process.env) {
    return Boolean(env.VERCEL || env.RENDER || env.CI);
}
function isLocalSupabaseUrl(url) {
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
    } catch  {
        return false;
    }
}
function getEnvFileLoadOrder(appEnv) {
    const files = [
        `.env.${appEnv}.local`
    ];
    if (appEnv !== 'test') {
        files.push('.env.local');
    }
    files.push(`.env.${appEnv}`, '.env');
    return Array.from(new Set(files));
}
function loadEnvironment(options = {}) {
    const env = options.env ?? process.env;
    const appEnv = getAppEnv(env);
    if (!options.allowInTest && isTestRuntime(env)) {
        return {
            loadedFiles: [],
            skippedReason: 'test_runtime',
            appEnv
        };
    }
    if (!options.allowInCloud && isCloudRuntime(env)) {
        return {
            loadedFiles: [],
            skippedReason: 'cloud_runtime',
            appEnv
        };
    }
    const baseDir = resolveRepoRoot(options.cwd);
    const loadedFiles = [];
    const lockedKeys = new Set();
    for (const key of Object.keys(env)){
        if (env[key] !== undefined) {
            lockedKeys.add(key);
        }
    }
    for (const fileName of getEnvFileLoadOrder(appEnv)){
        const filePath = _path.default.join(baseDir, fileName);
        if (!_fs.default.existsSync(filePath)) {
            continue;
        }
        try {
            const content = _fs.default.readFileSync(filePath, 'utf-8');
            const parsed = parseEnvContent(content);
            for (const [key, value] of Object.entries(parsed)){
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
    return {
        loadedFiles,
        appEnv
    };
}
function extractUrlHost(url) {
    if (!url || typeof url !== 'string' || !url.trim()) {
        return null;
    }
    try {
        return new URL(url.trim()).host || null;
    } catch  {
        return null;
    }
}
function assertSafeDatabaseTarget(supabaseUrl, env = process.env) {
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
    throw new Error(`[DB Safety Guard] Refusing to connect to remote Supabase host (${host}) in "${appEnv}" mode. ` + `Run "npm run db:start" to use your local Docker Supabase database (.env.development.local), ` + `run "npm run dev:memory" for in-memory mode, or set ALLOW_REMOTE_DB_IN_DEV=true if you explicitly intend to target a remote database.`);
}
function getDatabaseEnvironmentInfo(supabaseUrl, isConfigured = false, env = process.env) {
    const appEnv = getAppEnv(env);
    const isLocal = isLocalSupabaseUrl(supabaseUrl);
    const host = extractUrlHost(supabaseUrl);
    const dbTarget = !isConfigured ? 'in-memory' : isLocal ? 'local-docker' : 'supabase-cloud';
    return {
        appEnv,
        dbTarget,
        host,
        isLocal,
        isProduction: appEnv === 'production'
    };
}
