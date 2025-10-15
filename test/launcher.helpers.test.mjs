import { hashString, parseForumTimestampToMs, titleMatchesWhitelist, norm, loadWhitelist } from '../launcher/watch_top_message.mjs';

describe('hashString', () => {
  it('produces deterministic hash for same input', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).not.toBe(hashString('abcd'));
  });
});

describe('parseForumTimestampToMs', () => {
  it('parses ISO-like dates', () => {
    const ms = parseForumTimestampToMs('2025-10-13 19:09');
    expect(typeof ms).toBe('number');
    expect(ms).not.toBeNull();
  });
  it('parses French phpBB style', () => {
    const ms = parseForumTimestampToMs('jeu. oct. 09, 2025 4:44 pm');
    expect(typeof ms).toBe('number');
    expect(ms).not.toBeNull();
  });
  it('returns null for invalid', () => {
    expect(parseForumTimestampToMs('not a date')).toBeNull();
  });
});

describe('norm and titleMatchesWhitelist', () => {
  it('normalizes diacritics and case', () => {
    expect(norm('Événement')).toBe('evenement');
  });
  it('matches terms by subforum', () => {
    const wl = { 'Billetterie': ['Ventes', 'Match'] };
    expect(titleMatchesWhitelist('Billetterie', 'Ouverture des ventes PSG', wl)).toBe(true);
    expect(titleMatchesWhitelist('Billetterie', 'Discussion générale', wl)).toBe(false);
  });
});

describe('loadWhitelist', () => {
  const prev = process.env.WHITEWORDS;
  afterEach(() => { process.env.WHITEWORDS = prev; });
  it('parses JSON from env', () => {
    process.env.WHITEWORDS = JSON.stringify({ A: ['x'] });
    expect(loadWhitelist()).toEqual({ A: ['x'] });
  });
  it('parses JSON when the whole value is wrapped in single quotes (as in .env)', () => {
    process.env.WHITEWORDS = '\'{"Matchs / Déplacements - Équipe première": ["Lorient"]}\'';
    const wl = loadWhitelist();
    expect(wl["Matchs / Déplacements - Équipe première"]).toEqual(["Lorient"]);
  });
  it('returns {} when invalid JSON', () => {
    process.env.WHITEWORDS = '{invalid}';
    const wl = loadWhitelist();
    expect(wl).toEqual({});
  });
});
