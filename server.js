const { loadEnvironment } = require('./lib/envLoader');

loadEnvironment();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { userRepository } = require('./server/repositories');
const { registerControllers } = require('./server/controllers');
const { runBackgroundCheck } = require('./server/utils/requestContext');
const { logPostHog } = require('./lib/posthogLogs');

const app = express();
const PORT = process.env.PORT || 7000;

app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'OPTIONS', 'DELETE'],
    allowedHeaders: ['*'],
  })
);
app.use(express.json());

app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url} from ${req.ip}`);
  next();
});

const distPath = path.join(__dirname, 'dist');
const publicPath = path.join(__dirname, 'public');
const clientPath = fs.existsSync(distPath) ? distPath : publicPath;

app.use(
  express.static(clientPath, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      } else if (
        filePath.includes(path.sep + 'assets' + path.sep) ||
        filePath.includes('/assets/')
      ) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  })
);

registerControllers(app, PORT);

app.get('*', (req, res) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/assets') || req.path.includes('.')) {
    return res.status(404).send('Not found');
  }
  const indexPath = path.join(clientPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.sendFile(indexPath);
  }
  res.status(404).send('Not found');
});

// Global Express error-handling middleware
app.use((err, req, res, next) => {
  console.error('[Unhandled Server Error]', err);
  if (res.headersSent) {
    return next(err);
  }
  res.status(err.statusCode || err.status || 500).json({
    error: err.message || 'Internal Server Error',
  });
});

module.exports = app;

if (!process.env.VERCEL && require.main === module) {
  const timer = setInterval(runBackgroundCheck, 30 * 60 * 1000);
  if (timer && typeof timer.unref === 'function') {
    timer.unref();
  }

  app.listen(PORT, '0.0.0.0', async () => {
    await userRepository.ensureLoaded(true);
    logPostHog('info', 'server_started', { runtime: 'stateful_node' });
    console.log(`=======================================================`);
    console.log(`🚀 STREMIO WATCHLIST (GOOD QUALITY TRACKER) RUNNING`);
    console.log(`👉 Port: ${PORT}`);
    console.log(`👉 Web Dashboard: http://localhost:${PORT}`);
    console.log(`👉 Addon Manifest: http://localhost:${PORT}/manifest.json`);
    console.log(
      `👉 Client Source: ${fs.existsSync(distPath) ? '⚛️ REACT BUILD (dist)' : '📁 STATIC (public)'}`
    );
    const dbInfo =
      typeof userRepository.getDatabaseInfo === 'function'
        ? userRepository.getDatabaseInfo()
        : null;
    let dbLabel = `🟡 IN-MEMORY ONLY (NO PERSISTENCE) [env: ${dbInfo?.appEnv || 'development'}]`;
    if (dbInfo?.dbTarget === 'local-docker') {
      dbLabel = `🟢 LOCAL DOCKER SUPABASE (${dbInfo.host}) [env: ${dbInfo.appEnv}]`;
    } else if (dbInfo?.dbTarget === 'supabase-cloud' || userRepository.isSupabaseConfigured()) {
      dbLabel = `🔴 SUPABASE CLOUD (${dbInfo?.host || 'remote'}) [env: ${dbInfo?.appEnv || 'production'}]`;
    }
    console.log(`👉 Database: ${dbLabel}`);
    console.log(`=======================================================`);
  });
}
