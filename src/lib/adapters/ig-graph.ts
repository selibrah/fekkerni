import type { Config } from '../config';
import type { IgGraphPort, SendResult } from '../ports';
import type { MediaItem, MediaProductType, MediaType } from '../../types';
import { AuthError, RateLimitError, TransientError } from '../errors';
import { isRetryable, withRetry } from '../retry';

const MEDIA_FIELDS =
  'id,caption,media_type,media_product_type,media_url,permalink,timestamp,thumbnail_url';
const MAX_PAGES = 1000; // safety bound on pagination (~25k media; beyond any realistic archive)

interface IgError {
  message?: string;
  code?: number;
  error_subcode?: number;
}

function mapError(status: number, retryAfter: string | null, body: unknown): Error {
  const err = (body as { error?: IgError } | null)?.error;
  const msg = err?.message ?? `IG Graph error (HTTP ${status})`;
  // Auth / permission / deauthorized — NOT transient. Mark needs_reauth, don't backoff-retry.
  // 190 = invalid token; 10 / 200 = permission; 100/subcode 33 = deauthorized/uninstalled app.
  const isAuth =
    status === 401 ||
    err?.code === 190 ||
    err?.code === 10 ||
    err?.code === 200 ||
    (err?.code === 100 && err?.error_subcode === 33);
  if (isAuth) return new AuthError(msg, err);
  if (status === 429 || err?.code === 4 || err?.code === 17 || err?.code === 32) {
    // Graph rarely sends a numeric Retry-After (it uses X-App-Usage); guard against NaN / HTTP-date.
    const n = retryAfter ? Number(retryAfter) : NaN;
    const ms = Number.isFinite(n) ? n * 1000 : undefined;
    return new RateLimitError(msg, ms);
  }
  if (status >= 500) return new TransientError(msg, err);
  return new Error(msg);
}

async function igRequest(url: string, init?: RequestInit): Promise<unknown> {
  return withRetry(
    async () => {
      const res = await fetch(url, init);
      const text = await res.text();
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = { raw: text };
      }
      if (!res.ok) throw mapError(res.status, res.headers.get('retry-after'), body);
      return body;
    },
    {
      label: 'igRequest',
      shouldRetry: (e) => !(e instanceof AuthError) && isRetryable(e),
    },
  );
}

function toMediaItem(d: Record<string, unknown>): MediaItem {
  return {
    id: String(d.id),
    caption: typeof d.caption === 'string' ? d.caption : null,
    mediaType: d.media_type as MediaType,
    mediaProductType: (d.media_product_type as MediaProductType | undefined) ?? null,
    mediaUrl: typeof d.media_url === 'string' ? d.media_url : null,
    permalink: String(d.permalink ?? ''),
    thumbnailUrl: typeof d.thumbnail_url === 'string' ? d.thumbnail_url : null,
    timestamp: String(d.timestamp ?? ''),
  };
}

export function igGraphAdapter(cfg: Config): IgGraphPort {
  const base = `${cfg.igGraphBase}/${cfg.igGraphVersion}`;

  return {
    async listMedia(token, opts) {
      const params = new URLSearchParams({ fields: MEDIA_FIELDS, access_token: token, limit: '50' });
      if (opts.since) params.set('since', String(Math.floor(opts.since.getTime() / 1000)));
      let url: string | null = `${base}/me/media?${params.toString()}`;
      const items: MediaItem[] = [];
      for (let page = 0; url && page < MAX_PAGES; page++) {
        const body = (await igRequest(url)) as { data?: unknown[]; paging?: { next?: string } };
        for (const d of body.data ?? []) items.push(toMediaItem(d as Record<string, unknown>));
        url = body.paging?.next ?? null;
      }
      // Client-side guard: `since` is best-effort on the API; enforce the boundary too.
      return opts.since ? items.filter((m) => Date.parse(m.timestamp) > opts.since!.getTime()) : items;
    },

    async getChildren(token, mediaId) {
      const params = new URLSearchParams({ fields: MEDIA_FIELDS, access_token: token });
      const body = (await igRequest(`${base}/${mediaId}/children?${params.toString()}`)) as {
        data?: unknown[];
      };
      return (body.data ?? []).map((d) => toMediaItem(d as Record<string, unknown>));
    },

    async sendMessage(token, recipientId, text): Promise<SendResult> {
      const body = (await igRequest(`${base}/me/messages?access_token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
      })) as { message_id?: string };
      return { ok: true, ...(body.message_id ? { messageId: body.message_id } : {}) };
    },

    async subscribeMessages(token) {
      await igRequest(
        `${base}/me/subscribed_apps?subscribed_fields=messages&access_token=${encodeURIComponent(token)}`,
        { method: 'POST' },
      );
    },

    async refreshLongLivedToken(token) {
      const body = (await igRequest(
        `${cfg.igGraphBase}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`,
      )) as { access_token?: string; expires_in?: number };
      const expiresInSec = typeof body.expires_in === 'number' ? body.expires_in : 60 * 24 * 3600;
      return {
        token: String(body.access_token ?? token),
        expiresAt: new Date(Date.now() + expiresInSec * 1000),
      };
    },
  };
}
