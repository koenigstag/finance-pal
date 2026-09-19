import { OpenErApiProvider } from './open-er-api.provider';
import { RateProviderError } from '../rate-provider';

const originalFetch = global.fetch;

function answers(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe('OpenErApiProvider', () => {
  let fetchMock: jest.Mock;
  let provider: OpenErApiProvider;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    provider = new OpenErApiProvider(50);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('maps the rates and dates them by the provider last refresh', async () => {
    fetchMock.mockResolvedValue(
      answers({
        result: 'success',
        base_code: 'PLN',
        time_last_update_unix: 1789603351,
        rates: { PLN: 1, EUR: 0.229, UAH: 10.22 },
      }),
    );

    await expect(provider.getRates('pln')).resolves.toEqual({
      base: 'PLN',
      date: '2026-09-17',
      rates: { PLN: 1, EUR: 0.229, UAH: 10.22 },
      provider: 'open-er-api',
    });
    expect(fetchMock.mock.calls[0][0]).toBe('https://open.er-api.com/v6/latest/PLN');
  });

  it('treats an error body as a failure even though the status is 200', async () => {
    fetchMock.mockResolvedValue(answers({ result: 'error', 'error-type': 'unsupported-code' }));

    await expect(provider.getRates('XYZ')).rejects.toThrow(/unsupported-code/);
  });

  it('fails on a transport error', async () => {
    fetchMock.mockRejectedValue(new Error('timed out'));

    await expect(provider.getRates('EUR')).rejects.toThrow(RateProviderError);
  });

  it('fails on a response that is not in the documented shape', async () => {
    fetchMock.mockResolvedValue(answers({ rates: { EUR: 1 } }));

    await expect(provider.getRates('EUR')).rejects.toThrow(/documented shape/);
  });

  it('carries the attribution its terms require', () => {
    expect(provider.attribution).toEqual({
      text: 'Rates By Exchange Rate API',
      url: 'https://www.exchangerate-api.com',
    });
  });
});
