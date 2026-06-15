import { pathToFileURL } from 'node:url';
import express, { type Request, type Response } from 'express';
import { createContainer, type Container } from './container';
import { handleVerification } from './webhook/handlers';
import { verifySignature } from './lib/signature';
import { parseWebhook } from './webhook/parse';
import { handleInbound } from './messaging/handleWebhook';
import { dispatchJob } from './lib/queue';
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
    const raw = (req as RawBodyRequest).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
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

  // Worker endpoint for Cloud Tasks. Non-200 → Cloud Tasks retries with backoff.
  app.post('/tasks', (req: Request, res: Response) => {
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
  const app = createApp(c);
  const port = Number(process.env.PORT ?? 8080);
  app.listen(port, () => c.logger.info('fekkerni listening', { port, queue: c.config.queueDriver }));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) start();
