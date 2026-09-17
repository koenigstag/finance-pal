import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectLanguage } from './languages';

describe('detectLanguage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const withBrowserLanguage = (language: string) =>
    vi.stubGlobal('navigator', { ...navigator, language });

  it.each([
    ['ru-RU', 'ru'],
    ['ru', 'ru'],
    ['en-GB', 'en'],
    ['EN-us', 'en'],
  ])('maps %s to %s', (browser, expected) => {
    withBrowserLanguage(browser);
    expect(detectLanguage()).toBe(expected);
  });

  it('falls back to English for an unsupported language', () => {
    withBrowserLanguage('de-DE');
    expect(detectLanguage()).toBe('en');
  });
});
