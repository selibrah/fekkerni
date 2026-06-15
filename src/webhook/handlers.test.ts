import { describe, it, expect } from 'vitest';
import { handleVerification } from './handlers';

describe('handleVerification', () => {
  it('echoes the challenge when mode + token match', () => {
    const out = handleVerification(
      { 'hub.mode': 'subscribe', 'hub.verify_token': 'secret', 'hub.challenge': '12345' },
      'secret',
    );
    expect(out).toEqual({ status: 200, body: '12345' });
  });

  it('403s on a wrong token', () => {
    const out = handleVerification(
      { 'hub.mode': 'subscribe', 'hub.verify_token': 'WRONG', 'hub.challenge': '12345' },
      'secret',
    );
    expect(out.status).toBe(403);
  });

  it('403s when mode is not subscribe or fields are missing', () => {
    expect(handleVerification({ 'hub.verify_token': 'secret', 'hub.challenge': 'x' }, 'secret').status).toBe(403);
    expect(handleVerification({ 'hub.mode': 'subscribe', 'hub.challenge': 'x' }, 'secret').status).toBe(403);
    expect(handleVerification({}, 'secret').status).toBe(403);
  });
});
