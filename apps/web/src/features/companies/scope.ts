export type ScopeToken = { tenantId: string | null; version: number };
export class CompanyScope {
  active: string | null = null;
  private version = 0;
  select(id: string) {
    this.active = id;
    this.version++;
  }
  clear() {
    this.active = null;
    this.version++;
  }
  capture(): ScopeToken {
    return { tenantId: this.active, version: this.version };
  }
  matches(token: ScopeToken) {
    return token.tenantId === this.active && token.version === this.version;
  }
  async load<T>(
    run: () => Promise<T>,
    expectedTenant: string | null = this.active,
  ): Promise<T | undefined> {
    if (expectedTenant !== this.active) return undefined;
    const token = this.capture();
    const value = await run();
    return this.matches(token) ? value : undefined;
  }
}
