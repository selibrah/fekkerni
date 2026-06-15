import type { Config } from '../config';
import type { SecretStorePort } from '../ports';

/**
 * Local dev driver: tokens come from env as CREATOR_TOKEN_<creatorId>. The "ref" is `local:<id>`.
 * Never used in production — tokens there live in Secret Manager (ADR 006).
 */
function localSecrets(): SecretStorePort {
  return {
    async getCreatorToken(ref) {
      const id = ref.startsWith('local:') ? ref.slice('local:'.length) : ref;
      const token = process.env[`CREATOR_TOKEN_${id}`];
      if (!token) throw new Error(`No local token for creator '${id}' (set CREATOR_TOKEN_${id}).`);
      return token;
    },
    async setCreatorToken(creatorId) {
      return `local:${creatorId}`;
    },
  };
}

/** Production driver: one secret version per creator; Firestore stores only the resource name. */
function secretManagerSecrets(cfg: Config): SecretStorePort {
  const project = cfg.googleCloudProject;
  if (!project) throw new Error('SECRETS_DRIVER=secretmanager requires GOOGLE_CLOUD_PROJECT.');

  // Lazy import so the dependency stays optional and tests never load it.
  const clientPromise = import('@google-cloud/secret-manager').then(
    (m) => new m.SecretManagerServiceClient(),
  );

  const secretId = (creatorId: string) => `fekkerni-creator-${creatorId}`;

  return {
    async getCreatorToken(ref) {
      const client = await clientPromise;
      const name = ref.includes('/versions/') ? ref : `${ref}/versions/latest`;
      const [version] = await client.accessSecretVersion({ name });
      const data = version.payload?.data;
      if (!data) throw new Error(`Secret ${name} has no payload.`);
      return Buffer.from(data).toString('utf8');
    },
    async setCreatorToken(creatorId, token) {
      const client = await clientPromise;
      const parent = `projects/${project}`;
      const id = secretId(creatorId);
      const secretName = `${parent}/secrets/${id}`;
      try {
        await client.createSecret({
          parent,
          secretId: id,
          secret: { replication: { automatic: {} } },
        });
      } catch (e) {
        if (!(typeof e === 'object' && e !== null && (e as { code?: number }).code === 6)) throw e;
      }
      await client.addSecretVersion({
        parent: secretName,
        payload: { data: Buffer.from(token, 'utf8') },
      });
      return secretName;
    },
  };
}

export function secretStore(cfg: Config): SecretStorePort {
  return cfg.secretsDriver === 'secretmanager' ? secretManagerSecrets(cfg) : localSecrets();
}
