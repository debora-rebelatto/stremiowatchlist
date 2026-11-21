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
    get cryptoService () {
        return cryptoService;
    },
    get decryptText () {
        return decryptText;
    },
    get default () {
        return _default;
    },
    get encryptText () {
        return encryptText;
    }
});
const _crypto = /*#__PURE__*/ _interop_require_default(require("crypto"));
const _envLoader = require("./envLoader");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
// Ensure environment files are loaded before deriving encryption keys (skipped in Jest/cloud)
(0, _envLoader.loadEnvironment)();
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const PREFIX = 'enc:';
function getCandidateKeys() {
    const seeds = [
        process.env.ENCRYPTION_KEY,
        process.env.SUPABASE_KEY,
        'stremio-good-quality-tracker-master-key-seed'
    ].filter(Boolean);
    return Array.from(new Set(seeds)).map((s)=>_crypto.default.createHash('sha256').update(s).digest());
}
function encryptText(text) {
    if (!text || typeof text !== 'string') return null;
    if (text.startsWith(PREFIX)) return text;
    try {
        const keys = getCandidateKeys();
        const primaryKey = keys[0];
        const iv = _crypto.default.randomBytes(IV_LENGTH);
        const cipher = _crypto.default.createCipheriv(ALGORITHM, primaryKey, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag().toString('hex');
        return `${PREFIX}${iv.toString('hex')}:${authTag}:${encrypted}`;
    } catch (err) {
        console.error('[Crypto] Erro ao criptografar:', err.message);
        return null;
    }
}
function decryptText(cipherText) {
    if (!cipherText || typeof cipherText !== 'string') return null;
    if (!cipherText.startsWith(PREFIX)) {
        return cipherText;
    }
    try {
        const parts = cipherText.slice(PREFIX.length).split(':');
        if (parts.length !== 3) {
            return null;
        }
        const [ivHex, authTagHex, encryptedHex] = parts;
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const keys = getCandidateKeys();
        for (const key of keys){
            try {
                const decipher = _crypto.default.createDecipheriv(ALGORITHM, key, iv);
                decipher.setAuthTag(authTag);
                let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
                decrypted += decipher.final('utf8');
                return decrypted;
            } catch  {
                continue;
            }
        }
        return null;
    } catch  {
        return null;
    }
}
const cryptoService = {
    encryptText,
    decryptText
};
const _default = cryptoService;
