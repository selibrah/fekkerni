import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { oidcMiddleware } from './oidc';

describe('oidcMiddleware', () => {
  const mockResponse = () => {
    const res = {} as Response;
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res;
  };

  const mockNext = () => vi.fn() as NextFunction;

  // Helper to construct a dummy JWT with a given payload
  const makeToken = (payload: Record<string, unknown>) => {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
    const pay = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = 'signature';
    return `${header}.${pay}.${sig}`;
  };

  it('passes through when disabled', () => {
    const req = { header: vi.fn() } as unknown as Request;
    const res = mockResponse();
    const next = mockNext();

    const middleware = oidcMiddleware({ enabled: false });
    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects requests with missing Authorization header', () => {
    const req = { header: vi.fn().mockReturnValue(undefined) } as unknown as Request;
    const res = mockResponse();
    const next = mockNext();

    const middleware = oidcMiddleware({ enabled: true });
    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('Missing or invalid') }));
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects requests with non-Bearer token', () => {
    const req = { header: vi.fn().mockReturnValue('Basic abc') } as unknown as Request;
    const res = mockResponse();
    const next = mockNext();

    const middleware = oidcMiddleware({ enabled: true });
    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects unparseable tokens', () => {
    const req = { header: vi.fn().mockReturnValue('Bearer bad-token') } as unknown as Request;
    const res = mockResponse();
    const next = mockNext();

    const middleware = oidcMiddleware({ enabled: true });
    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('Invalid OIDC token') }));
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects expired tokens', () => {
    const exp = Math.floor(Date.now() / 1000) - 10; // 10 seconds ago
    const token = makeToken({ exp });
    const req = { header: vi.fn().mockReturnValue(`Bearer ${token}`) } as unknown as Request;
    const res = mockResponse();
    const next = mockNext();

    const middleware = oidcMiddleware({ enabled: true });
    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'OIDC token expired' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects tokens with audience mismatch', () => {
    const exp = Math.floor(Date.now() / 1000) + 60; // 60 seconds from now
    const token = makeToken({ exp, aud: 'wrong-audience' });
    const req = { header: vi.fn().mockReturnValue(`Bearer ${token}`) } as unknown as Request;
    const res = mockResponse();
    const next = mockNext();

    const middleware = oidcMiddleware({ enabled: true, audience: 'expected-audience' });
    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'OIDC token audience mismatch' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts valid tokens with matching audience', () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = makeToken({ exp, aud: 'expected-audience' });
    const req = { header: vi.fn().mockReturnValue(`Bearer ${token}`) } as unknown as Request;
    const res = mockResponse();
    const next = mockNext();

    const middleware = oidcMiddleware({ enabled: true, audience: 'expected-audience' });
    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
