import { analyzeHtml, detectTicketSale } from '../main/scraper.mjs';

const sampleHtml = `
<div class="search postbg1">
  <div class="inner">
    <dl class="postprofile">
      <dd>Forum: <a href="/viewforum.php?f=1">Billetterie</a></dd>
    </dl>
    <div class="postbody">
      <h3><a href="#">Ouverture des ventes</a></h3>
      <div class="content">
        <p>Salut tout le monde! Voici le lien: https://forms.gle/abcd1234</p>
        <blockquote>Ancien message cité</blockquote>
      </div>
      <dd class="search-result-date">jeu. oct. 09, 2025 4:44 pm</dd>
    </div>
  </div>
</div>`;

describe('analyzeHtml', () => {
  it('extracts top message text/html, timestamp, forumName, title', () => {
    const res = analyzeHtml(sampleHtml);
    expect(res).toBeTruthy();
    expect(res.messageText).toContain('Salut tout le monde');
    expect(res.messageHtml).not.toContain('blockquote');
    expect(res.timestamp).toBeTruthy();
    expect(res.forumName).toBe('Billetterie');
    expect(res.title).toBe('Ouverture des ventes');
  });
});

describe('detectTicketSale', () => {
  it('finds a Google Forms URL in content', () => {
    const res = detectTicketSale(sampleHtml);
    expect(res).toMatch(/^https?:\/\/forms\.gle\//);
  });
  it('returns null when not present', () => {
    expect(detectTicketSale('<p>No link</p>')).toBeNull();
  });
});
