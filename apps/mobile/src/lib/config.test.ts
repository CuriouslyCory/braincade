import { describe, expect, it } from 'vitest';
import { isSameOrigin, originOf, resolveBaseUrl } from './config';

describe('resolveBaseUrl', () => {
  it('prefers the saved override, then the env URL', () => {
    expect(
      resolveBaseUrl({
        override: 'http://192.168.1.20:5173/',
        envUrl: 'https://braincade.example.com',
        devHostUri: '192.168.1.5:8081',
      }),
    ).toBe('http://192.168.1.20:5173');
    expect(resolveBaseUrl({ override: '  ', envUrl: 'https://braincade.example.com/' })).toBe(
      'https://braincade.example.com',
    );
  });

  it('ignores values that are not http(s) URLs', () => {
    expect(resolveBaseUrl({ override: 'braincade.local', envUrl: '' })).toBeNull();
  });

  it('falls back to the web dev server next to Metro', () => {
    expect(resolveBaseUrl({ devHostUri: '192.168.1.5:8081' })).toBe('http://192.168.1.5:5173');
    expect(resolveBaseUrl({})).toBeNull();
  });
});

describe('origins', () => {
  it('extracts and compares origins', () => {
    expect(originOf('https://Example.com/games/play.html?game=a')).toBe('https://example.com');
    expect(isSameOrigin('https://example.com/play.html', 'https://example.com')).toBe(true);
    expect(isSameOrigin('https://evil.com/play.html', 'https://example.com')).toBe(false);
    expect(isSameOrigin('https://example.com.evil.com/', 'https://example.com')).toBe(false);
    expect(isSameOrigin('javascript:alert(1)', 'https://example.com')).toBe(false);
  });
});
