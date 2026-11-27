import { once } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { start } from '../../src/server/server.js';

describe('server entry point', () => {
  afterEach(() => vi.restoreAllMocks());

  it('boots with hardened timeouts, warns about an ephemeral key and drains on SIGTERM', async () => {
    const logs = [];
    vi.spyOn(console, 'log').mockImplementation((line) => logs.push(JSON.parse(line)));
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => {});
    const port = 20000 + Math.floor(Math.random() * 20000);
    const before = process.listeners('SIGTERM').length;
    const server = start({ PORT: String(port), HOST: '127.0.0.1', STATIC_DIR: '/nonexistent', DRAIN_SECONDS: '0' });
    await once(server, 'listening');
    expect(server.headersTimeout).toBe(10_000);
    expect(server.requestTimeout).toBe(15_000);
    expect((await fetch(`http://127.0.0.1:${port}/healthz/ready`)).status).toBe(200);
    expect(logs.map((l) => l.msg)).toEqual(expect.arrayContaining(['platewise listening', expect.stringContaining('ORDER_SIGNING_KEY not set')]));

    const handler = process.listeners('SIGTERM').at(-1);
    handler('SIGTERM');
    handler('SIGTERM'); // a second signal while draining is ignored
    await once(server, 'close');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(logs.filter((l) => l.msg === 'draining')).toHaveLength(1);
    process.removeListener('SIGTERM', handler);
    process.removeListener('SIGINT', process.listeners('SIGINT').at(-1));
    expect(process.listeners('SIGTERM').length).toBe(before);
  });
});
