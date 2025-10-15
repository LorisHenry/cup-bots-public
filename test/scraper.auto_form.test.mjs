// ESM mocking of node-fetch for autoSubmitGoogleForm
import { jest } from '@jest/globals';

// Mock node-fetch before importing the module under test
const fetchMock = jest.fn();
await jest.unstable_mockModule('node-fetch', () => ({ default: fetchMock }));

const { autoSubmitGoogleForm } = await import('../main/scraper.mjs');

function makeResponse({ status = 200, text = '' } = {}) {
  return {
    status,
    ok: status >= 200 && status < 400,
    text: async () => text,
  };
}

describe('autoSubmitGoogleForm', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('submits with detected entry fields and returns ok for 302/200', async () => {
    // First call: load form HTML with some entry fields
    fetchMock.mockResolvedValueOnce(makeResponse({
      status: 200,
      text: '<form><input name="entry.123"><textarea name="entry.456"></textarea></form>'
    }));
    // Second call: submission response (e.g., 302 redirect typical for form submit)
    fetchMock.mockResolvedValueOnce(makeResponse({ status: 302 }));

    const res = await autoSubmitGoogleForm('https://docs.google.com/forms/d/e/FORMID/viewform');
    expect(res.ok).toBe(true);
    expect(res.submitted).toBe(true);
    expect(res.status).toBe(302);

    // Ensure we called fetch twice (load form, submit)
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('handles errors gracefully', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network'));
    const res = await autoSubmitGoogleForm('https://docs.google.com/forms/d/e/FORMID/viewform');
    expect(res.ok).toBe(false);
    expect(res.submitted).toBe(false);
    expect(res.message).toMatch(/network/);
  });
});
