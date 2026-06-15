/** STOP/START control-keyword classification. */

export type ControlKeyword = 'stop' | 'start' | null;

/**
 * STOP is matched case- and whitespace-insensitively (so "stop", " STOP ", "St op" all count).
 * START is an exact keyword (case-insensitive, surrounding whitespace trimmed) to avoid
 * accidentally re-subscribing a user who typed a sentence containing "start".
 */
export function classifyControl(text: string): ControlKeyword {
  const collapsed = text.replace(/\s+/g, '').toUpperCase();
  if (collapsed === 'STOP') return 'stop';
  if (text.trim().toUpperCase() === 'START') return 'start';
  return null;
}
