/** Contract between Retrieval and Messaging. */

/** What Retrieval returns when it has a confident answer (null ⇒ send fallback). */
export interface ReplyPlan {
  answer: string;
  permalink: string;
  isVideo: boolean;
  /** startSec of the chunk the answer is grounded in (the cited chunk); null for posts. */
  citedStartSec: number | null;
}

/** Retrieval port the messaging worker depends on (implemented in M4). */
export interface RetrievePort {
  retrieve(creatorId: string, query: string): Promise<ReplyPlan | null>;
}
