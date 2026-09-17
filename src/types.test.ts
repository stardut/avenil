import { describe, expect, it } from 'vitest';

import { createService, emptyRuntime } from './types';

describe('service factories', () => {
  it('creates a new service with safe defaults', () => {
    const service = createService('group-local');

    expect(service.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(service.groupId).toBe('group-local');
    expect(service.shell).toEqual({ program: '/bin/zsh', args: ['-lc'] });
    expect(service.env).toEqual([]);
    expect(service.log).toEqual({
      maxBytes: 2 * 1024 * 1024,
      rotateCount: 3,
      maxMemoryBytes: 4 * 1024 * 1024,
    });
  });

  it('creates an inactive runtime snapshot without inventing process state', () => {
    expect(emptyRuntime('service-1')).toEqual({
      serviceId: 'service-1',
      generation: null,
      status: 'stopped',
      pid: null,
      pgid: null,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      signal: null,
      error: null,
    });
  });
});
