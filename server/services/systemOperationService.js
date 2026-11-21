const {
  userRepository,
  pollRepository,
  analyticsRepository,
  adminRepository,
} = require('../repositories');
const { encodeUserData } = require('../../lib/userData');
const { logPostHog } = require('../../lib/posthogLogs');
const {
  syncAddonUrlWithAccount,
  runBackgroundCheck,
} = require('../utils/requestContext');

const DEFAULT_EXCLUDED_USER_IDS = [
  '0ae027a6-56e6-41d5-a25b-86fc1e04aed4',
  'aa1bdc75-f539-4e11-8c90-510c0e998ce8',
];

function getHealthStatus() {
  const dbInfo =
    typeof userRepository.getDatabaseInfo === 'function' ? userRepository.getDatabaseInfo() : null;
  const supabaseConfigured = userRepository.isSupabaseConfigured();
  return {
    status: 'ok',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    supabase: supabaseConfigured,
    environment: dbInfo?.appEnv || process.env.APP_ENV || process.env.NODE_ENV || 'development',
    dbTarget: dbInfo?.dbTarget || (supabaseConfigured ? 'supabase-cloud' : 'in-memory'),
  };
}

function getUserSettings(userId) {
  return userRepository.getSettings(userId);
}

async function updateUserSettings({ authKey, userId, settings, baseUrl }) {
  const updated = await userRepository.updateSettings(settings, userId);

  if (authKey && baseUrl) {
    syncAddonUrlWithAccount(authKey, baseUrl, userId).catch(() => {});
  }

  return updated;
}

async function getSystemInfo({ host, baseUrl, authKey, port }) {
  await userRepository.ensureLoaded();
  const encoded = authKey ? encodeUserData(authKey, []) : '';

  const manifestUrl = authKey
    ? `${baseUrl}/${encoded}/manifest.json`
    : `${baseUrl}/manifest.json`;
  const stremioInstallUrl = authKey
    ? `stremio://${host}/${encoded}/manifest.json`
    : `stremio://${host}/manifest.json`;
  const webStremioInstallUrl = `https://web.stremio.com/#/addons?addon=${encodeURIComponent(manifestUrl)}`;

  return {
    baseUrl,
    manifestUrl,
    stremioInstallUrl,
    webStremioInstallUrl,
    supabaseConfigured: userRepository.isSupabaseConfigured(),
    port,
  };
}

function isTrackingExcludedUser(user) {
  const userId = user?.userId || user?.id || null;
  const userEmail = (user?.userEmail || user?.email || '').toLowerCase().trim();

  const excludedEnvEmails =
    process.env.EXCLUDED_TRACKING_EMAILS || process.env.VITE_EXCLUDED_TRACKING_EMAILS || '';
  const excludedEnvIds =
    process.env.EXCLUDED_TRACKING_USER_IDS || process.env.VITE_EXCLUDED_TRACKING_USER_IDS || '';

  const excludedList = new Set(
    excludedEnvEmails
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
  const excludedUserIds = new Set([
    ...DEFAULT_EXCLUDED_USER_IDS,
    ...excludedEnvIds
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  ]);

  return Boolean(
    (userEmail && excludedList.has(userEmail)) ||
      (userId && (excludedUserIds.has(userId) || excludedList.has(userId)))
  );
}

async function recordClientEvent({ event, data, optOutHeader, user }) {
  if (!event || typeof event !== 'string') {
    const err = new Error('Event name is required');
    err.statusCode = 400;
    throw err;
  }

  if (optOutHeader === 'true' || isTrackingExcludedUser(user)) {
    return { success: true, ignored: true };
  }

  const userId = user?.userId || user?.id || null;
  await analyticsRepository.recordAnalyticsEvent(event, data, userId);
  return { success: true };
}

async function getAnalyticsSummary() {
  return analyticsRepository.getAnalyticsStats();
}

async function submitPollVote({ userId, option, customText }) {
  if (!option || typeof option !== 'string') {
    const err = new Error('Option is required');
    err.statusCode = 400;
    throw err;
  }

  const result = await pollRepository.savePollVote(userId, option, customText);
  if (result.success) {
    analyticsRepository
      .recordAnalyticsEvent(
        'poll_voted',
        { option, hasCustomText: Boolean(customText) },
        userId
      )
      .catch(() => {});
  }
  return result;
}

async function getUserPollStatus(userId) {
  if (!userId) {
    return { hasVoted: false, vote: null };
  }
  const vote = await pollRepository.getPollVote(userId);
  return { hasVoted: Boolean(vote), vote };
}

async function getPollResultsSummary() {
  return pollRepository.getPollResults();
}

async function triggerCronCheck({ authHeader, querySecret }) {
  const expectedSecret = process.env.CRON_SECRET;
  if (expectedSecret) {
    const isAuthorized =
      (authHeader && authHeader === `Bearer ${expectedSecret}`) ||
      (querySecret && querySecret === expectedSecret);

    if (!isAuthorized) {
      const err = new Error('Unauthorized: Invalid cron secret');
      err.statusCode = 401;
      throw err;
    }
  }

  logPostHog('info', 'background_check_triggered', { trigger: 'cron_endpoint' });
  const summary = await runBackgroundCheck();
  return {
    success: true,
    message: 'Automated background check triggered',
    summary,
  };
}

async function getAdminAnalyticsReport({ user, adminSecretHeader, timeRange = 'all' }) {
  const envSecret = process.env.ADMIN_SECRET_KEY;
  const isSecretValid = Boolean(envSecret && adminSecretHeader && adminSecretHeader === envSecret);
  const isUserAdmin = Boolean(user && user.isAdmin);

  if (!isUserAdmin && !isSecretValid) {
    const err = new Error('Forbidden: Admin access required.');
    err.statusCode = 403;
    throw err;
  }

  return adminRepository.getAdminAnalytics(timeRange);
}

const systemOperationService = {
  getHealthStatus,
  getUserSettings,
  updateUserSettings,
  getSystemInfo,
  recordClientEvent,
  getAnalyticsSummary,
  submitPollVote,
  getUserPollStatus,
  getPollResultsSummary,
  triggerCronCheck,
  getAdminAnalyticsReport,
};

module.exports = { systemOperationService };
