export type DomainVerdict = 'deliverable' | 'undeliverable' | 'unknown';

export abstract class EmailDomainChecker {
  abstract check(domain: string): Promise<DomainVerdict>;
}
