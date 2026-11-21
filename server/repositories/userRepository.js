const db = require('../../lib/db');

const userRepository = {
  ensureLoaded: (force = false) => db.ensureLoaded(force),
  isSupabaseConfigured: () => db.isSupabaseConfigured(),
  getDatabaseInfo: () =>
    typeof db.getDatabaseInfo === 'function'
      ? db.getDatabaseInfo()
      : {
          appEnv: process.env.APP_ENV || process.env.NODE_ENV || 'development',
          dbTarget: db.isSupabaseConfigured() ? 'supabase-cloud' : 'in-memory',
          host: null,
          isLocal: false,
          isProduction: false,
        },
  resolveUser: (authKey, getUserInfoFn) => db.resolveUser(authKey, getUserInfoFn),
  findUser: (identifier) => db.findUser(identifier),
  findUserBucket: (identifier) => db.findUserBucket(identifier),
  getAllUsers: () => db.getAllUsers(),
  deleteUser: (identifier) => db.deleteUser(identifier),
  getSettings: (userId) => db.getSettings(userId),
  updateSettings: (settings, userId) => db.updateSettings(settings, userId),
};

module.exports = { userRepository };
