import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  AppConfig,
  BatchAction,
  BatchActionResult,
  CliInstallInfo,
  ExportResult,
  Group,
  IdeImportInput,
  IdeImportPreview,
  ImportPreview,
  LogPage,
  ResourceSnapshot,
  RuntimeSnapshot,
  Service,
  emptyRuntime,
} from './types';

export const previewMode = new URLSearchParams(window.location.search).get('preview') === '1';
export const inTauri = Boolean((window as Window & { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown }).__TAURI_INTERNALS__ || (window as Window & { __TAURI__?: unknown }).__TAURI__);

export type RuntimeEvent = { kind: 'runtime' | 'resource' | 'log' | 'config' | 'shutdown' | 'quitRequested'; payload: unknown };

export interface AvenilApi {
  readonly preview: boolean;
  loadConfig(): Promise<AppConfig>;
  saveConfig(config: AppConfig): Promise<void>;
  importPreview(json: string): Promise<ImportPreview>;
  importApply(json: string): Promise<AppConfig>;
  chooseProjectDirectory(): Promise<string | null>;
  ideImportPreview(input: IdeImportInput): Promise<IdeImportPreview>;
  ideImportApply(preview: IdeImportPreview, selectedIds: string[], groupName: string): Promise<AppConfig>;
  exportConfig(): Promise<ExportResult>;
  cliInstallInfo(): Promise<CliInstallInfo>;
  installCli(): Promise<CliInstallInfo>;
  upsertGroup(group: Group): Promise<Group>;
  deleteGroup(groupId: string): Promise<void>;
  upsertService(service: Service): Promise<Service>;
  deleteService(serviceId: string): Promise<void>;
  start(serviceId: string): Promise<RuntimeSnapshot>;
  stop(serviceId: string): Promise<RuntimeSnapshot>;
  restart(serviceId: string): Promise<RuntimeSnapshot>;
  batch(serviceIds: string[], action: BatchAction): Promise<BatchActionResult[]>;
  runtime(serviceIds?: string[]): Promise<RuntimeSnapshot[]>;
  resources(serviceIds?: string[]): Promise<ResourceSnapshot[]>;
  logs(serviceId: string, afterSeq?: number, limit?: number): Promise<LogPage>;
  openUrl(serviceId: string): Promise<void>;
  quitRequestPending(): Promise<boolean>;
  cancelQuitRequest(): Promise<void>;
  quit(): Promise<void>;
  on(event: RuntimeEvent['kind'], callback: (payload: any) => void): Promise<UnlistenFn>;
}

const command = <T>(name: string, args?: Record<string, unknown>) => invoke<T>(name, args);

const tauriApi: AvenilApi = {
  preview: false,
  loadConfig: () => command<AppConfig>('config_load'),
  saveConfig: (config) => command<void>('config_save', { config }),
  importPreview: (json) => command<ImportPreview>('config_import_preview', { json }),
  importApply: (json) => command<AppConfig>('config_import_apply', { json }),
  chooseProjectDirectory: () => command<string | null>('choose_project_directory'),
  ideImportPreview: (input) => command<IdeImportPreview>('ide_import_preview', { input }),
  ideImportApply: (preview, selectedIds, groupName) => command<AppConfig>('ide_import_apply', { preview, selectedIds, groupName }),
  exportConfig: () => command<ExportResult>('config_export'),
  cliInstallInfo: () => command<CliInstallInfo>('cli_install_info'),
  installCli: () => command<CliInstallInfo>('cli_install'),
  upsertGroup: (group) => command<Group>('group_upsert', { group }),
  deleteGroup: (groupId) => command<void>('group_delete', { groupId }),
  upsertService: (service) => command<Service>('service_upsert', { service }),
  deleteService: (serviceId) => command<void>('service_delete', { serviceId }),
  start: (serviceId) => command<RuntimeSnapshot>('service_start', { serviceId }),
  stop: (serviceId) => command<RuntimeSnapshot>('service_stop', { serviceId }),
  restart: (serviceId) => command<RuntimeSnapshot>('service_restart', { serviceId }),
  batch: (serviceIds, action) => command<BatchActionResult[]>('service_batch_action', { serviceIds, action }),
  runtime: (serviceIds) => command<RuntimeSnapshot[]>('runtime_snapshot', serviceIds ? { serviceIds } : undefined),
  resources: (serviceIds) => command<ResourceSnapshot[]>('resource_snapshot', serviceIds ? { serviceIds } : undefined),
  logs: (serviceId, afterSeq, limit) => command<LogPage>('log_page', { serviceId, afterSeq, limit }),
  openUrl: (serviceId) => command<void>('open_service_url', { serviceId }),
  quitRequestPending: () => command<boolean>('quit_request_pending'),
  cancelQuitRequest: () => command<void>('quit_request_cancel'),
  quit: () => command<void>('app_quit'),
  on: async (event, callback) => {
    const names = {
      runtime: 'avenil://runtime-changed',
      resource: 'avenil://resource-changed',
      log: 'avenil://log',
      config: 'avenil://config-changed',
      shutdown: 'avenil://shutdown-state',
      quitRequested: 'avenil://quit-requested',
    } as const;
    return listen(names[event], (message) => callback(message.payload));
  },
};

const now = () => new Date().toISOString();
const sampleGroups: Group[] = [
  { id: 'group-commerce', name: '电商本地环境', sortOrder: 0 },
  { id: 'group-content', name: '内容平台', sortOrder: 1 },
  { id: 'group-lab', name: '实验项目', sortOrder: 2 },
];
const sampleServices: Service[] = [
  { id: 'service-api', name: '订单 API', groupId: 'group-commerce', workdir: '/workspace/shop-api', command: 'mvn spring-boot:run', shell: { program: '/bin/zsh', args: ['-lc'] }, env: [{ key: 'SPRING_PROFILES_ACTIVE', value: 'local' }], port: 8080, url: 'http://localhost:8080', log: { maxBytes: 2 * 1024 * 1024, rotateCount: 3, maxMemoryBytes: 256 * 1024 } },
  { id: 'service-web', name: '运营前端', groupId: 'group-commerce', workdir: '/workspace/shop-web', command: 'pnpm dev', shell: { program: '/bin/zsh', args: ['-lc'] }, env: [], port: 5173, url: 'http://localhost:5173', log: { maxBytes: 2 * 1024 * 1024, rotateCount: 3, maxMemoryBytes: 256 * 1024 } },
  { id: 'service-worker', name: '内容 Worker', groupId: 'group-content', workdir: '/workspace/content-worker', command: 'python -m worker', shell: { program: '/bin/zsh', args: ['-lc'] }, env: [], port: null, url: null, log: { maxBytes: 2 * 1024 * 1024, rotateCount: 3, maxMemoryBytes: 256 * 1024 } },
  { id: 'service-gateway', name: '内容网关', groupId: 'group-content', workdir: '/workspace/content-gateway', command: 'node server.js', shell: { program: '/bin/zsh', args: ['-lc'] }, env: [], port: 3000, url: 'http://localhost:3000', log: { maxBytes: 2 * 1024 * 1024, rotateCount: 3, maxMemoryBytes: 256 * 1024 } },
  { id: 'service-lab', name: '组件实验室', groupId: 'group-lab', workdir: '/workspace/lab', command: 'pnpm dev', shell: { program: '/bin/zsh', args: ['-lc'] }, env: [], port: 4173, url: 'http://localhost:4173', log: { maxBytes: 2 * 1024 * 1024, rotateCount: 3, maxMemoryBytes: 256 * 1024 } },
];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function mockApi(): AvenilApi {
  let config: AppConfig = { schemaVersion: 1, groups: clone(sampleGroups), services: clone(sampleServices) };
  const runtimes = new Map<string, RuntimeSnapshot>([
    ['service-api', { ...emptyRuntime('service-api'), generation: 'demo-api-1', status: 'running', pid: 41201, pgid: 41201, startedAt: now() }],
    ['service-web', { ...emptyRuntime('service-web'), status: 'stopped' }],
    ['service-worker', { ...emptyRuntime('service-worker'), generation: 'demo-worker-2', status: 'failed', pid: null, error: '命令退出，退出码 1', endedAt: now(), exitCode: 1 }],
    ['service-gateway', { ...emptyRuntime('service-gateway'), generation: 'demo-gateway-1', status: 'starting', pid: 41244, pgid: 41244, startedAt: now() }],
    ['service-lab', { ...emptyRuntime('service-lab'), status: 'exited', endedAt: now(), exitCode: 0 }],
  ]);
  const resources = new Map<string, ResourceSnapshot>([
    ['service-api', { serviceId: 'service-api', generation: 'demo-api-1', capturedAt: now(), processCount: 5, cpuPercent: 12.8, rssBytes: 312 * 1024 * 1024 }],
    ['service-gateway', { serviceId: 'service-gateway', generation: 'demo-gateway-1', capturedAt: now(), processCount: 2, cpuPercent: 4.1, rssBytes: 128 * 1024 * 1024 }],
  ]);
  const logs = new Map<string, LogPage>(sampleServices.map((service, index) => [service.id, { serviceId: service.id, generation: runtimes.get(service.id)?.generation ?? null, chunks: [{ serviceId: service.id, generation: runtimes.get(service.id)?.generation ?? null, seq: index + 1, stream: 'system', timestamp: now(), text: `演示数据 · ${service.name} 已准备就绪` }], nextSeq: index + 2, truncated: false, droppedChunks: 0 }]));
  const callbacks = new Map<string, Set<(payload: any) => void>>();
  let cliInstalled = false;
  const emit = (event: string, payload: any) => callbacks.get(event)?.forEach((callback) => callback(payload));
  const delay = (ms = 220) => new Promise((resolve) => window.setTimeout(resolve, ms));

  const updateRuntime = (serviceId: string, status: RuntimeSnapshot['status']) => {
    const previous = runtimes.get(serviceId) ?? emptyRuntime(serviceId);
    const isActive = status === 'running' || status === 'starting';
    const snapshot: RuntimeSnapshot = { ...previous, status, pid: isActive ? previous.pid ?? Math.floor(40000 + Math.random() * 8000) : null, pgid: isActive ? previous.pgid ?? Math.floor(40000 + Math.random() * 8000) : null, generation: isActive ? previous.generation ?? `demo-${Date.now()}` : previous.generation, startedAt: isActive ? previous.startedAt ?? now() : previous.startedAt, endedAt: isActive ? null : now(), error: null };
    runtimes.set(serviceId, snapshot);
    emit('runtime', snapshot);
    return snapshot;
  };

  const mockCliInfo = (): CliInstallInfo => ({
    supported: true,
    installed: cliInstalled,
    pathConfigured: false,
    linkPath: '~/.local/bin/avenil',
    executablePath: '/Applications/Avenil.app/Contents/MacOS/avenil',
    installCommand: 'mkdir -p "$HOME/.local/bin" && if [ -L "$HOME/.local/bin/avenil" ] && [ "$HOME/.local/bin/avenil" -ef \'/Applications/Avenil.app/Contents/MacOS/avenil\' ]; then :; elif [ -e "$HOME/.local/bin/avenil" ] || [ -L "$HOME/.local/bin/avenil" ]; then printf \'%s\\n\' \'Avenil CLI install path is already occupied.\' >&2; exit 1; else ln -s \'/Applications/Avenil.app/Contents/MacOS/avenil\' "$HOME/.local/bin/avenil"; fi',
    pathCommand: 'grep -qxF \'export PATH="$HOME/.local/bin:$PATH"\' "$HOME/.zprofile" 2>/dev/null || printf \'\\n# Avenil CLI\\nexport PATH="$HOME/.local/bin:$PATH"\\n\' >> "$HOME/.zprofile"',
    reloadCommand: 'source "$HOME/.zprofile"',
    conflict: null,
  });

  return {
    preview: true,
    loadConfig: async () => clone(config),
    saveConfig: async (next) => { config = clone(next); emit('config', { config }); },
    importPreview: async (json) => {
      try {
        const next = JSON.parse(json) as AppConfig;
        const errors = next?.schemaVersion !== 1 || !Array.isArray(next.groups) || !Array.isArray(next.services) ? ['文件不是有效的 Avenil 配置'] : [];
        const oldGroupIds = new Set(config.groups.map((group) => group.id));
        const oldServiceIds = new Set(config.services.map((service) => service.id));
        const newGroupIds = new Set((next?.groups ?? []).map((group) => group.id));
        const newServiceIds = new Set((next?.services ?? []).map((service) => service.id));
        const addedGroups = [...newGroupIds].filter((id) => !oldGroupIds.has(id)).length;
        const addedServices = [...newServiceIds].filter((id) => !oldServiceIds.has(id)).length;
        const removedGroups = [...oldGroupIds].filter((id) => !newGroupIds.has(id)).length;
        const removedServices = [...oldServiceIds].filter((id) => !newServiceIds.has(id)).length;
        return { schemaVersion: next?.schemaVersion ?? 0, groupCount: next?.groups?.length ?? 0, serviceCount: next?.services?.length ?? 0, errors, warnings: [], changes: { addedGroups, removedGroups, addedServices, removedServices }, canApply: errors.length === 0 };
      } catch { return { schemaVersion: 0, groupCount: 0, serviceCount: 0, errors: ['JSON 解析失败'], warnings: [], changes: { addedGroups: 0, removedGroups: 0, addedServices: 0, removedServices: 0 }, canApply: false }; }
    },
    importApply: async (json) => { config = JSON.parse(json) as AppConfig; emit('config', { config }); return clone(config); },
    chooseProjectDirectory: async () => '/workspace/demo-project',
    ideImportPreview: async (input) => {
      const projectRoot = input.projectRoot.trim();
      if (!projectRoot) throw new Error('请先选择项目根目录');
      const groupName = projectRoot.split('/').filter(Boolean).pop() || 'IDE 导入项目';
      const service = (id: string, name: string, command: string): Service => ({ id, name, groupId: null, workdir: projectRoot, command, shell: { program: '/bin/zsh', args: ['-lc'] }, env: [{ key: 'NODE_ENV', value: 'development' }], port: null, url: null, log: { maxBytes: 2 * 1024 * 1024, rotateCount: 3, maxMemoryBytes: 256 * 1024 } });
      return {
        snapshotId: `preview-${Date.now()}`,
        projectRoot,
        sources: [{ path: `${projectRoot}/.vscode/launch.json`, kind: 'vscode' }],
        suggestedGroupName: groupName,
        candidates: [
          { id: 'ide-demo-web', name: `${groupName} Web`, status: 'ready', service: service('ide-demo-web', `${groupName} Web`, 'pnpm dev:web'), warnings: [], missing: [] },
          { id: 'ide-demo-server', name: `${groupName} Server`, status: 'ready', service: service('ide-demo-server', `${groupName} Server`, 'pnpm dev:server'), warnings: [], missing: [] },
          { id: 'ide-demo-debug', name: '调试配置 · Node', status: 'unsupported', service: null, warnings: ['调试配置不属于普通运行配置，Avenil 不提供断点调试。'], missing: [] },
          { id: 'ide-demo-missing', name: '未命名运行配置', status: 'needsInput', service: null, warnings: ['配置缺少可执行命令，无法安全导入。'], missing: ['command'] },
        ],
        warnings: ['演示数据：浏览器预览不会读取本机文件；实际 Tauri 会从项目根目录自动查找 IDE 配置。', '仅导入普通运行配置，不提供调试；不能转换的项不会自动导入。'],
      };
    },
    ideImportApply: async (preview, selectedIds, groupName) => {
      const selected = preview.candidates.filter((candidate) => selectedIds.includes(candidate.id) && candidate.status === 'ready' && candidate.service);
      const group = config.groups.find((item) => item.name === groupName) ?? { id: `group-${Date.now()}`, name: groupName, sortOrder: config.groups.length };
      const services = selected.map((candidate) => ({ ...candidate.service!, groupId: group.id }));
      config = { ...config, groups: config.groups.some((item) => item.id === group.id) ? config.groups : [...config.groups, group], services: [...config.services, ...services] };
      services.forEach((service) => runtimes.set(service.id, emptyRuntime(service.id)));
      emit('config', { config: clone(config) });
      return clone(config);
    },
    exportConfig: async () => ({ json: JSON.stringify(config, null, 2), notice: '配置已导出，环境变量值按当前配置保留。' }),
    cliInstallInfo: async () => mockCliInfo(),
    installCli: async () => { cliInstalled = true; return mockCliInfo(); },
    upsertGroup: async (group) => { config.groups = [...config.groups.filter((item) => item.id !== group.id), group]; emit('config', { config: clone(config) }); return group; },
    deleteGroup: async (groupId) => { config.groups = config.groups.filter((item) => item.id !== groupId); emit('config', { config: clone(config) }); },
    upsertService: async (service) => { config.services = [...config.services.filter((item) => item.id !== service.id), service]; if (!runtimes.has(service.id)) runtimes.set(service.id, emptyRuntime(service.id)); emit('config', { config: clone(config) }); return service; },
    deleteService: async (serviceId) => { config.services = config.services.filter((item) => item.id !== serviceId); runtimes.delete(serviceId); resources.delete(serviceId); logs.delete(serviceId); emit('config', { config: clone(config) }); },
    start: async (serviceId) => { updateRuntime(serviceId, 'starting'); await delay(500); return updateRuntime(serviceId, 'running'); },
    stop: async (serviceId) => { updateRuntime(serviceId, 'stopping'); await delay(320); return updateRuntime(serviceId, 'stopped'); },
    restart: async (serviceId) => { updateRuntime(serviceId, 'stopping'); await delay(220); updateRuntime(serviceId, 'starting'); await delay(420); return updateRuntime(serviceId, 'running'); },
    batch: async (serviceIds, action) => Promise.all(serviceIds.map(async (serviceId) => { try { const snapshot = action === 'start' ? await (async () => { updateRuntime(serviceId, 'starting'); await delay(240); return updateRuntime(serviceId, 'running'); })() : action === 'stop' ? await (async () => { updateRuntime(serviceId, 'stopping'); await delay(240); return updateRuntime(serviceId, 'stopped'); })() : await (async () => { updateRuntime(serviceId, 'stopping'); await delay(150); updateRuntime(serviceId, 'starting'); await delay(300); return updateRuntime(serviceId, 'running'); })(); return { serviceId, action, accepted: true, snapshot, error: null }; } catch (error) { return { serviceId, action, accepted: false, snapshot: null, error: String(error) }; } })),
    runtime: async (serviceIds) => [...runtimes.values()].filter((item) => !serviceIds || serviceIds.includes(item.serviceId)).map(clone),
    resources: async (serviceIds) => [...resources.values()].filter((item) => !serviceIds || serviceIds.includes(item.serviceId)).map(clone),
    logs: async (serviceId) => clone(logs.get(serviceId) ?? { serviceId, generation: null, chunks: [], nextSeq: 1, truncated: false, droppedChunks: 0 }),
    openUrl: async (serviceId) => { const service = config.services.find((item) => item.id === serviceId); if (service?.url) window.open(service.url, '_blank', 'noopener,noreferrer'); },
    quitRequestPending: async () => false,
    cancelQuitRequest: async () => {},
    quit: async () => {},
    on: async (event, callback) => { const set = callbacks.get(event) ?? new Set(); set.add(callback); callbacks.set(event, set); return () => set.delete(callback); },
  };
}

export function getApi(): AvenilApi {
  if (previewMode) return mockApi();
  return tauriApi;
}
