import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import http from 'http';
import swaggerUi from 'swagger-ui-express';
import { config } from './config';
import { migrate } from './db/migrate';
import { pool } from './db/pool';
import { errorHandler } from './lib/http';
import { authenticate } from './middleware/auth';
import { openapi } from './openapi';
import applications from './routes/applications';
import { privateAuth, publicAuth } from './routes/auth';
import data from './routes/data';
import operations from './routes/operations';
import { system, webhooks } from './routes/system';
import { ensureNetwork, ping } from './services/docker';
import { startMonitors } from './services/monitor';
import { ensureDataDirs } from './services/storage';
import { attachWebSockets } from './ws';

async function main() {
  ensureDataDirs();
  await migrate();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'"], styleSrc: ["'self'", "'unsafe-inline'", 'https:'], imgSrc: ["'self'", 'data:'] } },
    crossOriginEmbedderPolicy: false,
  }));
  if (config.corsOrigins.length) app.use(cors({ origin: config.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '5mb', verify: (req: any, _res, buf) => { if (req.url?.startsWith('/api/webhooks')) req.rawBody = buf; } }));
  app.use(cookieParser());
  app.use('/api', rateLimit({ windowMs: 60_000, limit: Number(process.env.RATE_LIMIT_PER_MIN || 600), standardHeaders: true, legacyHeaders: false }));

  // públicos
  app.get('/api/health', async (_req, res) => {
    const db = await pool.query('SELECT 1').then(() => true).catch(() => false);
    res.status(db ? 200 : 503).json({ status: db ? 'ok' : 'degraded', database: db, docker: await ping(), time: new Date().toISOString() });
  });
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: 'EMA AppHub API' }));
  app.get('/api/openapi.json', (_req, res) => res.json(openapi));
  app.use('/api', publicAuth);
  app.use('/api', webhooks);

  // privados
  app.use('/api', authenticate);
  app.use('/api', privateAuth, applications, operations, data, system);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));
  app.use(errorHandler);

  const server = http.createServer(app);
  server.requestTimeout = 30 * 60_000; // subidas grandes
  attachWebSockets(server);
  server.listen(config.port, () => console.log(`[apphub] API escuchando en :${config.port} (DATA_DIR=${config.dataDir})`));

  if (await ping()) {
    await ensureNetwork().catch((e) => console.error('[docker] red', e.message));
  } else {
    console.warn('[docker] No se pudo conectar al daemon Docker: las operaciones de despliegue fallarán.');
  }
  await startMonitors();
}

main().catch((e) => {
  console.error('[apphub] error fatal', e);
  process.exit(1);
});
