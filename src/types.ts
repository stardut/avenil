export type Id = string;

export type Group = {
  id: Id;
  name: string;
  sortOrder: number;
};

export type EnvVar = {
  key: string;
  value: string;
};

export type LogPolicy = {
  maxBytes: number;
  rotateCount: number;
  maxMemoryBytes: number;
};

export type ShellSpec = {
  program: string;
  args: string[];
};

export type Service = {
  id: Id;
  name: string;
  groupId: Id | null;
  workdir: string;
  command: string;
  shell: ShellSpec;
  env: EnvVar[];
  port: number | null;
  url: string | null;
  log: LogPolicy;
};

export type AppConfig = {
  schemaVersion: 1;
  groups: Group[];
  services: Service[];
};

export type ServiceStatus =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'exited'
  | 'failed'
  | 'unknown';

export type RuntimeSnapshot = {
  serviceId: Id;
  generation: string | null;
  status: ServiceStatus;
  pid: number | null;
  pgid: number | null;
  startedAt: string | null;
  endedAt: string | null;
  exitCode: number | null;
  signal: number | null;
  error: string | null;
};

export type ResourceSnapshot = {
  serviceId: Id;
  generation: string | null;
  capturedAt: string;
  processCount: number;
  cpuPercent: number | null;
  rssBytes: number | null;
};

export type LogChunk = {
  serviceId: Id;
  generation: string | null;
  seq: number;
  stream: 'stdout' | 'stderr' | 'system';
  timestamp: string;
  text: string;
};

export type LogPage = {
  serviceId: Id;
  generation: string | null;
  chunks: LogChunk[];
  nextSeq: number;
  truncated: boolean;
  droppedChunks: number;
};

export type ImportPreview = {
  schemaVersion: number;
  groupCount: number;
  serviceCount: number;
  errors: string[];
  warnings: string[];
  changes: {
    addedGroups: number;
    removedGroups: number;
    addedServices: number;
    removedServices: number;
  };
  canApply: boolean;
};

export type IdeImportInput = {
  projectRoot: string;
};

export type IdeImportSource = {
  path: string;
  kind: 'vscode' | 'jetbrains';
};

export type CandidateStatus = 'ready' | 'needsInput' | 'unsupported';

export type Candidate = {
  id: Id;
  name: string;
  status: CandidateStatus;
  service: Service | null;
  warnings: string[];
  missing: string[];
};

export type IdeImportPreview = {
  snapshotId: string;
  projectRoot: string;
  sources: IdeImportSource[];
  suggestedGroupName: string;
  candidates: Candidate[];
  warnings: string[];
};

export type BatchAction = 'start' | 'stop' | 'restart';

export type BatchActionResult = {
  serviceId: Id;
  action: BatchAction;
  accepted: boolean;
  snapshot: RuntimeSnapshot | null;
  error: string | null;
};

export type ExportResult = {
  json: string;
  notice: string;
};

export type ShutdownState = { phase: 'stopping' | 'completed' | 'forced'; error?: string };

export type CliInstallInfo = {
  supported: boolean;
  installed: boolean;
  pathConfigured: boolean;
  linkPath: string;
  executablePath: string;
  installCommand: string;
  pathCommand: string;
  reloadCommand: string;
  conflict: string | null;
};

export const DEFAULT_LOG_POLICY: LogPolicy = {
  maxBytes: 2 * 1024 * 1024,
  rotateCount: 3,
  maxMemoryBytes: 4 * 1024 * 1024,
};

export function emptyRuntime(serviceId: Id): RuntimeSnapshot {
  return {
    serviceId,
    generation: null,
    status: 'stopped',
    pid: null,
    pgid: null,
    startedAt: null,
    endedAt: null,
    exitCode: null,
    signal: null,
    error: null,
  };
}

export function createService(groupId: Id | null = null): Service {
  return {
    id: crypto.randomUUID(),
    name: '',
    groupId,
    workdir: '',
    command: '',
    shell: { program: '/bin/zsh', args: ['-lc'] },
    env: [],
    port: null,
    url: null,
    log: { ...DEFAULT_LOG_POLICY },
  };
}
