/**
 * Tests for the filter every `api` entry passes before anything is
 * written: what leaves a URL, which headers stay, and the one line an
 * exchange reads as.
 */
import { describe, expect, it } from 'bun:test';

import { exchangeLine, filterExchange, filterUrl } from './api-filter.js';

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

  it('answers no headers member for an exchange that named none', () => {
    expect('headers' in filterExchange({ service: 'hub', method: 'GET', url: 'https://hub.example/' })).toBe(false);
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
