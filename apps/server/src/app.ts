import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import fastifyStatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import { serializerCompiler, validatorCompiler, jsonSchemaTransform, hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { HttpError } from './lib/errors.js';
import { authRoutes, resolveUser } from './auth.js';
import { projectRoutes } from './routes/projects.js';
import { assetRoutes } from './routes/assets.js';
import { aiRoutes } from './routes/ai.js';
import { accountRoutes } from './routes/account.js';
import { exportRoutes } from './routes/exports.js';
import { mcpRoutes } from './mcp.js';
import { tilesetRoutes } from './routes/tilesets.js';
import { adminRoutes } from './routes/admin.js';

export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger === false ? false : { level: config.logLevel },
    bodyLimit: 15 * 1024 * 1024,
    trustProxy: true,
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 200 } });
  await app.register(rateLimit, { global: false });

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Sprixy API',
        version: '0.1.0',
        description:
          'REST API of Sprixy, the self-hosted AI 2D game asset studio. Authenticate with `Authorization: Bearer spx_…` (create a token in Settings → API tokens). ' +
          'Generation jobs are asynchronous: POST /api/v1/generations returns 202 with a generation id, then poll GET /api/v1/generations/{id}. ' +
          'Deterministic processing endpoints never call a paid AI provider.',
      },
      components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' }, cookie: { type: 'apiKey', in: 'cookie', name: 'sprixy_session' } } },
      security: [{ bearer: [] }, { cookie: [] }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/api/docs' });

  app.addHook('onRequest', async (req) => {
    if (req.url.startsWith('/api/') || req.url.startsWith('/mcp')) resolveUser(req);
  });

  app.setErrorHandler((err, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: err.validation } });
    }
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    const e = err as { statusCode?: number; code?: string; message: string; name?: string };
    if (e.name === 'ZodError') return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: e.message } });
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: { code: e.code ?? 'ERROR', message: e.message } });
    req.log.error(err);
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'Internal server error' } });
  });

  app.get('/api/health', { schema: { hide: true } }, async () => ({ ok: true, version: '0.1.0' }));

  await app.register(authRoutes);
  await app.register(projectRoutes);
  await app.register(assetRoutes);
  await app.register(aiRoutes);
  await app.register(accountRoutes);
  await app.register(exportRoutes);
  await app.register(tilesetRoutes);
  await app.register(adminRoutes);
  await app.register(mcpRoutes);

  const here = path.dirname(fileURLToPath(import.meta.url));

  // Documentation (Lumy static site, English + French) at /docs.
  const docsDir = [config.docsDist, path.resolve(here, '../../docs/dist')].filter((p): p is string => !!p).find((p) => existsSync(path.join(p, 'index.html')));
  if (docsDir) {
    app.get('/docs', (_req, reply) => reply.redirect('/docs/', 301));
    await app.register(fastifyStatic, {
      root: docsDir,
      prefix: '/docs/',
      decorateReply: false,
      redirect: true,
      setHeaders: (reply: { header(k: string, v: string): unknown }, filePath: string) => {
        const p = filePath.split(path.sep).join('/');
        reply.header('Cache-Control', p.endsWith('.html') || p.endsWith('.md') || p.endsWith('.txt') ? 'no-cache' : p.includes('/_lumy/') ? 'public, max-age=31536000, immutable' : 'public, max-age=86400');
      },
    });
  }
  const docs404 = docsDir && existsSync(path.join(docsDir, '404.html')) ? readFileSync(path.join(docsDir, '404.html'), 'utf8') : null;

  // Serve the built web UI (single container deployment).
  const candidates = [config.webDist, path.resolve(here, '../../web/dist'), path.resolve(here, '../public')].filter((p): p is string => !!p);
  const webDir = candidates.find((p) => existsSync(path.join(p, 'index.html')));
  if (webDir) {
    await app.register(fastifyStatic, {
      root: webDir,
      wildcard: true,
      setHeaders: (reply: { header(k: string, v: string): unknown }, filePath: string) => {
        // Hashed bundles are immutable; index.html must always be revalidated.
        const p = filePath.split(path.sep).join('/');
        reply.header('Cache-Control', p.endsWith('index.html') ? 'no-cache' : p.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=86400');
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (docs404 && req.url.startsWith('/docs/')) return reply.code(404).type('text/html; charset=utf-8').send(docs404);
      if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/mcp')) return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.url} not found` } });
    });
  }
  return app;
}
