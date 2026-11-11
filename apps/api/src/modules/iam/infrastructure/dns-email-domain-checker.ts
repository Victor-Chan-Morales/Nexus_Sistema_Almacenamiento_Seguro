import { Injectable } from '@nestjs/common';
import { Resolver } from 'node:dns/promises';
import { domainToASCII } from 'node:url';
import { DomainVerdict, EmailDomainChecker } from '../ports/email-domain-checker';

const DNS_DEADLINE_MS = 3000;

@Injectable()
export class DnsEmailDomainChecker implements EmailDomainChecker {
  async check(domain: string): Promise<DomainVerdict> {
    const host = domainToASCII(domain);
    if (!host) return 'undeliverable';
    const resolver = new Resolver();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<DomainVerdict>((resolve) => {
      timer = setTimeout(() => resolve('unknown'), DNS_DEADLINE_MS);
    });
    try {
      return await Promise.race([this.resolveDomain(resolver, host), deadline]);
    } finally {
      clearTimeout(timer);
      resolver.cancel();
    }
  }

  private async resolveDomain(resolver: Resolver, domain: string): Promise<DomainVerdict> {
    try {
      const mx = await resolver.resolveMx(domain);
      if (mx.some(({ exchange }) => exchange !== '' && exchange !== '.')) return 'deliverable';
      if (mx.length) return 'undeliverable';
    } catch (error) {
      if (errorCode(error) === 'ENOTFOUND') return 'undeliverable';
      if (errorCode(error) !== 'ENODATA') return 'unknown';
    }

    try {
      await Promise.any([
        requireAddresses(resolver.resolve4(domain)),
        requireAddresses(resolver.resolve6(domain)),
      ]);
      return 'deliverable';
    } catch (error) {
      const absence = error instanceof AggregateError && error.errors.every((failure: unknown) => {
        const code = errorCode(failure);
        return code === 'ENODATA' || code === 'ENOTFOUND';
      });
      return absence ? 'undeliverable' : 'unknown';
    }
  }
}

async function requireAddresses(query: Promise<string[]>): Promise<void> {
  if (!(await query).length) throw Object.assign(new Error(), { code: 'ENODATA' });
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}
