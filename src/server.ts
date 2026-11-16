import { pathToFileURL } from 'node:url';
import express, { type Request, type Response } from 'express';
import { createContainer, type Container } from './container';
import { handleVerification } from './webhook/handlers';
import { verifySignature } from './lib/signature';
import { parseWebhook } from './webhook/parse';
import { handleInbound } from './messaging/handleWebhook';
import { dispatchJob } from './lib/queue';
import { oidcMiddleware } from './lib/oidc';
import type { Job } from './types';

type RawBodyRequest = Request & { rawBody?: Buffer };

export function createApp(c: Container): express.Express {
  const app = express();
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as RawBodyRequest).rawBody = buf;
      },
    }),
  );

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ ok: true });
  });

  // Meta verification handshake.
  app.get('/webhook', (req: Request, res: Response) => {
    const { status, body } = handleVerification(req.query as Record<string, unknown>, c.config.verifyToken);
    res.status(status).send(body);
  });

  // Event delivery: verify signature over the RAW body, ack 200 fast, then process (ADR 003).
  app.post('/webhook', (req: Request, res: Response) => {
    const raw = (req as RawBodyRequest).rawBody;
    if (!raw) {
      // No raw bytes captured (wrong content-type / proxy stripped it). Fabricating bytes would only
      // ever false-negative the HMAC; surface it instead of silently 403-ing valid events.
      c.logger.error('webhook: raw body unavailable (content-type?)');
      res.status(400).send('raw body unavailable');
      return;
    }
    if (!verifySignature(raw, req.header('x-hub-signature-256'), c.config.metaAppSecret)) {
      res.status(403).send('invalid signature');
      return;
    }
    res.status(200).send('EVENT_RECEIVED');
    void (async () => {
      try {
        const { messages, dropped } = parseWebhook(req.body);
        if (dropped) c.logger.debug('webhook: dropped events', { dropped });
        await handleInbound(messages, c.webhookDeps);
      } catch (e) {
        c.logger.error('webhook processing error', { error: String(e) });
      }
    })();
  });

  // OIDC protection for internal/worker endpoints (defense-in-depth).
  // Enabled when VALIDATE_OIDC=true + OIDC_AUDIENCE are set; disabled in local dev.
  const internalAuth = oidcMiddleware({
    enabled: process.env.VALIDATE_OIDC === 'true',
    audience: process.env.OIDC_AUDIENCE,
  });

  // Scheduler endpoints (Cloud Scheduler → here with OIDC; protect via Cloud Run IAM invoker).
  // Ack 200 immediately (same ack-then-process pattern as the webhook) so Cloud Scheduler never
  // retries due to HTTP timeout. The actual work runs async after the response.
  app.post('/internal/poll-all', internalAuth, (_req: Request, res: Response) => {
    res.status(200).json({ accepted: true });
    void (async () => {
      try {
        const enqueued = await c.pollAll();
        c.logger.info('poll-all completed', { enqueued });
      } catch (e) {
        c.logger.error('poll-all failed', { error: String(e) });
      }
    })();
  });

  app.post('/internal/refresh-tokens', internalAuth, (_req: Request, res: Response) => {
    res.status(200).json({ accepted: true });
    void (async () => {
      try {
        const result = await c.refreshTokens();
        c.logger.info('refresh-tokens completed', result);
      } catch (e) {
        c.logger.error('refresh-tokens failed', { error: String(e) });
      }
    })();
  });

  // Worker endpoint for Cloud Tasks. Non-200 → Cloud Tasks retries with backoff.
  app.post('/tasks', internalAuth, (req: Request, res: Response) => {
    void (async () => {
      try {
        await dispatchJob(req.body as Job, c.handlers);
        res.status(200).send('ok');
      } catch (e) {
        c.logger.error('task failed', { error: String(e) });
        res.status(500).send('error');
      }
    })();
  });

  return app;
}

function start(): void {
  const c = createContainer();
  if (c.config.queueDriver === 'local') {
    c.logger.warn(
      'QUEUE_DRIVER=local: jobs run in-process and are NOT durable across instance shutdown. Use QUEUE_DRIVER=cloudtasks in production.',
    );
  }
  const app = createApp(c);
  const port = Number(process.env.PORT ?? 8080);
  app.listen(port, () => c.logger.info('fekkerni listening', { port, queue: c.config.queueDriver }));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) start();
