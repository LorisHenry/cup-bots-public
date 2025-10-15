import { looksLikeLoginPage, buildCookieHeaderFromSetCookie } from '../main/scraper.mjs';

describe('looksLikeLoginPage', () => {
  it('detects login markers', () => {
    const html = '<form action="ucp.php?mode=login"><input name="username"><input name="password" id="login"></form>';
    expect(looksLikeLoginPage(html)).toBe(true);
  });
  it('returns false for regular content', () => {
    expect(looksLikeLoginPage('<div>Welcome</div>')).toBe(false);
  });
});

describe('buildCookieHeaderFromSetCookie', () => {
  it('uses only the last 3 Set-Cookie headers, keeps last occurrence per name, and strips attributes', () => {
    const arr = [
      'PHPSESSID=abc; Path=/; HttpOnly',
      'lang=fr; Path=/',
      'PHPSESSID=xyz; Path=/; HttpOnly',
      'empty=; Path=/',
      'gone=deleted; Path=/'
    ];
    const cookie = buildCookieHeaderFromSetCookie(arr);
    // Only the last 3 are considered: [PHPSESSID=xyz, empty=, gone=deleted]
    // After filtering, only PHPSESSID=xyz should remain.
    expect(cookie).toBe('PHPSESSID=xyz');
    expect(cookie).not.toContain('lang=fr');
    expect(cookie).not.toContain('empty=');
    expect(cookie).not.toContain('gone=');
    expect(cookie).not.toContain('Path');
  });
  it('handles single string input', () => {
    const cookie = buildCookieHeaderFromSetCookie('token=abc; Secure; Path=/');
    expect(cookie).toBe('token=abc');
  });
});
