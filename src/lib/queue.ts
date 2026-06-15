import type { Config } from './config';
import type { QueuePort } from './ports';
import type { Logger } from './logger';
import type { InboundMessage, Job, MediaItem } from '../types';

/** The work each job kind triggers. Implemented in the container; referenced by the dispatcher. */
export interface JobHandlers {
  processMessage(message: InboundMessage): Promise<void>;
  indexMedia(creatorId: string, media: MediaItem): Promise<void>;
  pollCreator(creatorId: string): Promise<void>;
}

export async function dispatchJob(job: Job, handlers: JobHandlers): Promise<void> {
  switch (job.kind) {
    case 'process_message':
      return handlers.processMessage(job.message);
    case 'index_media':
      return handlers.indexMedia(job.creatorId, job.media);
    case 'poll_creator':
      return handlers.pollCreator(job.creatorId);
  }
}

export interface LocalQueueHandle {
  queue: QueuePort;
  /** Await all in-flight jobs (and any they enqueue). Used by CLI scripts. */
  drain(): Promise<void>;
}

/**
 * In-process queue (dev/smoke/CLI). enqueue returns immediately (ack-then-process shape) but each
 * job is tracked so `drain()` can await completion. `getHandlers` is a thunk to break the
 * queue↔handlers init cycle. Jobs may enqueue more jobs (poll → index_media); drain loops until idle.
 */
export function localQueue(getHandlers: () => JobHandlers, logger: Logger): LocalQueueHandle {
  const pending = new Set<Promise<void>>();
  const queue: QueuePort = {
    async enqueue(job) {
      const p = dispatchJob(job, getHandlers())
        .catch((e) => logger.error('job failed', { kind: job.kind, error: String(e) }))
        .finally(() => pending.delete(p));
      pending.add(p);
    },
  };
  return {
    queue,
    async drain() {
      while (pending.size > 0) await Promise.all([...pending]);
    },
  };
}

/** Cloud Tasks queue (prod). POSTs the job to the worker's /tasks endpoint with an OIDC token. */
export function cloudTasksQueue(cfg: Config, logger: Logger): QueuePort {
  if (!cfg.workerBaseUrl) throw new Error('QUEUE_DRIVER=cloudtasks requires WORKER_BASE_URL.');
  if (!cfg.googleCloudProject) throw new Error('QUEUE_DRIVER=cloudtasks requires GOOGLE_CLOUD_PROJECT.');
  const clientPromise = import('@google-cloud/tasks').then((m) => new m.CloudTasksClient());

  return {
    async enqueue(job) {
      const client = await clientPromise;
      const parent = client.queuePath(cfg.googleCloudProject!, cfg.cloudTasksLocation, cfg.cloudTasksQueue);
      await client.createTask({
        parent,
        task: {
          httpRequest: {
            httpMethod: 'POST',
            url: `${cfg.workerBaseUrl}/tasks`,
            headers: { 'content-type': 'application/json' },
            body: Buffer.from(JSON.stringify(job)),
            ...(cfg.workerOidcServiceAccount
              ? { oidcToken: { serviceAccountEmail: cfg.workerOidcServiceAccount } }
              : {}),
          },
        },
      });
      logger.debug('enqueued to Cloud Tasks', { kind: job.kind });
    },
  };
}
