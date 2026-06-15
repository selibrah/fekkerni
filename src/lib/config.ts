import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

const boolish = z
  .string()
  .transform((s) => s.toLowerCase() === 'true' || s === '1')
  .pipe(z.boolean());

const ConfigSchema = z.object({
  // Meta / Instagram
  metaAppSecret: z.string().min(1),
  verifyToken: z.string().min(1),
  igGraphVersion: z.string().default('v25.0'),
  igGraphBase: z.string().url().default('https://graph.instagram.com'),

  // Gemini
  geminiApiKey: z.string().optional(),
  genaiUseVertex: z.boolean().default(false),
  googleCloudProject: z.string().optional(),
  googleCloudLocation: z.string().default('us-central1'),
  flashModel: z.string().default('gemini-3.5-flash'),
  indexModel: z.string().default('gemini-3.5-flash'),
  embedModel: z.string().default('gemini-embedding-001'),
  embedDims: z.coerce.number().int().positive().default(768),

  // Retrieval
  cosineDistanceMax: z.coerce.number().min(0).max(2).default(0.4),

  // Firestore
  firestoreDatabaseId: z.string().default('(default)'),

  // Queue / async
  queueDriver: z.enum(['local', 'cloudtasks']).default('local'),
  cloudTasksQueue: z.string().default('fekkerni-jobs'),
  cloudTasksLocation: z.string().default('us-central1'),
  workerBaseUrl: z.string().optional(),
  workerOidcServiceAccount: z.string().optional(),

  // Secrets
  secretsDriver: z.enum(['local', 'secretmanager']).default('local'),

  // Indexing cost guards
  maxBackfillVideos: z.coerce.number().int().positive().default(200),
  backfillCostCeilingUsd: z.coerce.number().positive().default(25),
  indexImageDescriptions: z.boolean().default(false),

  // Behaviour
  messagingWindowHours: z.coerce.number().positive().default(24),
  maxReplyBytes: z.coerce.number().int().positive().default(1000),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Config = z.infer<typeof ConfigSchema>;

function readEnv(env: NodeJS.ProcessEnv): Record<string, unknown> {
  const bool = (v: string | undefined): boolean | undefined =>
    v === undefined ? undefined : boolish.parse(v);
  return {
    metaAppSecret: env.META_APP_SECRET,
    verifyToken: env.VERIFY_TOKEN,
    igGraphVersion: env.IG_GRAPH_VERSION,
    igGraphBase: env.IG_GRAPH_BASE,
    geminiApiKey: env.GEMINI_API_KEY || undefined,
    genaiUseVertex: bool(env.GENAI_USE_VERTEX),
    googleCloudProject: env.GOOGLE_CLOUD_PROJECT || undefined,
    googleCloudLocation: env.GOOGLE_CLOUD_LOCATION,
    flashModel: env.FLASH_MODEL,
    indexModel: env.INDEX_MODEL,
    embedModel: env.EMBED_MODEL,
    embedDims: env.EMBED_DIMS,
    cosineDistanceMax: env.COSINE_DISTANCE_MAX,
    firestoreDatabaseId: env.FIRESTORE_DATABASE_ID,
    queueDriver: env.QUEUE_DRIVER,
    cloudTasksQueue: env.CLOUD_TASKS_QUEUE,
    cloudTasksLocation: env.CLOUD_TASKS_LOCATION,
    workerBaseUrl: env.WORKER_BASE_URL || undefined,
    workerOidcServiceAccount: env.WORKER_OIDC_SERVICE_ACCOUNT || undefined,
    secretsDriver: env.SECRETS_DRIVER,
    maxBackfillVideos: env.MAX_BACKFILL_VIDEOS,
    backfillCostCeilingUsd: env.BACKFILL_COST_CEILING_USD,
    indexImageDescriptions: bool(env.INDEX_IMAGE_DESCRIPTIONS),
    messagingWindowHours: env.MESSAGING_WINDOW_HOURS,
    maxReplyBytes: env.MAX_REPLY_BYTES,
    logLevel: env.LOG_LEVEL,
  };
}

/**
 * Parse and validate configuration from a given env (defaults to process.env).
 * Strips undefined so zod defaults apply. Throws a readable error on misconfig.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const raw = readEnv(env);
  const cleaned = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined));
  const parsed = ConfigSchema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  const cfg = parsed.data;
  if (!cfg.geminiApiKey && !cfg.genaiUseVertex) {
    throw new Error(
      'Gemini auth not configured: set GEMINI_API_KEY (Developer API) or GENAI_USE_VERTEX=true (+ GOOGLE_CLOUD_PROJECT).',
    );
  }
  if (cfg.genaiUseVertex && !cfg.googleCloudProject) {
    throw new Error('GENAI_USE_VERTEX=true requires GOOGLE_CLOUD_PROJECT.');
  }
  // Fail fast on driver misconfig (instead of a 500 deep in a worker at first use).
  if (cfg.queueDriver === 'cloudtasks' && (!cfg.workerBaseUrl || !cfg.googleCloudProject)) {
    throw new Error('QUEUE_DRIVER=cloudtasks requires WORKER_BASE_URL and GOOGLE_CLOUD_PROJECT.');
  }
  if (cfg.secretsDriver === 'secretmanager' && !cfg.googleCloudProject) {
    throw new Error('SECRETS_DRIVER=secretmanager requires GOOGLE_CLOUD_PROJECT.');
  }
  return cfg;
}
