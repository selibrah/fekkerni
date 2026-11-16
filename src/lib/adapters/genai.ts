import { GoogleGenAI } from '@google/genai';
import type { Config } from '../config';
import type { EmbeddingPort, LlmPort, VideoSource } from '../ports';
import type { Segment } from '../../types';
import { l2normalize } from '../normalize';
import { parseSegments } from '../../indexing/segments';
import { withRetry } from '../retry';

const TRANSCRIBE_PROMPT = `You are transcribing a short video into spoken-content segments.
Return ONLY a JSON array (no prose) of objects: {"startSec": number, "endSec": number, "text": string},
each ~30 seconds, aligned to what is actually said. Use seconds (integers). If there is no spoken
content, return []. Do not invent dialogue.`;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface GenAiClients {
  embedding: EmbeddingPort;
  llm: LlmPort;
}

export function genaiAdapter(cfg: Config): GenAiClients {
  const ai = cfg.genaiUseVertex
    ? new GoogleGenAI({ vertexai: true, project: cfg.googleCloudProject!, location: cfg.googleCloudLocation })
    : new GoogleGenAI({ apiKey: cfg.geminiApiKey! });

  const embedding: EmbeddingPort = {
    async embed(text, taskType) {
      return withRetry(
        async () => {
          const resp = await ai.models.embedContent({
            model: cfg.embedModel,
            contents: text,
            config: { outputDimensionality: cfg.embedDims, taskType },
          });
          const values = resp.embeddings?.[0]?.values;
          if (!values || values.length === 0) throw new Error('Embedding response had no values.');
          // gemini-embedding-001 at dims != 3072 is NOT normalized by the API — we must (ADR 002).
          const { vector, norm } = l2normalize(values);
          return { vector, norm };
        },
        { label: 'embed' },
      );
    },
  };

  async function downloadAsBlob(source: VideoSource): Promise<{ blob: Blob; mimeType: string }> {
    const res = await fetch(source.url);
    if (!res.ok) throw new Error(`Failed to download media (${res.status}).`);
    const mimeType = source.mimeType ?? res.headers.get('content-type') ?? 'video/mp4';
    const buf = Buffer.from(await res.arrayBuffer());
    return { blob: new Blob([buf], { type: mimeType }), mimeType };
  }

  async function uploadActiveFile(source: VideoSource): Promise<{ uri: string; mimeType: string; name: string }> {
    const { blob, mimeType } = await downloadAsBlob(source);
    const uploaded = await ai.files.upload({ file: blob, config: { mimeType } });
    let file = uploaded;
    for (let i = 0; i < 30 && file.state !== 'ACTIVE'; i++) {
      if (file.state === 'FAILED') throw new Error('Files API processing failed.');
      await sleep(2000);
      file = await ai.files.get({ name: file.name! });
    }
    if (file.state !== 'ACTIVE') throw new Error('Files API did not become ACTIVE in time.');
    return { uri: file.uri!, mimeType: file.mimeType ?? mimeType, name: file.name! };
  }

  const llm: LlmPort = {
    async transcribeVideo(source) {
      const file = await uploadActiveFile(source);
      try {
        const generate = async (): Promise<Segment[]> => {
          const resp = await ai.models.generateContent({
            model: cfg.indexModel,
            contents: [
              { fileData: { fileUri: file.uri, mimeType: file.mimeType } },
              { text: TRANSCRIBE_PROMPT },
            ],
            config: { responseMimeType: 'application/json', temperature: 0 },
          });
          return parseSegments(resp.text ?? '');
        };
        try {
          return await generate();
        } catch {
          // Retry once on malformed output (ADR / defensive parsing).
          try {
            return await generate();
          } catch {
            return []; // give up gracefully → indexer falls back to caption
          }
        }
      } finally {
        await ai.files.delete({ name: file.name }).catch(() => undefined);
      }
    },

    async draftReply(prompt) {
      return withRetry(
        async () => {
          const resp = await ai.models.generateContent({
            model: cfg.flashModel,
            contents: prompt,
            config: { temperature: 0.2 },
          });
          return (resp.text ?? '').trim();
        },
        { label: 'draftReply' },
      );
    },

    async describeImage(source) {
      const file = await uploadActiveFile({ ...source, mimeType: source.mimeType ?? 'image/jpeg' });
      try {
        return await withRetry(
          async () => {
            const resp = await ai.models.generateContent({
              model: cfg.indexModel,
              contents: [
                { fileData: { fileUri: file.uri, mimeType: file.mimeType } },
                { text: 'Describe this image in one short, searchable sentence. No preamble.' },
              ],
              config: { temperature: 0.2 },
            });
            return (resp.text ?? '').trim();
          },
          { label: 'describeImage' },
        );
      } finally {
        await ai.files.delete({ name: file.name }).catch(() => undefined);
      }
    },
  };

  return { embedding, llm };
}
