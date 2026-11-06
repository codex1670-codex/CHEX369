import test from 'node:test';
import assert from 'node:assert/strict';

const { createCache } = await import('../src/cache.ts');
const { loadConfig } = await import('../src/config.ts');

test('memory cache stores, expires and wraps', async () => {
  const c = createCache(undefined);
  assert.equal(c.backend, 'memory');
  await c.set('a', { n: 1 }, 60);
  assert.deepEqual(await c.get('a'), { n: 1 });
  await c.del('a');
  assert.equal(await c.get('a'), null);

  let calls = 0;
  const compute = async () => { calls++; return 42; };
  assert.equal(await c.wrap('k', 60, compute), 42);
  assert.equal(await c.wrap('k', 60, compute), 42);
  assert.equal(calls, 1, 'second call is served from cache');

  await c.set('short', 'x', 0); // ttl 0 => already expired
  assert.equal(await c.get('short'), null);
  await c.close();
});

test('config validates the environment', () => {
  const ok = loadConfig({ NODE_ENV: 'production', PORT: '8080', CORS_ORIGIN: 'https://a.com, https://b.com' });
  assert.equal(ok.PORT, 8080);
  assert.equal(ok.isProd, true);
  assert.deepEqual(ok.corsOrigins, ['https://a.com', 'https://b.com']);
  assert.throws(() => loadConfig({ REDIS_URL: 'not a url' }), /Invalid environment configuration/);
  assert.throws(() => loadConfig({ PORT: '99999' }), /PORT/);
});

test('ai client reports disabled without AI_SERVICE_URL and fails fast', async () => {
  const { ai, AiUnavailableError } = await import('../src/aiClient.ts');
  assert.equal(ai.enabled(), false);
  await assert.rejects(() => ai.chat({ message: 'hi' }), AiUnavailableError);
});
