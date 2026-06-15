/** Pure handler logic for the webhook verification handshake (GET /webhook). */

export interface VerificationOutcome {
  status: number;
  body: string;
}

/**
 * Meta GET handshake. Query keys are dotted ("hub.mode", "hub.challenge", "hub.verify_token") and
 * must be read by bracket notation. Echo the raw challenge on success; 403 otherwise.
 */
export function handleVerification(
  query: Record<string, unknown>,
  verifyToken: string,
): VerificationOutcome {
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];
  if (mode === 'subscribe' && typeof token === 'string' && token === verifyToken && typeof challenge === 'string') {
    return { status: 200, body: challenge };
  }
  return { status: 403, body: 'Forbidden' };
}
