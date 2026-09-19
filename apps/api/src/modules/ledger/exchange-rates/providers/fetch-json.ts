import { RateProviderError } from '../rate-provider';

/**
 * Fetches JSON, turning every way a request can go wrong into one RateProviderError. Note that an
 * ok status is not success on its own: providers here also report failures in a 200 body, so each
 * one still has to inspect what it got back.
 */
export async function fetchJson(provider: string, url: string, timeoutMs: number): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    throw new RateProviderError(provider, `request to ${url} failed`, { cause });
  }

  if (!response.ok) {
    throw new RateProviderError(provider, `${url} answered ${response.status}`);
  }

  try {
    return await response.json();
  } catch (cause) {
    throw new RateProviderError(provider, `${url} answered with malformed JSON`, { cause });
  }
}
