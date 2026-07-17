import type { IdGenerator } from '@/application/ports/IdGenerator';

export class CryptoIdGenerator implements IdGenerator {
  public generate(): string {
    return crypto.randomUUID();
  }
}
