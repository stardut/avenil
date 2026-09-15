import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  Activity,
  AlertCircle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  FileJson,
  FolderOpen,
  Gauge,
  Globe2,
  Info,
  Layers3,
  LayoutList,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings,
  Square,
  TerminalSquare,
  Trash2,
  X,
} from 'lucide-react';
import { getApi, inTauri, previewMode } from './api';
import IdeImportDialog from './IdeImportDialog';
import WorkspaceTransferMenu from './WorkspaceTransferMenu';
import ThemeControl, { useTheme } from './ThemeControl';
import BrandMark from './components/BrandMark';
import { useDialogFocus } from './useDialogFocus';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from './components/ui/select';
import { Button } from './components/ui/button';
import { Tooltip } from './components/ui/tooltip';
import { EASE_OUT, SPRING_PANEL } from './lib/ease';
import {
  AppConfig,
  BatchAction,
  EnvVar,
  Group,
  ImportPreview,
  IdeImportInput,
  IdeImportPreview,
  LogChunk,
  ResourceSnapshot,
  RuntimeSnapshot,
  Service,
  ServiceStatus,
  ShutdownState,
  createService,
  emptyRuntime,
} from './types';
import './styles.css';

const api = getApi();

type Filter = 'all' | 'running' | 'stopped';
type PanelTab = 'config' | 'logs' | 'metrics';

const statusMeta: Record<ServiceStatus, { label: string; tone: string; icon: string }> = {
  stopped: { label: '已停止', tone: 'muted', icon: '○' },
  starting: { label: '启动中', tone: 'amber', icon: '◌' },
  running: { label: '运行中', tone: 'green', icon: '●' },
  stopping: { label: '停止中', tone: 'amber', icon: '◌' },
  exited: { label: '已退出', tone: 'muted', icon: '○' },
  failed: { label: '启动失败', tone: 'red', icon: '×' },
  unknown: { label: '状态未知', tone: 'violet', icon: '?' },
};

const runtimeIsActive = (status: ServiceStatus) => ['starting', 'running', 'stopping'].includes(status);
const runtimeIsTransitioning = (status: ServiceStatus) => ['starting', 'stopping'].includes(status);
const runtimeIsRunning = (status: ServiceStatus) => status === 'running';
const runtimeCanStop = (status: ServiceStatus) => status === 'starting' || status === 'running';
const formatBytes = (bytes: number | null) => {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};
const formatTime = (value: string | null | undefined) => value ? new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
const formatCommand = (value: string) => value.length > 52 ? `${value.slice(0, 52)}…` : value;
const uid = () => crypto.randomUUID();
const isFocusableElement = (element: HTMLElement | null) => Boolean(element?.isConnected && element.getClientRects().length);

const FADE_TRANSITION = { duration: 0.18, ease: EASE_OUT } as const;

const MODAL_BACKDROP_VARIANTS = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0, pointerEvents: 'none' as const },
};

const MODAL_VARIANTS = {
  initial: { opacity: 0, y: 12, scale: 0.98, filter: 'blur(4px)' },
  animate: { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' },
  exit: { opacity: 0, y: 7, scale: 0.985, filter: 'blur(3px)' },
};

const DETAILS_VARIANTS = {
  initial: { opacity: 0, height: 0, y: -6 },
  animate: { opacity: 1, height: 'auto', y: 0 },
  exit: { opacity: 0, height: 0, y: -4 },
};

const TOAST_VARIANTS = {
  initial: { opacity: 0, x: 24, y: 8, scale: 0.96, filter: 'blur(4px)' },
  animate: { opacity: 1, x: 0, y: 0, scale: 1, filter: 'blur(0px)' },
  exit: { opacity: 0, x: 16, y: 4, scale: 0.98, filter: 'blur(3px)' },
};

function App() {
  const reduceMotion = useReducedMotion();
  const presenceTransition = reduceMotion ? { duration: 0.01 } : SPRING_PANEL;
  const [config, setConfig] = useState<AppConfig>({ schemaVersion: 1, groups: [], services: [] });
  const [runtimes, setRuntimes] = useState<Record<string, RuntimeSnapshot>>({});
  const [resources, setResources] = useState<Record<string, ResourceSnapshot>>({});
  const [logs, setLogs] = useState<Record<string, LogChunk[]>>({});
  const [logMeta, setLogMeta] = useState<Record<string, { truncated: boolean; droppedChunks: number }>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>('logs');
  const [editor, setEditor] = useState<{ service: Service; isNew: boolean } | null>(null);
  const [groupEditor, setGroupEditor] = useState<Group | null>(null);
  const [importDialog, setImportDialog] = useState<{ json: string; preview: ImportPreview } | null>(null);
  const [ideImportOpen, setIdeImportOpen] = useState(false);
  const [ideImportPreview, setIdeImportPreview] = useState<IdeImportPreview | null>(null);
  const [ideImportBusy, setIdeImportBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone?: 'error' | 'success' | 'info' } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [desktopUnavailable, setDesktopUnavailable] = useState(false);
  const [actionIds, setActionIds] = useState<string[]>([]);
  const [shutdownState, setShutdownState] = useState<ShutdownState | null>(null);
  const [serviceSubmitBusy, setServiceSubmitBusy] = useState(false);
  const [groupSubmitBusy, setGroupSubmitBusy] = useState(false);
  const [importApplyBusy, setImportApplyBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const detailsFocusReturnRef = useRef<HTMLElement | null>(null);
  const pendingDetailsFocusRef = useRef<HTMLElement | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const serviceSubmitRef = useRef(false);
  const groupSubmitRef = useRef(false);
  const importApplyRef = useRef(false);
  const notify = useCallback((message: string, tone: 'error' | 'success' | 'info' = 'info') => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToast({ message, tone });
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 3600);
  }, []);

  const theme = useTheme(notify);

  const toggleDetails = useCallback((serviceId: string, trigger?: HTMLElement) => {
    detailsFocusReturnRef.current = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    if (expandedId === serviceId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(serviceId);
    setPanelTab('logs');
  }, [expandedId]);

  const closeDetails = useCallback(() => {
    if (!expandedId) return;
    setExpandedId(null);
  }, [expandedId]);

  const handleDetailsExitComplete = useCallback(() => {
    if (expandedId) return;
    const trigger = detailsFocusReturnRef.current;
    detailsFocusReturnRef.current = null;
    const fallback = Array.from(document.querySelectorAll<HTMLElement>('[data-service-trigger]')).find(isFocusableElement)
      ?? document.querySelector<HTMLElement>('.service-list');
    (isFocusableElement(trigger) ? trigger : fallback)?.focus();
  }, [expandedId]);

  useEffect(() => () => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
  }, []);

  const hydrate = useCallback(async () => {
    if (!previewMode && !inTauri) {
      setDesktopUnavailable(true);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const [nextConfig, nextRuntime, nextResources] = await Promise.all([api.loadConfig(), api.runtime(), api.resources()]);
      setConfig(nextConfig);
      setRuntimes(Object.fromEntries(nextRuntime.map((snapshot) => [snapshot.serviceId, snapshot])));
      setResources(Object.fromEntries(nextResources.map((snapshot) => [snapshot.serviceId, snapshot])));
      setError(null);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void hydrate(); }, [hydrate]);

  useEffect(() => {
    if (!previewMode && !inTauri) return;
    let disposed = false;
    const subscriptions: Promise<() => void>[] = [
      api.on('runtime', (snapshot: RuntimeSnapshot) => {
        if (disposed) return;
        setRuntimes((current) => ({ ...current, [snapshot.serviceId]: snapshot }));
      }),
      api.on('resource', (snapshot: ResourceSnapshot) => {
        if (disposed) return;
        setResources((current) => ({ ...current, [snapshot.serviceId]: snapshot }));
      }),
      api.on('log', (chunk: LogChunk) => {
        if (disposed) return;
        setLogs((current) => ({ ...current, [chunk.serviceId]: [...(current[chunk.serviceId] ?? []), chunk].slice(-500) }));
      }),
      api.on('config', ({ config: nextConfig }: { config: AppConfig }) => {
        if (!disposed) setConfig(nextConfig);
      }),
      api.on('shutdown', (payload: ShutdownState) => {
        if (disposed) return;
        if (payload.phase === 'stopping') {
          setShutdownState(payload);
          notify('正在停止 Avenil 托管服务…', 'info');
        } else if (payload.phase === 'forced') {
          setShutdownState(null);
          notify(payload.error || '退出时有服务未能停止，Avenil 仍保持运行', 'error');
        } else {
          setShutdownState(null);
        }
      }),
    ];
    return () => { disposed = true; subscriptions.forEach((subscription) => subscription.then((unlisten) => unlisten())); };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (settingsOpen) {
        if (event.key === 'Escape') setSettingsOpen(false);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        setEditor({ service: createService(selectedGroupId), isNew: true });
        return;
      }
      if (event.key === 'Escape') {
        if (editor) { if (!serviceSubmitBusy) setEditor(null); return; }
        if (groupEditor) { if (!groupSubmitBusy) setGroupEditor(null); return; }
        if (importDialog) { if (!importApplyBusy) setImportDialog(null); return; }
        if (ideImportOpen) { if (!ideImportBusy) { setIdeImportPreview(null); setIdeImportOpen(false); } return; }
        if (expandedId) closeDetails();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [settingsOpen, closeDetails, editor, expandedId, groupEditor, ideImportBusy, ideImportOpen, importApplyBusy, importDialog, groupSubmitBusy, selectedGroupId, serviceSubmitBusy]);

  const groups = useMemo(() => [...config.groups].sort((a, b) => a.sortOrder - b.sortOrder), [config.groups]);

  const servicesByGroup = useMemo(() => {
    const result = new Map<string | null, Service[]>();
    config.services.forEach((service) => result.set(service.groupId, [...(result.get(service.groupId) ?? []), service]));
    return result;
  }, [config.services]);

  const visibleServices = useMemo(() => config.services.filter((service) => {
    const snapshot = runtimes[service.id] ?? emptyRuntime(service.id);
    const matchesGroup = selectedGroupId === null || service.groupId === selectedGroupId;
    const matchesFilter = filter === 'all' || (filter === 'running' && snapshot.status === 'running') || (filter === 'stopped' && ['stopped', 'exited'].includes(snapshot.status));
    return matchesGroup && matchesFilter;
  }), [config.services, filter, runtimes, selectedGroupId]);

  useEffect(() => {
    if (!expandedId || visibleServices.some((service) => service.id === expandedId)) return;
    setExpandedId(null);
    detailsFocusReturnRef.current = null;
  }, [expandedId, visibleServices]);

  useEffect(() => {
    const target = pendingDetailsFocusRef.current;
    if (!target) return;
    pendingDetailsFocusRef.current = null;
    if (isFocusableElement(target)) {
      target.focus();
      return;
    }
    document.querySelector<HTMLElement>('.service-list')?.focus();
  }, [config.services]);

  const counts = useMemo(() => config.services.reduce((result, service) => {
    const status = runtimes[service.id]?.status ?? 'stopped';
    if (status === 'running') result.running += 1;
    if (['stopped', 'exited'].includes(status)) result.stopped += 1;
    return result;
  }, { running: 0, stopped: 0 }), [config.services, runtimes]);

  const selectedGroup = selectedGroupId ? groups.find((group) => group.id === selectedGroupId) ?? null : null;
  const groupServices = selectedGroupId ? (servicesByGroup.get(selectedGroupId) ?? []) : visibleServices;
  const groupActive = groupServices.some((service) => runtimeIsTransitioning((runtimes[service.id] ?? emptyRuntime(service.id)).status));
  const groupStopAvailable = groupServices.some((service) => runtimeCanStop((runtimes[service.id] ?? emptyRuntime(service.id)).status));
  const groupStopBusy = groupServices.some((service) => (runtimes[service.id] ?? emptyRuntime(service.id)).status === 'stopping' || actionIds.includes(service.id));
  const ideImportBlockedReason = ideImportBusy
    ? '正在处理 IDE 导入，请稍候。'
    : shutdownState?.phase === 'stopping'
      ? 'Avenil 正在停止托管服务，完成后才能添加导入配置。'
      : actionIds.length
        ? '当前有服务操作进行中，完成后才能添加导入配置。'
        : config.services.some((service) => runtimeIsActive((runtimes[service.id] ?? emptyRuntime(service.id)).status))
          ? '当前有服务正在运行或切换中，请停止全部服务后再添加导入配置。'
          : null;

  useEffect(() => {
    if (!expandedId) return;
    void api.logs(expandedId, undefined, 300).then((page) => {
      setLogs((current) => ({ ...current, [expandedId]: page.chunks }));
      setLogMeta((current) => ({ ...current, [expandedId]: { truncated: page.truncated, droppedChunks: page.droppedChunks } }));
    }).catch((reason) => notify(errorText(reason), 'error'));
  }, [expandedId, notify]);

  const handleRuntime = async (serviceId: string, action: BatchAction) => {
    if (shutdownState?.phase === 'stopping' && action !== 'stop') return;
    if (actionIds.includes(serviceId)) return;
    setActionIds((ids) => [...ids, serviceId]);
    try {
      const snapshot = action === 'start' ? await api.start(serviceId) : action === 'stop' ? await api.stop(serviceId) : await api.restart(serviceId);
      setRuntimes((current) => ({ ...current, [serviceId]: snapshot }));
      notify(action === 'start' ? '服务启动请求已发送' : action === 'stop' ? '服务已停止' : '服务重启请求已发送', 'success');
    } catch (reason) { notify(errorText(reason), 'error'); }
    finally { setActionIds((ids) => ids.filter((id) => id !== serviceId)); }
  };

  const handleBatch = async (action: BatchAction) => {
    if (shutdownState?.phase === 'stopping' && action !== 'stop') return;
    if (!selectedGroupId || (action === 'stop' ? groupStopBusy : groupActive)) return;
    const services = servicesByGroup.get(selectedGroupId) ?? [];
    if (!services.length) return notify('这个项目组还没有服务', 'info');
    const ids = services.map((service) => service.id);
    setActionIds(ids);
    try {
      const results = await api.batch(ids, action);
      setRuntimes((current) => Object.fromEntries([...Object.entries(current), ...results.filter((result) => result.snapshot).map((result) => [result.serviceId, result.snapshot!])]));
      const failures = results.filter((result) => !result.accepted).length;
      notify(failures ? `${results.length - failures} 个服务已处理，${failures} 个失败` : `已对 ${results.length} 个服务执行${action === 'start' ? '启动' : action === 'stop' ? '停止' : '重启'}`, failures ? 'error' : 'success');
    } catch (reason) { notify(errorText(reason), 'error'); }
    finally { setActionIds([]); }
  };

  const handleServiceSubmit = async (service: Service) => {
    if (serviceSubmitRef.current) return;
    if (!service.name.trim() || !service.workdir.trim() || !service.command.trim()) return notify('请填写服务名称、工作目录和启动命令', 'error');
    if (service.port !== null && (!Number.isInteger(service.port) || service.port < 1 || service.port > 65535)) return notify('端口必须是 1–65535 的整数', 'error');
    if (service.env.some((item, index) => !item.key.trim() || service.env.findIndex((candidate) => candidate.key === item.key) !== index)) return notify('环境变量键名不能为空且不能重复', 'error');
    serviceSubmitRef.current = true;
    setServiceSubmitBusy(true);
    try {
      const saved = await api.upsertService(service);
      setConfig((current) => ({ ...current, services: [...current.services.filter((item) => item.id !== saved.id), saved] }));
      setEditor(null);
      notify(editor?.isNew ? '服务已添加' : '服务配置已更新', 'success');
    } catch (reason) { notify(errorText(reason), 'error'); }
    finally { serviceSubmitRef.current = false; setServiceSubmitBusy(false); }
  };

  const handleDeleteService = async (service: Service) => {
    const snapshot = runtimes[service.id] ?? emptyRuntime(service.id);
    if (runtimeIsActive(snapshot.status)) return notify('请先停止服务，再删除配置', 'error');
    if (!window.confirm(`删除“${service.name}”的 Avenil 配置？不会删除项目文件。`)) return;
    try {
      await api.deleteService(service.id);
      const serviceIndex = visibleServices.findIndex((item) => item.id === service.id);
      const focusService = visibleServices[serviceIndex + 1] ?? visibleServices[serviceIndex - 1];
      const focusTarget = focusService
        ? Array.from(document.querySelectorAll<HTMLElement>('[data-service-trigger]')).find((element) => element.dataset.serviceTrigger === focusService.id) ?? null
        : null;
      pendingDetailsFocusRef.current = focusTarget ?? document.querySelector<HTMLElement>('.service-list');
      detailsFocusReturnRef.current = null;
      setConfig((current) => ({ ...current, services: current.services.filter((item) => item.id !== service.id) }));
      closeDetails();
      notify('服务配置已删除', 'success');
    } catch (reason) { notify(errorText(reason), 'error'); }
  };

  const handleGroupSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (groupSubmitRef.current) return;
    const data = new FormData(event.currentTarget);
    const name = String(data.get('name') ?? '').trim();
    if (!name) return notify('请输入项目组名称', 'error');
    const isEditing = Boolean(groupEditor?.id);
    const group = isEditing && groupEditor ? { ...groupEditor, name } : { id: uid(), name, sortOrder: groups.length };
    groupSubmitRef.current = true;
    setGroupSubmitBusy(true);
    try { await api.upsertGroup(group); setConfig((current) => ({ ...current, groups: [...current.groups.filter((item) => item.id !== group.id), group] })); setGroupEditor(null); notify(isEditing ? '项目组已更新' : '项目组已创建', 'success'); } catch (reason) { notify(errorText(reason), 'error'); }
    finally { groupSubmitRef.current = false; setGroupSubmitBusy(false); }
  };

  const handleDeleteGroup = async (group: Group) => {
    const services = servicesByGroup.get(group.id) ?? [];
    if (services.some((service) => runtimeIsActive((runtimes[service.id] ?? emptyRuntime(service.id)).status))) return notify('请先停止项目组内的服务', 'error');
    if (services.length) return notify('项目组仍有服务，请先将服务移出或删除', 'error');
    try { await api.deleteGroup(group.id); setConfig((current) => ({ ...current, groups: current.groups.filter((item) => item.id !== group.id) })); setSelectedGroupId(null); setGroupEditor(null); notify('项目组已删除', 'success'); } catch (reason) { notify(errorText(reason), 'error'); }
  };

  const handleExport = async () => {
    try {
      const result = await api.exportConfig();
      const blob = new Blob([result.json], { type: 'application/json;charset=utf-8' });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = href; anchor.download = 'avenil-config.json'; anchor.click(); URL.revokeObjectURL(href);
      notify(result.notice, 'info');
    } catch (reason) { notify(errorText(reason), 'error'); }
  };

  const handleFile = async (file: File) => {
    try { const json = await file.text(); const preview = await api.importPreview(json); setImportDialog({ json, preview }); } catch (reason) { notify(errorText(reason), 'error'); }
  };

  const handleImportApply = async () => {
    if (importApplyRef.current) return;
    if (!importDialog?.preview.canApply || groupActive || config.services.some((service) => runtimeIsActive((runtimes[service.id] ?? emptyRuntime(service.id)).status))) return;
    importApplyRef.current = true;
    setImportApplyBusy(true);
    try { const next = await api.importApply(importDialog.json); setConfig(next); setImportDialog(null); closeDetails(); notify('配置已整份替换', 'success'); } catch (reason) { notify(errorText(reason), 'error'); }
    finally { importApplyRef.current = false; setImportApplyBusy(false); }
  };

  const handleIdeImportPreview = async (input: IdeImportInput) => {
    if (ideImportBusy) return;
    setIdeImportBusy(true);
    try { setIdeImportPreview(await api.ideImportPreview(input)); } catch (reason) { notify(errorText(reason), 'error'); }
    finally { setIdeImportBusy(false); }
  };

  const handleChooseIdeProjectDirectory = async () => {
    try { return await api.chooseProjectDirectory(); } catch (reason) { notify(errorText(reason), 'error'); return null; }
  };

  const handleIdeImportApply = async (preview: IdeImportPreview, selectedIds: string[], groupName: string) => {
    if (ideImportBlockedReason || ideImportBusy || !selectedIds.length || !groupName.trim()) return;
    setIdeImportBusy(true);
    try {
      const next = await api.ideImportApply(preview, selectedIds, groupName.trim());
      setConfig(next);
      setIdeImportPreview(null);
      setIdeImportOpen(false);
      closeDetails();
      notify(`已添加 ${selectedIds.length} 个服务到项目组“${groupName.trim()}”`, 'success');
    } catch (reason) { notify(errorText(reason), 'error'); }
    finally { setIdeImportBusy(false); }
  };

  if (desktopUnavailable) return <DesktopPrompt />;
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><BrandMark /><div><strong>Avenil</strong><span>A quiet place for things to run.</span></div></div>
        <div className="topbar-actions">
          {previewMode && <span className="demo-pill"><span className="demo-dot" />演示数据</span>}
        </div>
      </header>
      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-heading"><span>工作区</span></div>
          <nav className="nav-list" aria-label="服务筛选">
            <NavItem icon={<LayoutList size={16} />} label="全部服务" count={config.services.length} active={selectedGroupId === null && filter === 'all'} onClick={() => { setSelectedGroupId(null); setFilter('all'); }} />
            <NavItem icon={<Activity size={16} />} label="运行中" count={counts.running} active={filter === 'running' && selectedGroupId === null} onClick={() => { setSelectedGroupId(null); setFilter('running'); }} />
            <NavItem icon={<Square size={14} />} label="已停止" count={counts.stopped} active={filter === 'stopped' && selectedGroupId === null} onClick={() => { setSelectedGroupId(null); setFilter('stopped'); }} />
          </nav>
          <div className="sidebar-heading groups-heading"><span>项目组</span><Button variant="ghost" size="icon" className="mini-button" aria-label="新建项目组" onClick={() => setGroupEditor({ id: '', name: '', sortOrder: groups.length })}><Plus size={15} /></Button></div>
          <nav className="group-list" aria-label="项目组">
            {groups.map((group) => <GroupNav key={group.id} group={group} services={servicesByGroup.get(group.id) ?? []} runtimes={runtimes} selected={selectedGroupId === group.id} onSelect={() => { setSelectedGroupId(group.id); setFilter('all'); }} onEdit={() => setGroupEditor(group)} />)}
            {!groups.length && <div className="sidebar-empty">创建项目组，整理跨仓库服务</div>}
          </nav>
          <div className="sidebar-footer">
            <nav className="workspace-actions" aria-label="工作区操作">
              <Button variant="primary" size="sm" className="sidebar-add-service" onClick={() => setEditor({ service: createService(selectedGroupId), isNew: true })}><Plus size={16} />添加服务</Button>
              <WorkspaceTransferMenu
                onIdeImport={() => { setIdeImportPreview(null); setIdeImportBusy(false); setIdeImportOpen(true); }}
                onImportConfig={() => { setImportDialog(null); fileInputRef.current?.click(); }}
                onExportConfig={() => void handleExport()}
              />
            </nav>
            <input ref={fileInputRef} type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleFile(file); event.currentTarget.value = ''; }} />
            <div className="sidebar-settings"><Button variant="ghost" size="sm" className="sidebar-action settings-button" type="button" aria-haspopup="dialog" onClick={() => setSettingsOpen(true)}><Settings size={16} /><span>设置</span></Button></div>
          </div>
        </aside>

        <main className="main-content">
          <div className="content-head">
            <h1 title={selectedGroup?.name ?? '全部服务'}>{selectedGroup?.name ?? '全部服务'}</h1>
            {selectedGroup && <div className="group-actions"><Button variant="ghost" size="sm" className="group-action" disabled={groupActive || !groupServices.length || shutdownState?.phase === 'stopping'} onClick={() => void handleBatch('start')}><Play size={14} />启动全部</Button><Button variant="ghost" size="sm" className="group-action" disabled={groupActive || !groupServices.length || shutdownState?.phase === 'stopping'} onClick={() => void handleBatch('restart')}><RefreshCw size={14} />重启全部</Button><Button variant="ghost" size="sm" className="group-action danger-text" disabled={!groupStopAvailable || groupStopBusy} onClick={() => void handleBatch('stop')}><Square size={13} />停止全部</Button></div>}
          </div>
          {shutdownState?.phase === 'stopping' && <div className="shutdown-strip"><LoaderCircle size={14} className="spin" /><span>正在停止托管服务，暂时不能启动或重启服务。</span></div>}
          <div className="filterbar"><div className="filter-tabs"><FilterTab label="全部" active={filter === 'all'} onClick={() => setFilter('all')} /><FilterTab label="运行中" active={filter === 'running'} onClick={() => setFilter('running')} /><FilterTab label="已停止" active={filter === 'stopped'} onClick={() => setFilter('stopped')} /></div><span className="list-count">{visibleServices.length} 个结果</span></div>
          <div className="service-list" tabIndex={-1}>
            {loading ? <LoadingState /> : !visibleServices.length ? <EmptyState hasConfig={config.services.length > 0} onAdd={() => setEditor({ service: createService(selectedGroupId), isNew: true })} onClear={() => { setFilter('all'); setSelectedGroupId(null); }} /> : visibleServices.map((service) => <ServiceRow key={service.id} service={service} group={groups.find((group) => group.id === service.groupId)} runtime={runtimes[service.id] ?? emptyRuntime(service.id)} resource={resources[service.id]} expanded={expandedId === service.id} logs={logs[service.id] ?? []} logMeta={logMeta[service.id]} busy={actionIds.includes(service.id)} shutdownBusy={shutdownState?.phase === 'stopping'} onSelect={(trigger) => toggleDetails(service.id, trigger)} onDetailsExitComplete={handleDetailsExitComplete} onClose={closeDetails} onAction={(action) => void handleRuntime(service.id, action)} onEdit={() => setEditor({ service, isNew: false })} onDelete={() => void handleDeleteService(service)} onOpenUrl={() => void api.openUrl(service.id)} setTab={setPanelTab} tab={panelTab} />)}
          </div>
          {error && <div className="error-strip"><AlertCircle size={16} /><span>{error}</span><Button variant="ghost" size="sm" className="error-retry" onClick={() => void hydrate()}>重试</Button></div>}
        </main>

      </div>

      <AnimatePresence initial={false}>
        {settingsOpen && <Modal key="settings" title="设置" subtitle="调整 Avenil 的外观" onClose={() => setSettingsOpen(false)}>
          <div className="settings-content">
            <ThemeControl mode={theme.mode} onChange={theme.changeMode} />
          </div>
        </Modal>}
        {editor && <ServiceEditor key="editor" initial={editor.service} isNew={editor.isNew} groups={groups} busy={serviceSubmitBusy} onCancel={() => setEditor(null)} onSubmit={(service) => void handleServiceSubmit(service)} />}
        {groupEditor && <GroupEditor key="group" initial={groupEditor.id ? groupEditor : null} busy={groupSubmitBusy} onCancel={() => setGroupEditor(null)} onDelete={groupEditor.id ? () => void handleDeleteGroup(groupEditor) : undefined} onSubmit={handleGroupSubmit} />}
        {importDialog && <ImportDialog key="import" preview={importDialog.preview} busy={importApplyBusy} canApply={importDialog.preview.canApply && !config.services.some((service) => runtimeIsActive((runtimes[service.id] ?? emptyRuntime(service.id)).status))} onCancel={() => setImportDialog(null)} onApply={() => void handleImportApply()} />}
        {ideImportOpen && <IdeImportDialog key="ide" preview={ideImportPreview} busy={ideImportBusy} blockedReason={ideImportBlockedReason} onChooseProjectDirectory={handleChooseIdeProjectDirectory} onPreview={(input) => void handleIdeImportPreview(input)} onApply={(preview, selectedIds, groupName) => void handleIdeImportApply(preview, selectedIds, groupName)} onClearPreview={() => setIdeImportPreview(null)} onClose={() => { if (!ideImportBusy) { setIdeImportPreview(null); setIdeImportOpen(false); } }} />}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {toast && <motion.div key={`${toast.tone ?? 'info'}-${toast.message}`} className={`toast ${toast.tone ?? 'info'}`} role="status" initial="initial" animate="animate" exit="exit" variants={TOAST_VARIANTS} transition={presenceTransition}><span className="toast-icon">{toast.tone === 'error' ? <AlertCircle size={15} /> : toast.tone === 'success' ? <Check size={15} /> : <Info size={15} />}</span>{toast.message}</motion.div>}
      </AnimatePresence>
    </div>
  );
}

function NavItem({ icon, label, count, active, onClick, tone }: { icon: React.ReactNode; label: string; count: number; active: boolean; onClick: () => void; tone?: string }) {
  return <Button variant="ghost" size="md" className={`nav-item ${active ? 'active' : ''}`} type="button" aria-pressed={active} onClick={onClick}>{icon}<span>{label}</span><em className={tone}>{count}</em></Button>;
}

function GroupNav({ group, services, runtimes, selected, onSelect, onEdit }: { group: Group; services: Service[]; runtimes: Record<string, RuntimeSnapshot>; selected: boolean; onSelect: () => void; onEdit: () => void }) {
  const running = services.filter((service) => runtimeIsRunning((runtimes[service.id] ?? emptyRuntime(service.id)).status)).length;
  const hasIssue = services.some((service) => ['failed', 'unknown', 'exited'].includes((runtimes[service.id] ?? emptyRuntime(service.id)).status));
  return <div className={`group-nav ${selected ? 'selected' : ''}`}><Button variant="ghost" size="md" className="group-nav-main" type="button" aria-pressed={selected} onClick={onSelect}><span className={`group-icon ${hasIssue ? 'has-issue' : ''}`}><Box size={14} /></span><span className="truncate">{group.name}</span><span className="group-count">{running}/{services.length}</span></Button><Button variant="ghost" size="icon" className="group-edit" type="button" onClick={onEdit} aria-label={`编辑${group.name}`}><MoreHorizontal size={15} /></Button></div>;
}

function FilterTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) { return <Button variant="ghost" size="sm" className={`filter-tab ${active ? 'active' : ''}`} type="button" aria-pressed={active} onClick={onClick}>{label}</Button>; }

function ServiceRow({ service, group, runtime, resource, expanded, logs, logMeta, busy, shutdownBusy, onSelect, onDetailsExitComplete, onClose, onAction, onEdit, onDelete, onOpenUrl, tab, setTab }: { service: Service; group?: Group; runtime: RuntimeSnapshot; resource?: ResourceSnapshot; expanded: boolean; logs: LogChunk[]; logMeta?: { truncated: boolean; droppedChunks: number }; busy: boolean; shutdownBusy: boolean; onSelect: (trigger?: HTMLElement) => void; onDetailsExitComplete: () => void; onClose: () => void; onAction: (action: BatchAction) => void; onEdit: () => void; onDelete: () => void; onOpenUrl: () => void; tab: PanelTab; setTab: (tab: PanelTab) => void }) {
  const meta = statusMeta[runtime.status];
  const running = runtimeIsRunning(runtime.status);
  const pending = runtimeIsTransitioning(runtime.status);
  return <article className={`service-row ${expanded ? 'selected' : ''}`} data-service-id={service.id}>
    <div className="service-row-main">
      <Button variant="ghost" size="md" className="service-row-trigger" data-service-trigger={service.id} aria-expanded={expanded} aria-controls={expanded ? `service-details-${service.id}` : undefined} whileHover={undefined} whileTap={undefined} onClick={(event) => onSelect(event.currentTarget)}>
        <div className="service-identity"><span className={`status-orb ${meta.tone}`} title={meta.label}>{pending ? <LoaderCircle size={15} className="spin" /> : meta.icon}</span><div className="service-name"><strong>{service.name || '未命名服务'}</strong><span>{group?.name ?? '未分组'}<i>·</i>{service.command ? formatCommand(service.command) : '未配置命令'}</span></div></div>
        <div className="service-runtime"><span className="runtime-label"><span className={`status-dot ${meta.tone}`} />{meta.label}</span>{service.port ? <span className="port-label"><TerminalSquare size={13} />{service.port}</span> : <span className="port-label muted-label">无端口检查</span>}</div>
        <div className="service-metrics">{running && resource ? <><span><Gauge size={13} />{resource.cpuPercent === null ? '—' : `${resource.cpuPercent.toFixed(1)}%`}</span><span><Activity size={13} />{formatBytes(resource.rssBytes)}</span></> : <span className="muted-label">{runtime.error ? '有错误' : '等待启动'}</span>}</div>
      </Button>
      <div className="row-actions" onClick={(event) => event.stopPropagation()}>
        <Tooltip content="编辑服务" side="top"><Button variant="ghost" size="icon" className="row-icon" aria-label="编辑服务" onClick={onEdit}><Pencil size={14} /></Button></Tooltip>
        {runtimeCanStop(runtime.status) ? <Button variant="ghost" size="sm" className="service-action stop" disabled={busy} onClick={() => onAction('stop')}><Square size={12} />停止</Button> : <Button variant="ghost" size="sm" className="service-action start" disabled={busy || pending || shutdownBusy} onClick={() => onAction('start')}>{busy || pending ? <LoaderCircle size={13} className="spin" /> : <Play size={12} />}启动</Button>}
        <Button variant="ghost" size="icon" className="row-icon more" aria-label={expanded ? '收起详情' : '展开详情'} aria-expanded={expanded} aria-controls={expanded ? `service-details-${service.id}` : undefined} onClick={(event) => onSelect(event.currentTarget)}><ChevronRight size={15} className={expanded ? 'expanded' : ''} /></Button>
      </div>
    </div>
    <AnimatePresence initial={false} onExitComplete={onDetailsExitComplete}>
      {expanded && <ServiceDetails key={service.id} id={`service-details-${service.id}`} service={service} runtime={runtime} resource={resource ?? null} tab={tab} setTab={setTab} logs={logs} logMeta={logMeta} shutdownBusy={shutdownBusy} onClose={onClose} onAction={onAction} onEdit={onEdit} onDelete={onDelete} onOpenUrl={onOpenUrl} />}
    </AnimatePresence>
  </article>;
}

function ServiceDetails({ id, service, runtime, resource, tab, setTab, logs, logMeta, shutdownBusy, onClose, onAction, onEdit, onDelete, onOpenUrl }: { id: string; service: Service; runtime: RuntimeSnapshot; resource: ResourceSnapshot | null; tab: PanelTab; setTab: (tab: PanelTab) => void; logs: LogChunk[]; logMeta?: { truncated: boolean; droppedChunks: number }; shutdownBusy: boolean; onClose: () => void; onAction: (action: BatchAction) => void; onEdit: () => void; onDelete: () => void; onOpenUrl: () => void }) {
  const meta = statusMeta[runtime.status];
  const statusDetail = runtime.error ?? (runtime.pid ? `PID ${runtime.pid}` : null);
  const logRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const panelTransition = reduceMotion ? { duration: 0.01 } : SPRING_PANEL;
  useEffect(() => { if (tab === 'logs' && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [logs, tab]);
  return <motion.div id={id} className="service-details" role="region" aria-label={`${service.name} 服务详情`} variants={DETAILS_VARIANTS} initial="initial" animate="animate" exit="exit" transition={panelTransition} onClick={(event) => event.stopPropagation()}>
    <div className="service-details-status"><span className={`status-orb ${meta.tone}`}>{meta.icon}</span><div className="service-details-status-copy"><strong>{meta.label}</strong>{statusDetail && <span title={statusDetail}>{statusDetail}</span>}{runtime.exitCode !== null && <small>退出码 {runtime.exitCode}</small>}</div><div className="service-details-controls">{runtimeCanStop(runtime.status) ? <Button variant="ghost" size="sm" className="service-details-action danger-text" disabled={shutdownBusy} onClick={() => onAction('stop')}><Square size={12} />停止</Button> : <Button variant="ghost" size="sm" className="service-details-action" disabled={runtimeIsActive(runtime.status) || shutdownBusy} onClick={() => void onAction('start')}><Play size={12} />启动</Button>}<Button variant="ghost" size="sm" className="service-details-action" disabled={runtimeIsTransitioning(runtime.status) || shutdownBusy} onClick={() => onAction('restart')}><RefreshCw size={12} />重启</Button><Button variant="ghost" size="icon" className="icon-button" onClick={onEdit} aria-label="编辑服务"><Pencil size={15} /></Button><Button variant="ghost" size="icon" className="icon-button danger-icon" onClick={onDelete} aria-label="删除服务"><Trash2 size={15} /></Button><Button variant="ghost" size="icon" className="icon-button" onClick={onClose} aria-label="收起详情"><X size={17} /></Button></div></div>
    <div className="service-details-tabs" role="tablist" aria-label="服务详情"><Button variant="ghost" size="sm" className={tab === 'logs' ? 'active' : ''} type="button" role="tab" id={`${id}-tab-logs`} aria-selected={tab === 'logs'} aria-controls={`${id}-panel`} onClick={() => setTab('logs')}>日志{logs.length ? <b>{logs.length > 99 ? '99+' : logs.length}</b> : null}</Button><Button variant="ghost" size="sm" className={tab === 'config' ? 'active' : ''} type="button" role="tab" id={`${id}-tab-config`} aria-selected={tab === 'config'} aria-controls={`${id}-panel`} onClick={() => setTab('config')}>配置</Button><Button variant="ghost" size="sm" className={tab === 'metrics' ? 'active' : ''} type="button" role="tab" id={`${id}-tab-metrics`} aria-selected={tab === 'metrics'} aria-controls={`${id}-panel`} onClick={() => setTab('metrics')}>指标</Button></div>
    <div className="service-details-body" id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${tab}`}>{tab === 'config' && <ConfigView service={service} onOpenUrl={onOpenUrl} />}{tab === 'logs' && <LogView logs={logs} meta={logMeta} containerRef={logRef} />}{tab === 'metrics' && <MetricsView runtime={runtime} resource={resource} />}</div>
  </motion.div>;
}

function ConfigView({ service, onOpenUrl }: { service: Service; onOpenUrl: () => void }) {
  return <div className="config-view"><InfoLine label="工作目录" value={service.workdir || '未配置'} mono /><InfoLine label="启动命令" value={service.command || '未配置'} mono /><InfoLine label="Shell" value={`${service.shell.program} ${service.shell.args.join(' ')}`} mono /><div className="info-grid"><InfoLine label="端口" value={service.port ? String(service.port) : '未启用'} /><InfoLine label="环境变量" value={`${service.env.length} 项`} /></div>{service.url && <Button variant="ghost" size="md" className="url-link" onClick={onOpenUrl}><Globe2 size={14} />{service.url}<ArrowUpFromLine size={12} /></Button>}<div className="config-section"><div className="policy-grid"><span>{Math.round(service.log.maxBytes / 1024 / 1024)} MB 单文件</span><span>{service.log.rotateCount} 个历史文件</span><span>{Math.round(service.log.maxMemoryBytes / 1024)} KB 内存</span></div></div></div>;
}

function InfoLine({ label, value, mono }: { label: string; value: string; mono?: boolean }) { return <div className="info-line"><span>{label}</span><strong className={mono ? 'mono' : ''} title={value}>{value}</strong></div>; }

function LogView({ logs, meta, containerRef }: { logs: LogChunk[]; meta?: { truncated: boolean; droppedChunks: number }; containerRef: React.RefObject<HTMLDivElement | null> }) {
  return <div className="log-view">{meta?.truncated && <div className="log-warning"><AlertCircle size={14} />较早日志已轮转或被丢弃{meta.droppedChunks ? `（${meta.droppedChunks} 条）` : ''}</div>}<div className="log-console" ref={containerRef}>{logs.length ? logs.map((chunk) => <div className={`log-line ${chunk.stream}`} key={`${chunk.seq}-${chunk.timestamp}`}><span className="log-seq">{String(chunk.seq).padStart(4, '0')}</span><span className="log-time">{formatTime(chunk.timestamp)}</span><span className="log-stream">{chunk.stream}</span><code>{chunk.text}</code></div>) : <div className="empty-inline"><TerminalSquare size={18} /><span>服务启动后，日志会显示在这里</span></div>}</div></div>;
}

function MetricsView({ runtime, resource }: { runtime: RuntimeSnapshot; resource: ResourceSnapshot | null }) {
  const cards = [{ label: 'CPU', value: resource?.cpuPercent === null || resource?.cpuPercent === undefined ? '—' : `${resource.cpuPercent.toFixed(1)}%`, icon: <Gauge size={16} /> }, { label: '内存', value: formatBytes(resource?.rssBytes ?? null), icon: <Activity size={16} /> }, { label: '进程数', value: resource ? String(resource.processCount) : '—', icon: <Layers3 size={16} /> }, { label: 'PID', value: runtime.pid ? String(runtime.pid) : '—', icon: <TerminalSquare size={16} /> }];
  return <div className="metrics-view"><div className="metric-cards">{cards.map((card) => <div className="metric-card" key={card.label}><span>{card.icon}</span><small>{card.label}</small><strong>{card.value}</strong></div>)}</div><div className="metric-meta"><InfoLine label="启动时间" value={formatTime(runtime.startedAt)} /><InfoLine label="结束时间" value={formatTime(runtime.endedAt)} /><InfoLine label="本次 generation" value={runtime.generation ? runtime.generation.slice(0, 16) : '—'} mono /></div>{resource && <span className="metric-updated">采样于 {formatTime(resource.capturedAt)}</span>}</div>;
}

function ServiceEditor({ initial, isNew, groups, busy, onCancel, onSubmit }: { initial: Service; isNew: boolean; groups: Group[]; busy: boolean; onCancel: () => void; onSubmit: (service: Service) => void }) {
  const [draft, setDraft] = useState<Service>(() => ({ ...initial, env: initial.env.map((item) => ({ ...item })), log: { ...initial.log } }));
  const [advanced, setAdvanced] = useState(false);
  const update = <K extends keyof Service>(key: K, value: Service[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const updateEnv = (index: number, patch: Partial<EnvVar>) => setDraft((current) => ({ ...current, env: current.env.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) }));
  return <Modal title={isNew ? '添加服务' : '编辑服务'} subtitle="配置一个由 Avenil 管理的本地前台进程" blocked={busy} onClose={onCancel} wide><form className="editor-form" onSubmit={(event) => { event.preventDefault(); onSubmit(draft); }}><div className="form-grid two"><Field label="服务名称" required><input value={draft.name} onChange={(event) => update('name', event.target.value)} placeholder="例如：订单 API" autoFocus /></Field><Field label="项目组"><Select value={draft.groupId ?? ''} disabled={busy} onValueChange={(value) => update('groupId', value || null)}><SelectTrigger aria-label="项目组"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="">未分组</SelectItem>{groups.map((group) => <SelectItem value={group.id} key={group.id}>{group.name}</SelectItem>)}</SelectContent></Select></Field></div><Field label="工作目录" required hint="命令会在此目录下执行"><div className="input-with-icon"><input value={draft.workdir} onChange={(event) => update('workdir', event.target.value)} placeholder="/Users/you/projects/service" /><FolderOpen size={15} /></div></Field><Field label="启动命令" required><div className="command-input"><span>$</span><input value={draft.command} onChange={(event) => update('command', event.target.value)} placeholder="pnpm dev / mvn spring-boot:run / python -m app" /></div></Field><div className="form-grid two"><Field label="端口" hint="启用本地 TCP 就绪检查"><input type="number" min="1" max="65535" value={draft.port ?? ''} onChange={(event) => update('port', event.target.value ? Number(event.target.value) : null)} placeholder="可选" /></Field><Field label="URL" hint="仅用于打开地址"><input value={draft.url ?? ''} onChange={(event) => update('url', event.target.value || null)} placeholder="http://localhost:3000" /></Field></div><div className="form-section"><div className="form-section-head"><div><strong>环境变量</strong><span>导出配置时值会自动脱敏</span></div><Button variant="ghost" size="sm" className="form-action" type="button" onClick={() => setDraft((current) => ({ ...current, env: [...current.env, { key: '', value: '', secret: false }] }))}><Plus size={14} />添加变量</Button></div>{draft.env.length ? <div className="env-list">{draft.env.map((item, index) => <div className="env-row" key={`${index}-${item.key}`}><input value={item.key} onChange={(event) => updateEnv(index, { key: event.target.value })} placeholder="KEY" /><input type={item.secret ? 'password' : 'text'} value={item.value} onChange={(event) => updateEnv(index, { value: event.target.value })} placeholder="值" /><label className="secret-check"><input type="checkbox" checked={item.secret} onChange={(event) => updateEnv(index, { secret: event.target.checked })} />敏感</label><Button variant="ghost" size="icon" className="icon-button" type="button" onClick={() => setDraft((current) => ({ ...current, env: current.env.filter((_, itemIndex) => itemIndex !== index) }))} aria-label="删除变量"><X size={14} /></Button></div>)}</div> : <div className="form-empty">暂未添加环境变量</div>}</div><Button variant="ghost" size="md" className="advanced-toggle" type="button" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}><ChevronDown size={15} className={advanced ? 'rotate' : ''} />高级设置<span>Shell 与日志轮转</span></Button>{advanced && <div className="advanced-panel"><div className="form-grid two"><Field label="Shell 程序"><input value={draft.shell.program} onChange={(event) => update('shell', { ...draft.shell, program: event.target.value })} /></Field><Field label="Shell 参数"><input value={draft.shell.args.join(' ')} onChange={(event) => update('shell', { ...draft.shell, args: event.target.value.split(' ').filter(Boolean) })} /></Field></div><div className="form-grid three"><Field label="单文件上限"><input type="number" min={64 * 1024} max={16 * 1024 * 1024} value={draft.log.maxBytes} onChange={(event) => update('log', { ...draft.log, maxBytes: Number(event.target.value) })} /></Field><Field label="轮转文件数"><input type="number" min="1" max="10" value={draft.log.rotateCount} onChange={(event) => update('log', { ...draft.log, rotateCount: Number(event.target.value) })} /></Field><Field label="内存上限"><input type="number" min={64 * 1024} max={4 * 1024 * 1024} value={draft.log.maxMemoryBytes} onChange={(event) => update('log', { ...draft.log, maxMemoryBytes: Number(event.target.value) })} /></Field></div><p className="field-note">日志文件会按服务隔离并按大小轮转，内存日志超限会丢弃较早内容。</p></div>}<div className="modal-actions"><Button variant="outline" size="sm" type="button" onClick={onCancel}>取消</Button><Button variant="primary" size="sm" type="submit" disabled={busy}>{busy ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />} {busy ? '保存中…' : '保存服务'}</Button></div></form></Modal>;
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) { return <label className="field"><span>{label}{required && <i>*</i>}{hint && <small>{hint}</small>}</span>{children}</label>; }

function GroupEditor({ initial, busy, onCancel, onDelete, onSubmit }: { initial: Group | null; busy: boolean; onCancel: () => void; onDelete?: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) { return <Modal title={initial ? '编辑项目组' : '新建项目组'} subtitle="把来自不同仓库的服务放进同一个工作区" blocked={busy} onClose={onCancel}><form className="editor-form" onSubmit={onSubmit}><Field label="项目组名称" required><input name="name" defaultValue={initial?.name ?? ''} placeholder="例如：电商本地环境" autoFocus /></Field><div className="modal-actions">{onDelete && <Button variant="ghost" size="sm" className="danger-action" type="button" onClick={onDelete}><Trash2 size={14} />删除项目组</Button>}<span className="actions-spacer" /><Button variant="outline" size="sm" type="button" onClick={onCancel}>取消</Button><Button variant="primary" size="sm" type="submit" disabled={busy}>{busy ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />} {busy ? '保存中…' : '保存'}</Button></div></form></Modal>; }

function ImportDialog({ preview, canApply, busy, onCancel, onApply }: { preview: ImportPreview; canApply: boolean; busy: boolean; onCancel: () => void; onApply: () => void }) { return <Modal title="导入配置" subtitle="这会用文件内容整份替换当前配置" blocked={busy} onClose={onCancel}><div className="import-preview"><div className="preview-summary"><div><strong>{preview.groupCount}</strong><span>个项目组</span></div><div><strong>{preview.serviceCount}</strong><span>个服务</span></div><div><strong>{preview.changes.addedServices + preview.changes.removedServices}</strong><span>项服务变更</span></div></div>{preview.errors.length ? <div className="preview-errors">{preview.errors.map((message) => <div key={message}><AlertCircle size={15} />{message}</div>)}</div> : <div className="preview-ok"><Check size={15} />文件校验通过，可以应用</div>}{preview.warnings.map((message) => <div className="preview-warning" key={message}><AlertCircle size={15} />{message}</div>)}{!canApply && !preview.errors.length && <div className="preview-warning"><Info size={15} />当前有服务正在运行，停止全部服务后才能替换配置。</div>}<p className="import-note"><FileJson size={15} />导入不会合并当前内容，应用后当前服务定义将被替换。</p></div><div className="modal-actions"><Button variant="outline" size="sm" type="button" onClick={onCancel}>取消</Button><Button variant="primary" size="sm" type="button" disabled={!canApply || busy} onClick={onApply}>{busy ? <LoaderCircle size={15} className="spin" /> : <ArrowDownToLine size={15} />} {busy ? '替换中…' : '应用替换'}</Button></div></Modal>; }

function Modal({ title, subtitle, onClose, blocked, wide, children }: { title: string; subtitle?: string; onClose: () => void; blocked?: boolean; wide?: boolean; children: React.ReactNode }) {
  const { dialogRef, onKeyDown } = useDialogFocus();
  const reduceMotion = useReducedMotion();
  const fadeTransition = reduceMotion ? { duration: 0.01 } : FADE_TRANSITION;
  const panelTransition = reduceMotion ? { duration: 0.01 } : SPRING_PANEL;
  return <motion.div className="modal-backdrop" role="presentation" variants={MODAL_BACKDROP_VARIANTS} initial="initial" animate="animate" exit="exit" transition={fadeTransition} onMouseDown={(event) => { if (event.target === event.currentTarget && !blocked) onClose(); }}><motion.section ref={dialogRef} className={`modal ${wide ? 'wide' : ''}`} variants={MODAL_VARIANTS} initial="initial" animate="animate" exit="exit" transition={panelTransition} role="dialog" aria-modal="true" aria-label={title} onKeyDown={onKeyDown}><div className="modal-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><Button variant="ghost" size="icon" className="icon-button" onClick={onClose} aria-label="关闭" disabled={blocked}><X size={17} /></Button></div><fieldset disabled={blocked} className="modal-content-lock">{children}</fieldset></motion.section></motion.div>;
}

function EmptyState({ hasConfig, onAdd, onClear }: { hasConfig: boolean; onAdd: () => void; onClear: () => void }) { return <div className="empty-state"><div className="empty-icon">{hasConfig ? <Search size={22} /> : <Server size={22} />}</div><h2>{hasConfig ? '没有匹配的服务' : '开始管理本地服务'}</h2><p>{hasConfig ? '切换服务分类或清除当前筛选条件。' : '添加 Java、Node、Python 或前端项目，让多个服务在一个窗口里井然有序。'}</p>{hasConfig ? <Button variant="outline" size="sm" onClick={onClear}>清除筛选</Button> : <Button variant="primary" size="sm" onClick={onAdd}><Plus size={15} />添加第一个服务</Button>}</div>; }
function LoadingState() { return <div className="loading-state"><LoaderCircle size={18} className="spin" />正在载入本机配置…</div>; }
function DesktopPrompt() { return <div className="desktop-prompt"><div className="desktop-prompt-card"><BrandMark large /><h1>Avenil 需要桌面运行时</h1><p>当前页面运行在普通浏览器中。请打开 Tauri 桌面应用管理本机进程；浏览器预览仅在地址后添加 <code>?preview=1</code> 时启用演示数据。</p><div className="prompt-note"><Info size={15} />普通浏览器不会自动切换到模拟模式，也不会访问本机服务。</div></div></div>; }
function errorText(reason: unknown) { return reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : '操作失败，请稍后重试'; }

export default App;
