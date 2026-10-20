/**
 * Tests for the filter every `api` entry passes before anything is
 * written: what leaves a URL, which headers stay, and the one line an
 * exchange reads as.
 */
import type { ApiExchange } from '../../ports/index.js';

import { describe, expect, it } from 'bun:test';

import { exchangeLine, filterExchange, filterUrl, scrubUrls } from './api-filter.js';

describe('filterUrl', () => {
  it('drops the user info and redacts a sensitive query value, keeping the rest', () => {
    expect(filterUrl('https://u:p@hub.example/v1/sync?token=abc&page=2'))
      .toBe('https://hub.example/v1/sync?token=[redacted]&page=2');
  });

  it.each(['access_token', 'api_key', 'client_secret', 'X-Signature', 'password', 'auth', 'code'])(
    'redacts the value of %s',
    (name) => {
      expect(filterUrl(`https://hub.example/x?${name}=s3cret`)).toBe(`https://hub.example/x?${name}=[redacted]`);
    },
  );

  it('reads a name through its percent-encoding, and redacts one it cannot decode', () => {
    expect(filterUrl('https://hub.example/x?%74oken=s3cret')).toBe('https://hub.example/x?%74oken=[redacted]');
    expect(filterUrl('https://hub.example/x?t%6Fken=s3cret')).toBe('https://hub.example/x?t%6Fken=[redacted]');
    expect(filterUrl('https://hub.example/x?%E0%A4%A=s3cret')).toBe('https://hub.example/x?%E0%A4%A=[redacted]');
  });

  it('reads a query separated by semicolons', () => {
    expect(filterUrl('https://hub.example/x?a=1;token=s3cret')).toBe('https://hub.example/x?a=1;token=[redacted]');
  });

  it('redacts a query part with no name, which may be the secret itself', () => {
    expect(filterUrl('https://hub.example/x?s3cret')).toBe('https://hub.example/x?[redacted]');
  });

  it.each(['sig', 'jwt', 'session_id', 'pwd', 'credential'])('redacts the value of %s too', (name) => {
    expect(filterUrl(`https://hub.example/x?${name}=s3cret`)).toBe(`https://hub.example/x?${name}=[redacted]`);
  });

  it('leaves a URL with nothing sensitive as it is', () => {
    expect(filterUrl('https://hub.example/v1/rows?page=2&limit=50')).toBe('https://hub.example/v1/rows?page=2&limit=50');
  });

  it('answers a marker for a string that is no URL, never the string', () => {
    expect(filterUrl('token=abc not a url')).toBe('[unreadable url]');
  });
});

describe('filterExchange', () => {
  it('keeps only the headers of the allow-list, lower-cased', () => {
    const filtered = filterExchange({
      service: 'hub',
      method: 'GET',
      url: 'https://hub.example/v1/sync?token=abc',
      status: 200,
      headers: { 'Authorization': 'Bearer abc', 'Cookie': 'sid=1', 'Content-Type': 'application/json', 'X-Request-Id': 'r-1' },
    });

    expect(filtered.headers).toEqual({ 'content-type': 'application/json', 'x-request-id': 'r-1' });
    expect(filtered.url).toBe('https://hub.example/v1/sync?token=[redacted]');
    expect(JSON.stringify(filtered)).not.toContain('abc');
  });

  it('answers the members the type names and no other, whatever the object handed in holds', () => {
    const record = {
      service: 'hub',
      method: 'POST',
      url: 'https://hub.example/x',
      status: 500,
      body: '{"password":"s3cret"}',
      requestHeaders: { authorization: 'Bearer tok' },
    };
    const exchange: ApiExchange = record;

    expect(filterExchange(exchange)).toEqual({ service: 'hub', method: 'POST', url: 'https://hub.example/x', status: 500 });
  });

  it('answers no headers member for an exchange that named none', () => {
    expect('headers' in filterExchange({ service: 'hub', method: 'GET', url: 'https://hub.example/' })).toBe(false);
  });
});

describe('scrubUrls', () => {
  it('filters every URL a text holds, and leaves the rest of it', () => {
    expect(scrubUrls('fetch https://u:p@hub.example/x?token=s3cret failed, then https://hub.example/y?page=2 answered'))
      .toBe('fetch https://hub.example/x?token=[redacted] failed, then https://hub.example/y?page=2 answered');
  });

  it('leaves a text holding no URL as it is', () => {
    expect(scrubUrls('socket closed')).toBe('socket closed');
  });
});

describe('exchangeLine', () => {
  it('reads as service, method, filtered url, status and duration', () => {
    expect(exchangeLine({ service: 'hub', method: 'post', url: 'https://hub.example/v1/sync?key=k', status: 201, durationMs: 123.4 }))
      .toBe('hub POST https://hub.example/v1/sync?key=[redacted] → 201 in 123 ms');
  });

  it('says no response for a missing status, and leaves a missing duration out', () => {
    expect(exchangeLine({ service: 'hub', method: 'GET', url: 'https://hub.example/' }))
      .toBe('hub GET https://hub.example/ → no response');
  });
});
