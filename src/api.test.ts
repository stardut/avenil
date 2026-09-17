import { describe, expect, it, vi } from 'vitest';

describe('preview API', () => {
  it('previews and applies only ready IDE candidates', async () => {
    window.history.replaceState({}, '', '/?preview=1');
    vi.resetModules();
    const { getApi } = await import('./api');
    const api = getApi();

    expect(api.preview).toBe(true);

    const preview = await api.ideImportPreview({ projectRoot: '/workspace/demo-project' });
    expect(preview.suggestedGroupName).toBe('demo-project');
    expect(preview.candidates.filter((candidate) => candidate.status === 'ready')).toHaveLength(2);

    await expect(api.ideImportPreview({ projectRoot: '   ' })).rejects.toThrow('请先选择项目根目录');

    const next = await api.ideImportApply(preview, ['ide-demo-web', 'ide-demo-debug'], 'demo-project');
    expect(next.groups.some((group) => group.name === 'demo-project')).toBe(true);
    expect(next.services).toHaveLength(6);
    expect(next.services.find((service) => service.id === 'ide-demo-web')?.command).toBe('pnpm dev:web');
  });

  it('reports malformed imports without mutating the current configuration', async () => {
    window.history.replaceState({}, '', '/?preview=1');
    vi.resetModules();
    const { getApi } = await import('./api');
    const api = getApi();
    const before = await api.loadConfig();

    const preview = await api.importPreview('{"schemaVersion":2}');

    expect(preview.canApply).toBe(false);
    expect(preview.errors).toEqual(['文件不是有效的 Avenil 配置']);
    expect(await api.loadConfig()).toEqual(before);
  });

  it('emits runtime updates through the public subscription interface', async () => {
    window.history.replaceState({}, '', '/?preview=1');
    vi.resetModules();
    const { getApi } = await import('./api');
    const api = getApi();
    const updates: string[] = [];
    const unlisten = await api.on('runtime', (payload) => updates.push(payload.status));

    await api.start('service-web');
    unlisten();

    expect(updates).toEqual(['starting', 'running']);
  });

  it('returns a stopping snapshot before the stop completion event', async () => {
    window.history.replaceState({}, '', '/?preview=1');
    vi.resetModules();
    const { getApi } = await import('./api');
    const api = getApi();
    const updates: string[] = [];
    const unlisten = await api.on('runtime', (payload) => updates.push(payload.status));

    const snapshot = await api.stop('service-api');

    expect(snapshot.status).toBe('stopping');
    expect(updates).toEqual(['stopping']);
    await new Promise((resolve) => window.setTimeout(resolve, 360));
    unlisten();

    expect(updates).toEqual(['stopping', 'stopped']);
  });
});
