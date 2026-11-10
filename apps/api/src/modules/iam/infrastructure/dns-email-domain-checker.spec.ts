import { Resolver } from 'node:dns/promises';
import { DnsEmailDomainChecker } from './dns-email-domain-checker';

jest.mock('node:dns/promises', () => ({ Resolver: jest.fn() }));

const dnsError = (code: string) => Object.assign(new Error(code), { code });

describe('DnsEmailDomainChecker', () => {
  const checker = new DnsEmailDomainChecker();
  const resolver = { resolveMx: jest.fn(), resolve4: jest.fn(), resolve6: jest.fn(), cancel: jest.fn() };

  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(Resolver).mockReturnValue(resolver as unknown as Resolver);
    resolver.resolveMx.mockRejectedValue(dnsError('ENODATA'));
    resolver.resolve4.mockRejectedValue(dnsError('ENODATA'));
    resolver.resolve6.mockRejectedValue(dnsError('ENODATA'));
  });

  it('acepta un dominio con MX', async () => {
    resolver.resolveMx.mockResolvedValue([{ exchange: 'mx.example.com', priority: 10 }]);
    await expect(checker.check('example.com')).resolves.toBe('deliverable');
    expect(resolver.resolve4).not.toHaveBeenCalled();
  });

  it.each(['.', ''])('rechaza MX nulo (%j) sin consultar A ni AAAA', async (exchange) => {
    resolver.resolveMx.mockResolvedValue([{ exchange, priority: 0 }]);
    await expect(checker.check('example.com')).resolves.toBe('undeliverable');
    expect(resolver.resolve4).not.toHaveBeenCalled();
  });

  it.each(['resolve4', 'resolve6'] as const)('acepta un dominio sin MX con %s', async (method) => {
    resolver[method].mockResolvedValue(['dirección']);
    await expect(checker.check('example.com')).resolves.toBe('deliverable');
  });

  it('rechaza un dominio sin MX, A ni AAAA', async () => {
    await expect(checker.check('example.com')).resolves.toBe('undeliverable');
  });

  it.each([['ENOTFOUND', 'undeliverable'], ['ESERVFAIL', 'unknown']])('interpreta %s como %s', async (code, verdict) => {
    resolver.resolveMx.mockRejectedValue(dnsError(code));
    await expect(checker.check('example.com')).resolves.toBe(verdict);
  });

  it('permite continuar si no hay A pero no se pudo consultar AAAA', async () => {
    resolver.resolve6.mockRejectedValue(dnsError('ESERVFAIL'));
    await expect(checker.check('example.com')).resolves.toBe('unknown');
  });

  it('comparte un límite total de 3 segundos y cancela consultas pendientes', async () => {
    jest.useFakeTimers();
    try {
      resolver.resolve4.mockImplementation(() => new Promise(() => undefined));
      const verdict = checker.check('example.com');
      await jest.advanceTimersByTimeAsync(3000);
      await expect(verdict).resolves.toBe('unknown');
      expect(resolver.cancel).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
