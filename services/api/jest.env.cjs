if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'test';
}

const blockedWozHosts = new Set(['api.kadaster.nl', 'api.pdok.nl']);
const originalFetch = globalThis.fetch;

if (typeof originalFetch === 'function') {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' || input instanceof URL ? new URL(input) : new URL(input.url);

    if (blockedWozHosts.has(url.hostname)) {
      throw new Error(
        `Blocked unmocked WOZ network request in API tests: ${url.href}. Inject a mocked fetch implementation instead.`
      );
    }

    return originalFetch(input, init);
  };
}
