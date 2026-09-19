import { CurrencyApiProvider } from './currency-api.provider';
import { RateProviderError } from '../rate-provider';

const originalFetch = global.fetch;

function answers(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function eurBody(rates: Record<string, unknown>) {
  return { date: '2026-09-17', eur: rates };
}

describe('CurrencyApiProvider', () => {
  let fetchMock: jest.Mock;
  let provider: CurrencyApiProvider;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    provider = new CurrencyApiProvider(50);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('quotes the requested base and uppercases the codes', async () => {
    fetchMock.mockResolvedValue(answers(eurBody({ pln: 4.36324096, usd: 1.14631497 })));

    await expect(provider.getRates('eur')).resolves.toEqual({
      base: 'EUR',
      date: '2026-09-17',
      rates: { PLN: 4.36324096, USD: 1.14631497 },
      provider: 'currency-api',
    });
    expect(fetchMock.mock.calls[0][0]).toContain('/currencies/eur.json');
  });

  it('keeps the date the provider published, not today', async () => {
    fetchMock.mockResolvedValue(answers({ date: '2026-09-16', pln: { eur: 0.229 } }));

    await expect(provider.getRates('PLN')).resolves.toMatchObject({ date: '2026-09-16' });
  });

  it('falls back to the second host when the CDN fails', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('ENOTFOUND'))
      .mockResolvedValueOnce(answers(eurBody({ pln: 4.36 })));

    await expect(provider.getRates('EUR')).resolves.toMatchObject({ rates: { PLN: 4.36 } });
    expect(fetchMock.mock.calls[0][0]).toContain('cdn.jsdelivr.net');
    expect(fetchMock.mock.calls[1][0]).toContain('currency-api.pages.dev');
  });

  it('reports every host it tried once they all fail', async () => {
    fetchMock.mockResolvedValue(answers(null, 503));

    await expect(provider.getRates('EUR')).rejects.toThrow(RateProviderError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a response that carries no map for the requested base', async () => {
    fetchMock.mockResolvedValue(answers({ date: '2026-09-17', usd: { eur: 0.87 } }));

    await expect(provider.getRates('EUR')).rejects.toThrow(/no rates for EUR/);
  });

  it('drops entries that are not positive finite numbers', async () => {
    fetchMock.mockResolvedValue(answers(eurBody({ pln: 4.36, usd: null, gbp: 0, chf: 'x' })));

    await expect(provider.getRates('EUR')).resolves.toMatchObject({ rates: { PLN: 4.36 } });
  });

  it('refuses a code that is not three letters without calling out', async () => {
    await expect(provider.getRates('../secrets')).rejects.toThrow(TypeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
