import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  Activity,
  AlertCircle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Box,
  Braces,
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
  List,
  LoaderCircle,
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
import CliInstallControl from './CliInstallControl';
import WorkspaceTransferMenu from './WorkspaceTransferMenu';
import ThemeControl, { LanguageControl, useTheme } from './ThemeControl';
import BrandMark from './components/BrandMark';
import { useDialogFocus } from './useDialogFocus';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from './components/ui/select';
import { Button } from './components/ui/button';
import { Tooltip } from './components/ui/tooltip';
import { EASE_OUT, SPRING_PANEL } from './lib/ease';
import { useDismiss } from './lib/hooks/use-dismiss';
import { useI18n, type MessageKey, type Translator } from './i18n';
import {
  AppConfig,
  BatchAction,
  EnvVar,
  CliInstallInfo,
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

const statusMeta: Record<ServiceStatus, { labelKey: MessageKey; tone: string; icon: string }> = {
  stopped: { labelKey: 'service.status.stopped', tone: 'muted', icon: '○' },
  starting: { labelKey: 'service.status.starting', tone: 'amber', icon: '◌' },
  running: { labelKey: 'service.status.running', tone: 'green', icon: '●' },
  stopping: { labelKey: 'service.status.stopping', tone: 'amber', icon: '◌' },
  exited: { labelKey: 'service.status.exited', tone: 'muted', icon: '○' },
  failed: { labelKey: 'service.status.failed', tone: 'red', icon: '×' },
  unknown: { labelKey: 'service.status.unknown', tone: 'violet', icon: '?' },
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
const formatTime = (value: string | null | undefined, locale: string) => value ? new Date(value).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
const formatCommand = (value: string) => value.length > 52 ? `${value.slice(0, 52)}…` : value;
const uid = () => crypto.randomUUID();
const isFocusableElement = (element: HTMLElement | null) => Boolean(element?.isConnected && element.getClientRects().length);
const CLI_PROMPT_DISMISSED_KEY = 'rundock.cli-install-prompt-dismissed';

function cliPromptWasDismissed() {
  try { return window.localStorage.getItem(CLI_PROMPT_DISMISSED_KEY) === '1'; } catch { return false; }
}

function markCliPromptDismissed() {
  try { window.localStorage.setItem(CLI_PROMPT_DISMISSED_KEY, '1'); } catch { /* best effort */ }
}

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
  const { locale, t } = useI18n();
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
  const [cliInstallInfo, setCliInstallInfo] = useState<CliInstallInfo | null>(null);
  const [cliInstallError, setCliInstallError] = useState<string | null>(null);
  const [cliInstallPromptOpen, setCliInstallPromptOpen] = useState(false);
  const [cliInstallBusy, setCliInstallBusy] = useState(false);
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
  const quitRequestRef = useRef(false);
  const cliInfoRequestRef = useRef(0);
  const cliInstallGenerationRef = useRef(0);
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

  const loadCliInstallInfo = useCallback(async () => {
    const requestId = ++cliInfoRequestRef.current;
    const installGeneration = cliInstallGenerationRef.current;
    setCliInstallError(null);
    try {
      const next = await api.cliInstallInfo();
      if (requestId !== cliInfoRequestRef.current || installGeneration !== cliInstallGenerationRef.current) return;
      setCliInstallInfo(next);
    } catch (reason) {
      if (requestId !== cliInfoRequestRef.current || installGeneration !== cliInstallGenerationRef.current) return;
      setCliInstallInfo(null);
      setCliInstallError(errorText(reason, t));
    }
  }, [t]);

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
      await loadCliInstallInfo();
      setError(null);
    } catch (reason) {
      setError(errorText(reason, t));
    } finally {
      setLoading(false);
    }
  }, [loadCliInstallInfo, t]);

  useEffect(() => { void hydrate(); }, [hydrate]);

  useEffect(() => {
    if (!inTauri || settingsOpen || !cliInstallInfo?.supported || cliInstallInfo.installed || cliPromptWasDismissed()) return;
    setCliInstallPromptOpen(true);
  }, [cliInstallInfo, settingsOpen]);

  const dismissCliInstallPrompt = useCallback(() => {
    markCliPromptDismissed();
    setCliInstallPromptOpen(false);
  }, []);

  const openSettings = useCallback(() => {
    markCliPromptDismissed();
    setSettingsOpen(true);
    void loadCliInstallInfo();
  }, [loadCliInstallInfo]);

  const handleCliInstall = useCallback(async () => {
    if (cliInstallBusy) return;
    cliInfoRequestRef.current += 1;
    setCliInstallError(null);
    setCliInstallBusy(true);
    try {
      const next = await api.installCli();
      cliInstallGenerationRef.current += 1;
      setCliInstallInfo(next);
      setCliInstallPromptOpen(false);
      markCliPromptDismissed();
      notify(t('toast.cliInstalled'), 'success');
    } catch (reason) {
      notify(errorText(reason, t), 'error');
    } finally {
      setCliInstallBusy(false);
    }
  }, [cliInstallBusy, notify, t]);

  useEffect(() => {
    if (!previewMode && !inTauri) return;
    let disposed = false;
    const handleQuitRequested = () => {
      if (disposed || quitRequestRef.current) return;
      quitRequestRef.current = true;
      if (!window.confirm(t('confirm.quit'))) {
        void api.cancelQuitRequest()
          .catch((reason) => { if (!disposed) notify(errorText(reason, t), 'error'); })
          .finally(() => { quitRequestRef.current = false; });
        return;
      }
      void api.quit().catch((reason) => {
        quitRequestRef.current = false;
        notify(errorText(reason, t), 'error');
      });
    };
    const quitSubscription = api.on('quitRequested', handleQuitRequested);
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
          notify(t('toast.shutdownStarting'), 'info');
        } else if (payload.phase === 'forced') {
          setShutdownState(null);
          notify(payload.error || t('toast.shutdownForced'), 'error');
        } else {
          setShutdownState(null);
        }
      }),
      quitSubscription,
    ];
    void quitSubscription
      .then(() => disposed ? false : api.quitRequestPending())
      .then((pending) => { if (pending) handleQuitRequested(); })
      .catch((reason) => { if (!disposed) notify(errorText(reason, t), 'error'); });
    return () => { disposed = true; subscriptions.forEach((subscription) => subscription.then((unlisten) => unlisten())); };
  }, [notify, t]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (settingsOpen || cliInstallPromptOpen) {
        if (event.key === 'Escape' && !cliInstallBusy) {
          if (cliInstallPromptOpen) dismissCliInstallPrompt();
          else setSettingsOpen(false);
        }
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
  }, [settingsOpen, cliInstallPromptOpen, cliInstallBusy, closeDetails, editor, expandedId, groupEditor, ideImportBusy, ideImportOpen, importApplyBusy, importDialog, groupSubmitBusy, selectedGroupId, serviceSubmitBusy]);

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
    ? t('toast.ideBusy')
    : shutdownState?.phase === 'stopping'
      ? t('toast.shutdownBusy')
      : actionIds.length
        ? t('toast.actionBusy')
        : config.services.some((service) => runtimeIsActive((runtimes[service.id] ?? emptyRuntime(service.id)).status))
          ? t('toast.runningBusy')
          : null;

  useEffect(() => {
    if (!expandedId) return;
    void api.logs(expandedId, undefined, 300).then((page) => {
      setLogs((current) => ({ ...current, [expandedId]: page.chunks }));
      setLogMeta((current) => ({ ...current, [expandedId]: { truncated: page.truncated, droppedChunks: page.droppedChunks } }));
    }).catch((reason) => notify(errorText(reason, t), 'error'));
  }, [expandedId, notify, t]);

  const handleRuntime = async (serviceId: string, action: BatchAction) => {
    if (shutdownState?.phase === 'stopping' && action !== 'stop') return;
    if (actionIds.includes(serviceId)) return;
    setActionIds((ids) => [...ids, serviceId]);
    try {
      const snapshot = action === 'start' ? await api.start(serviceId) : action === 'stop' ? await api.stop(serviceId) : await api.restart(serviceId);
      setRuntimes((current) => ({ ...current, [serviceId]: snapshot }));
      notify(action === 'start' ? t('toast.startRequested') : action === 'stop' ? t('toast.stopped') : t('toast.restartRequested'), 'success');
    } catch (reason) { notify(errorText(reason, t), 'error'); }
    finally { setActionIds((ids) => ids.filter((id) => id !== serviceId)); }
  };

  const handleBatch = async (action: BatchAction) => {
    if (shutdownState?.phase === 'stopping' && action !== 'stop') return;
    if (!selectedGroupId || (action === 'stop' ? groupStopBusy : groupActive)) return;
    const services = servicesByGroup.get(selectedGroupId) ?? [];
    if (!services.length) return notify(t('toast.noServices'), 'info');
    const ids = services.map((service) => service.id);
    setActionIds(ids);
    try {
      const results = await api.batch(ids, action);
      setRuntimes((current) => Object.fromEntries([...Object.entries(current), ...results.filter((result) => result.snapshot).map((result) => [result.serviceId, result.snapshot!])]));
      const failures = results.filter((result) => !result.accepted).length;
      notify(failures ? t('toast.batchFailed', { success: results.length - failures, failed: failures }) : t('toast.batchAction', { count: results.length, action: action === 'start' ? t('toast.batchStart') : action === 'stop' ? t('toast.batchStop') : t('toast.batchRestart') }), failures ? 'error' : 'success');
    } catch (reason) { notify(errorText(reason, t), 'error'); }
    finally { setActionIds([]); }
  };

  const handleServiceSubmit = async (service: Service) => {
    if (serviceSubmitRef.current) return;
    if (!service.name.trim() || !service.workdir.trim() || !service.command.trim()) return notify(t('toast.serviceFields'), 'error');
    if (service.port !== null && (!Number.isInteger(service.port) || service.port < 1 || service.port > 65535)) return notify(t('toast.portInvalid'), 'error');
    if (service.env.some((item, index) => !item.key.trim() || service.env.findIndex((candidate) => candidate.key === item.key) !== index)) return notify(t('toast.envInvalid'), 'error');
    serviceSubmitRef.current = true;
    setServiceSubmitBusy(true);
    try {
      const saved = await api.upsertService(service);
      setConfig((current) => ({ ...current, services: [...current.services.filter((item) => item.id !== saved.id), saved] }));
      setEditor(null);
      notify(editor?.isNew ? t('toast.serviceAdded') : t('toast.serviceUpdated'), 'success');
    } catch (reason) { notify(errorText(reason, t), 'error'); }
    finally { serviceSubmitRef.current = false; setServiceSubmitBusy(false); }
  };

  const handleDeleteService = async (service: Service) => {
    const snapshot = runtimes[service.id] ?? emptyRuntime(service.id);
    if (runtimeIsActive(snapshot.status)) return notify(t('toast.stopBeforeDelete'), 'error');
    if (!window.confirm(t('confirm.deleteService', { name: service.name }))) return;
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
      notify(t('toast.serviceDeleted'), 'success');
    } catch (reason) { notify(errorText(reason, t), 'error'); }
  };

  const handleGroupSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (groupSubmitRef.current) return;
    const data = new FormData(event.currentTarget);
    const name = String(data.get('name') ?? '').trim();
    if (!name) return notify(t('toast.groupNameRequired'), 'error');
    const isEditing = Boolean(groupEditor?.id);
    const group = isEditing && groupEditor ? { ...groupEditor, name } : { id: uid(), name, sortOrder: groups.length };
    groupSubmitRef.current = true;
    setGroupSubmitBusy(true);
    try { await api.upsertGroup(group); setConfig((current) => ({ ...current, groups: [...current.groups.filter((item) => item.id !== group.id), group] })); setGroupEditor(null); notify(isEditing ? t('toast.groupUpdated') : t('toast.groupCreated'), 'success'); } catch (reason) { notify(errorText(reason, t), 'error'); }
    finally { groupSubmitRef.current = false; setGroupSubmitBusy(false); }
  };

  const handleDeleteGroup = async (group: Group) => {
    const services = servicesByGroup.get(group.id) ?? [];
    if (services.some((service) => runtimeIsActive((runtimes[service.id] ?? emptyRuntime(service.id)).status))) return notify(t('toast.stopGroupFirst'), 'error');
    if (services.length) return notify(t('toast.groupNotEmpty'), 'error');
    try { await api.deleteGroup(group.id); setConfig((current) => ({ ...current, groups: current.groups.filter((item) => item.id !== group.id) })); setSelectedGroupId(null); setGroupEditor(null); notify(t('toast.groupDeleted'), 'success'); } catch (reason) { notify(errorText(reason, t), 'error'); }
  };

  const handleExport = async () => {
    try {
      const result = await api.exportConfig();
      const blob = new Blob([result.json], { type: 'application/json;charset=utf-8' });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = href; anchor.download = 'avenil-config.json'; anchor.click(); URL.revokeObjectURL(href);
      notify(t('toast.exported'), 'info');
    } catch (reason) { notify(errorText(reason, t), 'error'); }
  };

  const handleFile = async (file: File) => {
    try { const json = await file.text(); const preview = await api.importPreview(json); setImportDialog({ json, preview }); } catch (reason) { notify(errorText(reason, t), 'error'); }
  };

  const handleImportApply = async () => {
    if (importApplyRef.current) return;
    if (!importDialog?.preview.canApply || groupActive || config.services.some((service) => runtimeIsActive((runtimes[service.id] ?? emptyRuntime(service.id)).status))) return;
    importApplyRef.current = true;
    setImportApplyBusy(true);
    try { const next = await api.importApply(importDialog.json); setConfig(next); setImportDialog(null); closeDetails(); notify(t('toast.configReplaced'), 'success'); } catch (reason) { notify(errorText(reason, t), 'error'); }
    finally { importApplyRef.current = false; setImportApplyBusy(false); }
  };

  const handleIdeImportPreview = async (input: IdeImportInput) => {
    if (ideImportBusy) return;
    setIdeImportBusy(true);
    try { setIdeImportPreview(await api.ideImportPreview(input)); } catch (reason) { notify(errorText(reason, t), 'error'); }
    finally { setIdeImportBusy(false); }
  };

  const handleChooseIdeProjectDirectory = async () => {
    try { return await api.chooseProjectDirectory(); } catch (reason) { notify(errorText(reason, t), 'error'); return null; }
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
      notify(t('toast.ideImported', { count: selectedIds.length, group: groupName.trim() }), 'success');
    } catch (reason) { notify(errorText(reason, t), 'error'); }
    finally { setIdeImportBusy(false); }
  };

  if (desktopUnavailable) return <DesktopPrompt />;
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><BrandMark /><div><strong>Avenil</strong><span>{t('brand.tagline')}</span></div></div>
        <div className="topbar-actions">
          {previewMode && <span className="demo-pill"><span className="demo-dot" />{t('demo.data')}</span>}
        </div>
      </header>
      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-heading"><span>{t('sidebar.workspace')}</span></div>
          <nav className="nav-list" aria-label={t('sidebar.filterAria')}>
            <NavItem icon={<LayoutList size={16} />} label={t('sidebar.allServices')} count={config.services.length} active={selectedGroupId === null && filter === 'all'} onClick={() => { setSelectedGroupId(null); setFilter('all'); }} />
            <NavItem icon={<Activity size={16} />} label={t('sidebar.running')} count={counts.running} active={filter === 'running' && selectedGroupId === null} onClick={() => { setSelectedGroupId(null); setFilter('running'); }} />
            <NavItem icon={<Square size={14} />} label={t('sidebar.stopped')} count={counts.stopped} active={filter === 'stopped' && selectedGroupId === null} onClick={() => { setSelectedGroupId(null); setFilter('stopped'); }} />
          </nav>
          <div className="sidebar-heading groups-heading"><span>{t('sidebar.groups')}</span><Button variant="ghost" size="icon" className="mini-button" aria-label={t('sidebar.createGroup')} onClick={() => setGroupEditor({ id: '', name: '', sortOrder: groups.length })}><Plus size={15} /></Button></div>
          <nav className="group-list" aria-label={t('sidebar.groups')}>
            {groups.map((group) => <GroupNav key={group.id} group={group} services={servicesByGroup.get(group.id) ?? []} runtimes={runtimes} selected={selectedGroupId === group.id} onSelect={() => { setSelectedGroupId(group.id); setFilter('all'); }} onEdit={() => setGroupEditor(group)} onDelete={() => void handleDeleteGroup(group)} />)}
            {!groups.length && <div className="sidebar-empty">{t('sidebar.emptyGroups')}</div>}
          </nav>
          <div className="sidebar-footer">
            <nav className="workspace-actions" aria-label={t('sidebar.actionsAria')}>
              <Button variant="primary" size="sm" className="sidebar-add-service" onClick={() => setEditor({ service: createService(selectedGroupId), isNew: true })}><Plus size={16} />{t('sidebar.addService')}</Button>
              <WorkspaceTransferMenu
                onIdeImport={() => { setIdeImportPreview(null); setIdeImportBusy(false); setIdeImportOpen(true); }}
                onImportConfig={() => { setImportDialog(null); fileInputRef.current?.click(); }}
                onExportConfig={() => void handleExport()}
              />
            </nav>
            <input ref={fileInputRef} type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleFile(file); event.currentTarget.value = ''; }} />
            <div className="sidebar-settings"><Button variant="ghost" size="sm" className="sidebar-action settings-button" type="button" aria-haspopup="dialog" onClick={openSettings}><Settings size={16} /><span>{t('sidebar.settings')}</span></Button></div>
          </div>
        </aside>

        <main className="main-content">
          <div className="content-head">
            <h1 title={selectedGroup?.name ?? t('main.allServices')}>{selectedGroup?.name ?? t('main.allServices')}</h1>
            {selectedGroup && <div className="group-actions"><Button variant="ghost" size="sm" className="group-action" disabled={groupActive || !groupServices.length || shutdownState?.phase === 'stopping'} onClick={() => void handleBatch('start')}><Play size={14} />{t('main.startAll')}</Button><Button variant="ghost" size="sm" className="group-action" disabled={groupActive || !groupServices.length || shutdownState?.phase === 'stopping'} onClick={() => void handleBatch('restart')}><RefreshCw size={14} />{t('main.restartAll')}</Button><Button variant="ghost" size="sm" className="group-action danger-text" disabled={!groupStopAvailable || groupStopBusy} onClick={() => void handleBatch('stop')}><Square size={13} />{t('main.stopAll')}</Button></div>}
          </div>
          {shutdownState?.phase === 'stopping' && <div className="shutdown-strip"><LoaderCircle size={14} className="spin" /><span>{t('main.shutdownNotice')}</span></div>}
          <div className="filterbar"><div className="filter-tabs"><FilterTab label={t('filter.all')} active={filter === 'all'} onClick={() => setFilter('all')} /><FilterTab label={t('filter.running')} active={filter === 'running'} onClick={() => setFilter('running')} /><FilterTab label={t('filter.stopped')} active={filter === 'stopped'} onClick={() => setFilter('stopped')} /></div><span className="list-count">{t('filter.results', { count: visibleServices.length })}</span></div>
          <div className="service-list" tabIndex={-1}>
            {loading ? <LoadingState /> : !visibleServices.length ? <EmptyState hasConfig={config.services.length > 0} onAdd={() => setEditor({ service: createService(selectedGroupId), isNew: true })} onClear={() => { setFilter('all'); setSelectedGroupId(null); }} /> : visibleServices.map((service) => <ServiceRow key={service.id} service={service} group={groups.find((group) => group.id === service.groupId)} runtime={runtimes[service.id] ?? emptyRuntime(service.id)} resource={resources[service.id]} expanded={expandedId === service.id} logs={logs[service.id] ?? []} logMeta={logMeta[service.id]} busy={actionIds.includes(service.id)} shutdownBusy={shutdownState?.phase === 'stopping'} onSelect={(trigger) => toggleDetails(service.id, trigger)} onDetailsExitComplete={handleDetailsExitComplete} onClose={closeDetails} onAction={(action) => void handleRuntime(service.id, action)} onEdit={() => setEditor({ service, isNew: false })} onDelete={() => void handleDeleteService(service)} onOpenUrl={() => void api.openUrl(service.id)} setTab={setPanelTab} tab={panelTab} />)}
          </div>
          {error && <div className="error-strip"><AlertCircle size={16} /><span>{error}</span><Button variant="ghost" size="sm" className="error-retry" onClick={() => void hydrate()}>{t('error.retry')}</Button></div>}
        </main>

      </div>

      <AnimatePresence initial={false}>
        {settingsOpen && <Modal key="settings" title={t('settings.title')} subtitle={t('settings.subtitle')} onClose={() => setSettingsOpen(false)}>
          <div className="settings-content">
            <ThemeControl mode={theme.mode} onChange={theme.changeMode} />
            <LanguageControl />
            <CliInstallControl info={cliInstallInfo} error={cliInstallError} busy={cliInstallBusy} onInstall={() => void handleCliInstall()} onRetry={() => void loadCliInstallInfo()} onCopyError={() => notify(t('toast.cliCopyFailed'), 'error')} />
          </div>
        </Modal>}
        {cliInstallPromptOpen && cliInstallInfo && <Modal key="cli-install-prompt" title={t('settings.cli.firstLaunchTitle')} subtitle={t('settings.cli.firstLaunchSubtitle')} blocked={cliInstallBusy} onClose={dismissCliInstallPrompt}>
          <div className="settings-content cli-install-prompt-content">
            <CliInstallControl info={cliInstallInfo} error={cliInstallError} busy={cliInstallBusy} onInstall={() => void handleCliInstall()} onRetry={() => void loadCliInstallInfo()} onCopyError={() => notify(t('toast.cliCopyFailed'), 'error')} />
            <div className="modal-actions"><Button variant="outline" size="sm" type="button" onClick={dismissCliInstallPrompt}>{t('settings.cli.later')}</Button></div>
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

type GroupMenuAnchor = { x: number; y: number };
type GroupMenuPosition = { left: number; top: number };

const GROUP_MENU_MARGIN = 8;
const GROUP_MENU_VARIANTS = {
  initial: { opacity: 0, y: 5, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 3, scale: 0.98 },
};
const GROUP_MENU_TRANSITION = { duration: 0.14, ease: EASE_OUT } as const;

function GroupNav({ group, services, runtimes, selected, onSelect, onEdit, onDelete }: { group: Group; services: Service[]; runtimes: Record<string, RuntimeSnapshot>; selected: boolean; onSelect: () => void; onEdit: () => void; onDelete: () => void }) {
  const { t } = useI18n();
  const running = services.filter((service) => runtimeIsRunning((runtimes[service.id] ?? emptyRuntime(service.id)).status)).length;
  const hasIssue = services.some((service) => ['failed', 'unknown', 'exited'].includes((runtimes[service.id] ?? emptyRuntime(service.id)).status));
  const [menuAnchor, setMenuAnchor] = useState<GroupMenuAnchor | null>(null);
  const [menuPosition, setMenuPosition] = useState<GroupMenuPosition>({ left: 0, top: 0 });
  const groupRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const menuId = `group-context-menu-${group.id}`;
  const menuOpen = menuAnchor !== null;

  const closeMenu = useCallback(() => setMenuAnchor(null), []);
  const focusGroup = useCallback(() => {
    window.requestAnimationFrame(() => groupRef.current?.querySelector<HTMLButtonElement>('.group-nav-main')?.focus());
  }, []);
  const closeMenuAndFocusGroup = useCallback(() => {
    setMenuAnchor(null);
    focusGroup();
  }, [focusGroup]);

  useDismiss(menuOpen, closeMenu, menuRef, { behavior: 'pass-through', escape: false });

  useLayoutEffect(() => {
    if (!menuAnchor || !menuRef.current) return;
    const { width, height } = menuRef.current.getBoundingClientRect();
    const maxLeft = Math.max(GROUP_MENU_MARGIN, window.innerWidth - width - GROUP_MENU_MARGIN);
    const maxTop = Math.max(GROUP_MENU_MARGIN, window.innerHeight - height - GROUP_MENU_MARGIN);
    setMenuPosition({
      left: Math.min(Math.max(GROUP_MENU_MARGIN, menuAnchor.x), maxLeft),
      top: Math.min(Math.max(GROUP_MENU_MARGIN, menuAnchor.y), maxTop),
    });
  }, [menuAnchor]);

  useEffect(() => {
    if (!menuOpen) return;
    const frame = window.requestAnimationFrame(() => menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [menuOpen]);

  const openMenu = useCallback((x: number, y: number) => {
    const rect = groupRef.current?.getBoundingClientRect();
    const fallbackX = rect ? rect.left + Math.min(rect.width / 2, 72) : GROUP_MENU_MARGIN;
    const fallbackY = rect?.bottom ?? GROUP_MENU_MARGIN;
    const nextX = x > 0 ? x : fallbackX;
    const nextY = y > 0 ? y : fallbackY;
    setMenuPosition({ left: nextX, top: nextY });
    setMenuAnchor({ x: nextX, y: nextY });
  }, []);

  const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    openMenu(event.clientX, event.clientY);
  };

  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    openMenu(rect.right - 8, rect.bottom - 4);
  };

  const choose = (action: () => void) => {
    setMenuAnchor(null);
    action();
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeMenuAndFocusGroup();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      closeMenuAndFocusGroup();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !items.length) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[nextIndex]?.focus();
  };

  return <>
    <div ref={groupRef} className={`group-nav ${selected ? 'selected' : ''}`} onContextMenu={handleContextMenu}>
      <Button variant="ghost" size="md" className="group-nav-main" type="button" aria-pressed={selected} aria-haspopup="menu" aria-expanded={menuOpen} aria-controls={menuId} onClick={onSelect} onKeyDown={handleTriggerKeyDown}>
        <span className={`group-icon ${hasIssue ? 'has-issue' : ''}`}><Box size={14} /></span><span className="truncate">{group.name}</span><span className="group-count">{running}/{services.length}</span>
      </Button>
    </div>
    {typeof document !== 'undefined' && createPortal(
      <AnimatePresence>
        {menuOpen && <motion.div
          ref={menuRef}
          id={menuId}
          className="group-context-popover"
          role="menu"
          aria-label={t('sidebar.groupMenuAria', { name: group.name })}
          style={menuPosition}
          initial="initial"
          animate="animate"
          exit="exit"
          variants={GROUP_MENU_VARIANTS}
          transition={reduceMotion ? { duration: 0.01 } : GROUP_MENU_TRANSITION}
          onKeyDown={handleMenuKeyDown}
        >
          <Button variant="ghost" size="sm" className="group-context-menu-item" role="menuitem" onClick={() => choose(onEdit)}><Pencil size={15} />{t('sidebar.editGroupAction')}</Button>
          <Button variant="ghost" size="sm" className="group-context-menu-item danger" role="menuitem" onClick={() => choose(onDelete)}><Trash2 size={15} />{t('sidebar.deleteGroupAction')}</Button>
        </motion.div>}
      </AnimatePresence>,
      document.body,
    )}
  </>;
}

function FilterTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) { return <Button variant="ghost" size="sm" className={`filter-tab ${active ? 'active' : ''}`} type="button" aria-pressed={active} onClick={onClick}>{label}</Button>; }

function ServiceRow({ service, group, runtime, resource, expanded, logs, logMeta, busy, shutdownBusy, onSelect, onDetailsExitComplete, onClose, onAction, onEdit, onDelete, onOpenUrl, tab, setTab }: { service: Service; group?: Group; runtime: RuntimeSnapshot; resource?: ResourceSnapshot; expanded: boolean; logs: LogChunk[]; logMeta?: { truncated: boolean; droppedChunks: number }; busy: boolean; shutdownBusy: boolean; onSelect: (trigger?: HTMLElement) => void; onDetailsExitComplete: () => void; onClose: () => void; onAction: (action: BatchAction) => void; onEdit: () => void; onDelete: () => void; onOpenUrl: () => void; tab: PanelTab; setTab: (tab: PanelTab) => void }) {
  const { t } = useI18n();
  const meta = statusMeta[runtime.status];
  const statusLabel = t(meta.labelKey);
  const running = runtimeIsRunning(runtime.status);
  const pending = runtimeIsTransitioning(runtime.status);
  return <article className={`service-row ${expanded ? 'selected' : ''}`} data-service-id={service.id}>
    <div className="service-row-main">
      <Button variant="ghost" size="md" className="service-row-trigger" data-service-trigger={service.id} aria-expanded={expanded} aria-controls={expanded ? `service-details-${service.id}` : undefined} whileHover={undefined} whileTap={undefined} onClick={(event) => onSelect(event.currentTarget)}>
        <div className="service-identity"><span className={`status-orb ${meta.tone}`} title={statusLabel}>{pending ? <LoaderCircle size={15} className="spin" /> : meta.icon}</span><div className="service-name"><strong>{service.name || t('service.unnamed')}</strong><span>{group?.name ?? t('service.ungrouped')}<i>·</i>{service.command ? formatCommand(service.command) : t('service.noCommand')}</span></div></div>
        <div className="service-runtime"><span className="runtime-label"><span className={`status-dot ${meta.tone}`} />{statusLabel}</span>{service.port ? <span className="port-label"><TerminalSquare size={13} />{service.port}</span> : <span className="port-label muted-label">{t('service.noPortCheck')}</span>}</div>
        <div className="service-metrics">{running && resource ? <><span><Gauge size={13} />{resource.cpuPercent === null ? '—' : `${resource.cpuPercent.toFixed(1)}%`}</span><span><Activity size={13} />{formatBytes(resource.rssBytes)}</span></> : <span className="muted-label">{runtime.error ? t('service.hasError') : t('service.waitingStart')}</span>}</div>
      </Button>
      <div className="row-actions" onClick={(event) => event.stopPropagation()}>
        <Tooltip content={t('service.edit')} side="top"><Button variant="ghost" size="icon" className="row-icon" aria-label={t('service.edit')} onClick={onEdit}><Pencil size={14} /></Button></Tooltip>
        {runtimeCanStop(runtime.status) ? <Button variant="ghost" size="sm" className="service-action stop" disabled={busy} onClick={() => onAction('stop')}><Square size={12} />{t('service.stop')}</Button> : <Button variant="ghost" size="sm" className="service-action start" disabled={busy || pending || shutdownBusy} onClick={() => onAction('start')}>{busy || pending ? <LoaderCircle size={13} className="spin" /> : <Play size={12} />}{t('service.start')}</Button>}
        <Button variant="ghost" size="icon" className="row-icon more" aria-label={expanded ? t('service.collapseDetails') : t('service.expandDetails')} aria-expanded={expanded} aria-controls={expanded ? `service-details-${service.id}` : undefined} onClick={(event) => onSelect(event.currentTarget)}><ChevronRight size={15} className={expanded ? 'expanded' : ''} /></Button>
      </div>
    </div>
    <AnimatePresence initial={false} onExitComplete={onDetailsExitComplete}>
      {expanded && <ServiceDetails key={service.id} id={`service-details-${service.id}`} service={service} runtime={runtime} resource={resource ?? null} tab={tab} setTab={setTab} logs={logs} logMeta={logMeta} shutdownBusy={shutdownBusy} onClose={onClose} onAction={onAction} onEdit={onEdit} onDelete={onDelete} onOpenUrl={onOpenUrl} />}
    </AnimatePresence>
  </article>;
}

function ServiceDetails({ id, service, runtime, resource, tab, setTab, logs, logMeta, shutdownBusy, onClose, onAction, onEdit, onDelete, onOpenUrl }: { id: string; service: Service; runtime: RuntimeSnapshot; resource: ResourceSnapshot | null; tab: PanelTab; setTab: (tab: PanelTab) => void; logs: LogChunk[]; logMeta?: { truncated: boolean; droppedChunks: number }; shutdownBusy: boolean; onClose: () => void; onAction: (action: BatchAction) => void; onEdit: () => void; onDelete: () => void; onOpenUrl: () => void }) {
  const { t } = useI18n();
  const meta = statusMeta[runtime.status];
  const statusLabel = t(meta.labelKey);
  const statusDetail = runtime.error ?? (runtime.pid ? `PID ${runtime.pid}` : null);
  const logRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const panelTransition = reduceMotion ? { duration: 0.01 } : SPRING_PANEL;
  useEffect(() => { if (tab === 'logs' && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [logs, tab]);
  return <motion.div id={id} className="service-details" role="region" aria-label={t('service.details', { name: service.name })} variants={DETAILS_VARIANTS} initial="initial" animate="animate" exit="exit" transition={panelTransition} onClick={(event) => event.stopPropagation()}>
    <div className="service-details-status"><span className={`status-orb ${meta.tone}`}>{meta.icon}</span><div className="service-details-status-copy"><strong>{statusLabel}</strong>{statusDetail && <span title={statusDetail}>{statusDetail}</span>}{runtime.exitCode !== null && <small>{t('service.exitCode', { code: runtime.exitCode })}</small>}</div><div className="service-details-controls">{runtimeCanStop(runtime.status) ? <Button variant="ghost" size="sm" className="service-details-action danger-text" disabled={shutdownBusy} onClick={() => onAction('stop')}><Square size={12} />{t('service.stop')}</Button> : <Button variant="ghost" size="sm" className="service-details-action" disabled={runtimeIsActive(runtime.status) || shutdownBusy} onClick={() => void onAction('start')}><Play size={12} />{t('service.start')}</Button>}<Button variant="ghost" size="sm" className="service-details-action" disabled={runtimeIsTransitioning(runtime.status) || shutdownBusy} onClick={() => onAction('restart')}><RefreshCw size={12} />{t('service.restart')}</Button><Button variant="ghost" size="icon" className="icon-button" onClick={onEdit} aria-label={t('service.edit')}><Pencil size={15} /></Button><Button variant="ghost" size="icon" className="icon-button danger-icon" onClick={onDelete} aria-label={t('service.delete')}><Trash2 size={15} /></Button><Button variant="ghost" size="icon" className="icon-button" onClick={onClose} aria-label={t('service.closeDetails')}><X size={17} /></Button></div></div>
    <div className="service-details-tabs" role="tablist" aria-label={t('service.details')}><Button variant="ghost" size="sm" className={tab === 'logs' ? 'active' : ''} type="button" role="tab" id={`${id}-tab-logs`} aria-selected={tab === 'logs'} aria-controls={`${id}-panel`} onClick={() => setTab('logs')}>{t('service.logs')}{logs.length ? <b>{logs.length > 99 ? '99+' : logs.length}</b> : null}</Button><Button variant="ghost" size="sm" className={tab === 'config' ? 'active' : ''} type="button" role="tab" id={`${id}-tab-config`} aria-selected={tab === 'config'} aria-controls={`${id}-panel`} onClick={() => setTab('config')}>{t('service.config')}</Button><Button variant="ghost" size="sm" className={tab === 'metrics' ? 'active' : ''} type="button" role="tab" id={`${id}-tab-metrics`} aria-selected={tab === 'metrics'} aria-controls={`${id}-panel`} onClick={() => setTab('metrics')}>{t('service.metrics')}</Button></div>
    <div className="service-details-body" id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${tab}`}>{tab === 'config' && <ConfigView service={service} onOpenUrl={onOpenUrl} />}{tab === 'logs' && <LogView logs={logs} meta={logMeta} containerRef={logRef} />}{tab === 'metrics' && <MetricsView runtime={runtime} resource={resource} />}</div>
  </motion.div>;
}

function ConfigView({ service, onOpenUrl }: { service: Service; onOpenUrl: () => void }) {
  const { t } = useI18n();
  return <div className="config-view"><InfoLine label={t('service.workdir')} value={service.workdir || t('service.notConfigured')} mono /><InfoLine label={t('service.command')} value={service.command || t('service.notConfigured')} mono /><InfoLine label={t('service.shell')} value={`${service.shell.program} ${service.shell.args.join(' ')}`} mono /><div className="info-grid"><InfoLine label={t('service.port')} value={service.port ? String(service.port) : t('service.portDisabled')} /><InfoLine label={t('service.env')} value={t('service.envCount', { count: service.env.length })} /></div>{service.url && <Button variant="ghost" size="md" className="url-link" onClick={onOpenUrl}><Globe2 size={14} />{service.url}<ArrowUpFromLine size={12} /></Button>}<div className="config-section"><div className="policy-grid"><span>{t('service.logSingleFile', { size: Math.round(service.log.maxBytes / 1024 / 1024) })}</span><span>{t('service.logHistoryFiles', { count: service.log.rotateCount })}</span><span>{t('service.logMemory', { size: Math.round(service.log.maxMemoryBytes / 1024) })}</span></div></div></div>;
}

function InfoLine({ label, value, mono }: { label: string; value: string; mono?: boolean }) { return <div className="info-line"><span>{label}</span><strong className={mono ? 'mono' : ''} title={value}>{value}</strong></div>; }

function LogView({ logs, meta, containerRef }: { logs: LogChunk[]; meta?: { truncated: boolean; droppedChunks: number }; containerRef: React.RefObject<HTMLDivElement | null> }) {
  const { locale, t } = useI18n();
  return <div className="log-view">{meta?.truncated && <div className="log-warning"><AlertCircle size={14} />{t('service.logWarning')}{meta.droppedChunks ? t('service.logDropped', { count: meta.droppedChunks }) : ''}</div>}<div className="log-console" ref={containerRef}>{logs.length ? logs.map((chunk) => <div className={`log-line ${chunk.stream}`} key={`${chunk.seq}-${chunk.timestamp}`}><span className="log-seq">{String(chunk.seq).padStart(4, '0')}</span><span className="log-time">{formatTime(chunk.timestamp, locale)}</span><span className="log-stream">{chunk.stream}</span><code>{chunk.text}</code></div>) : <div className="empty-inline"><TerminalSquare size={18} /><span>{t('service.logsEmpty')}</span></div>}</div></div>;
}

function MetricsView({ runtime, resource }: { runtime: RuntimeSnapshot; resource: ResourceSnapshot | null }) {
  const { locale, t } = useI18n();
  const cards = [{ label: t('service.cpu'), value: resource?.cpuPercent === null || resource?.cpuPercent === undefined ? '—' : `${resource.cpuPercent.toFixed(1)}%`, icon: <Gauge size={16} /> }, { label: t('service.memory'), value: formatBytes(resource?.rssBytes ?? null), icon: <Activity size={16} /> }, { label: t('service.processCount'), value: resource ? String(resource.processCount) : '—', icon: <Layers3 size={16} /> }, { label: t('service.pid'), value: runtime.pid ? String(runtime.pid) : '—', icon: <TerminalSquare size={16} /> }];
  return <div className="metrics-view"><div className="metric-cards">{cards.map((card) => <div className="metric-card" key={card.label}><span>{card.icon}</span><small>{card.label}</small><strong>{card.value}</strong></div>)}</div><div className="metric-meta"><InfoLine label={t('service.startTime')} value={formatTime(runtime.startedAt, locale)} /><InfoLine label={t('service.endTime')} value={formatTime(runtime.endedAt, locale)} /><InfoLine label={t('service.generation')} value={runtime.generation ? runtime.generation.slice(0, 16) : '—'} mono /></div>{resource && <span className="metric-updated">{t('service.sampledAt', { time: formatTime(resource.capturedAt, locale) })}</span>}</div>;
}

type EditorMode = 'json' | 'form';

function cloneServiceDraft(service: Service): Service {
  return {
    ...service,
    shell: { ...service.shell, args: [...service.shell.args] },
    env: service.env.map((item) => ({ key: item.key, value: item.value })),
    log: { ...service.log },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseServiceJson(text: string, fallback: Service, invalidMessage: string): Service {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(invalidMessage);
  }
  if (!isRecord(value) || typeof value.name !== 'string' || typeof value.workdir !== 'string' || typeof value.command !== 'string' || !isRecord(value.shell) || typeof value.shell.program !== 'string' || !Array.isArray(value.shell.args) || !value.shell.args.every((item) => typeof item === 'string') || !Array.isArray(value.env) || !isRecord(value.log)) {
    throw new Error(invalidMessage);
  }
  if (!value.env.every((item) => isRecord(item) && typeof item.key === 'string' && typeof item.value === 'string')) {
    throw new Error(invalidMessage);
  }
  if (!Number.isInteger(value.log.maxBytes) || !Number.isInteger(value.log.rotateCount) || !Number.isInteger(value.log.maxMemoryBytes)) {
    throw new Error(invalidMessage);
  }
  const groupId = value.groupId === null || typeof value.groupId === 'string' ? value.groupId : fallback.groupId;
  const port = value.port === null || Number.isInteger(value.port) ? value.port : fallback.port;
  const url = value.url === null || typeof value.url === 'string' ? value.url : fallback.url;
  return {
    id: typeof value.id === 'string' ? value.id : fallback.id,
    name: value.name,
    groupId,
    workdir: value.workdir,
    command: value.command,
    shell: { program: value.shell.program, args: value.shell.args as string[] },
    env: value.env.map((item) => ({ key: (item as Record<string, string>).key, value: (item as Record<string, string>).value })),
    port: port as number | null,
    url: url as string | null,
    log: { maxBytes: value.log.maxBytes as number, rotateCount: value.log.rotateCount as number, maxMemoryBytes: value.log.maxMemoryBytes as number },
  };
}

function ServiceEditor({ initial, isNew, groups, busy, onCancel, onSubmit }: { initial: Service; isNew: boolean; groups: Group[]; busy: boolean; onCancel: () => void; onSubmit: (service: Service) => void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Service>(() => cloneServiceDraft(initial));
  const [mode, setMode] = useState<EditorMode>('json');
  const [jsonText, setJsonText] = useState(() => JSON.stringify(cloneServiceDraft(initial), null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const update = <K extends keyof Service>(key: K, value: Service[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const updateEnv = (index: number, patch: Partial<EnvVar>) => setDraft((current) => ({ ...current, env: current.env.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) }));
  const switchMode = (nextMode: EditorMode) => {
    if (nextMode === mode) return;
    if (nextMode === 'form') {
      try {
        setDraft(parseServiceJson(jsonText, draft, t('editor.jsonInvalid')));
        setJsonError(null);
        setMode('form');
      } catch (error) {
        setJsonError(error instanceof Error ? error.message : t('editor.jsonInvalid'));
      }
      return;
    }
    setJsonText(JSON.stringify(cloneServiceDraft(draft), null, 2));
    setJsonError(null);
    setMode('json');
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mode === 'json') {
      try {
        onSubmit(parseServiceJson(jsonText, draft, t('editor.jsonInvalid')));
      } catch (error) {
        setJsonError(error instanceof Error ? error.message : t('editor.jsonInvalid'));
      }
      return;
    }
    onSubmit(draft);
  };
  return <Modal title={isNew ? t('editor.addTitle') : t('editor.editTitle')} subtitle={t('editor.subtitle')} blocked={busy} onClose={onCancel} wide>
    <form className="editor-form" onSubmit={submit}>
      <div className="editor-mode-switch" role="tablist" aria-label={t('editor.mode')}>
        <span>{t('editor.mode')}</span>
        <div className="editor-mode-tabs">
          <Button variant="ghost" size="sm" className={mode === 'json' ? 'active' : ''} type="button" role="tab" aria-selected={mode === 'json'} onClick={() => switchMode('json')}><Braces size={14} />{t('editor.jsonMode')}</Button>
          <Button variant="ghost" size="sm" className={mode === 'form' ? 'active' : ''} type="button" role="tab" aria-selected={mode === 'form'} onClick={() => switchMode('form')}><List size={14} />{t('editor.formMode')}</Button>
        </div>
      </div>
      {mode === 'json' ? <div className="json-editor-wrap"><textarea className="json-editor" value={jsonText} onChange={(event) => { setJsonText(event.target.value); setJsonError(null); }} spellCheck={false} aria-label={t('editor.jsonMode')} />{jsonError && <p className="json-editor-error">{jsonError}</p>}</div> : <>
      <div className="form-grid two">
        <Field label={t('editor.serviceName')} required><input value={draft.name} onChange={(event) => update('name', event.target.value)} placeholder={t('editor.serviceNamePlaceholder')} autoFocus /></Field>
        <Field label={t('editor.project')}><Select value={draft.groupId ?? ''} disabled={busy} onValueChange={(value) => update('groupId', value || null)}><SelectTrigger aria-label={t('editor.project')}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="">{t('service.ungrouped')}</SelectItem>{groups.map((group) => <SelectItem value={group.id} key={group.id}>{group.name}</SelectItem>)}</SelectContent></Select></Field>
      </div>
      <Field label={t('editor.workingDirectory')} required hint={t('editor.workingDirectoryHint')}><div className="input-with-icon"><input value={draft.workdir} onChange={(event) => update('workdir', event.target.value)} placeholder={t('editor.workingDirectoryPlaceholder')} /><FolderOpen size={15} /></div></Field>
      <Field label={t('editor.startCommand')} required><div className="command-input"><span>$</span><input value={draft.command} onChange={(event) => update('command', event.target.value)} placeholder={t('editor.commandPlaceholder')} /></div></Field>
      <div className="form-grid two">
        <Field label={t('editor.port')} hint={t('editor.portHint')}><input type="number" min="1" max="65535" value={draft.port ?? ''} onChange={(event) => update('port', event.target.value ? Number(event.target.value) : null)} placeholder={t('editor.optional')} /></Field>
        <Field label={t('editor.url')} hint={t('editor.urlHint')}><input value={draft.url ?? ''} onChange={(event) => update('url', event.target.value || null)} placeholder="http://localhost:3000" /></Field>
      </div>
      <div className="form-section">
        <div className="form-section-head"><div><strong>{t('editor.envTitle')}</strong><span>{t('editor.envDescription')}</span></div><Button variant="ghost" size="sm" className="form-action" type="button" onClick={() => setDraft((current) => ({ ...current, env: [...current.env, { key: '', value: '' }] }))}><Plus size={14} />{t('editor.addVariable')}</Button></div>
        {draft.env.length ? <div className="env-list">{draft.env.map((item, index) => <div className="env-row" key={`${index}-${item.key}`}><input value={item.key} onChange={(event) => updateEnv(index, { key: event.target.value })} placeholder={t('editor.keyPlaceholder')} /><input value={item.value} onChange={(event) => updateEnv(index, { value: event.target.value })} placeholder={t('editor.valuePlaceholder')} /><Button variant="ghost" size="icon" className="icon-button" type="button" onClick={() => setDraft((current) => ({ ...current, env: current.env.filter((_, itemIndex) => itemIndex !== index) }))} aria-label={t('editor.deleteVariable')}><X size={14} /></Button></div>)}</div> : <div className="form-empty">{t('editor.envEmpty')}</div>}
      </div>
      <Button variant="ghost" size="md" className="advanced-toggle" type="button" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}><ChevronDown size={15} className={advanced ? 'rotate' : ''} />{t('editor.advanced')}<span>{t('editor.advancedDescription')}</span></Button>
      {advanced && <div className="advanced-panel"><div className="form-grid two"><Field label={t('editor.shellProgram')}><input value={draft.shell.program} onChange={(event) => update('shell', { ...draft.shell, program: event.target.value })} /></Field><Field label={t('editor.shellArgs')}><input value={draft.shell.args.join(' ')} onChange={(event) => update('shell', { ...draft.shell, args: event.target.value.split(' ').filter(Boolean) })} /></Field></div><div className="form-grid three"><Field label={t('editor.singleFileLimit')}><input type="number" min={64 * 1024} max={16 * 1024 * 1024} value={draft.log.maxBytes} onChange={(event) => update('log', { ...draft.log, maxBytes: Number(event.target.value) })} /></Field><Field label={t('editor.rotateCount')}><input type="number" min="1" max="10" value={draft.log.rotateCount} onChange={(event) => update('log', { ...draft.log, rotateCount: Number(event.target.value) })} /></Field><Field label={t('editor.memoryLimit')}><input type="number" min={64 * 1024} max={4 * 1024 * 1024} value={draft.log.maxMemoryBytes} onChange={(event) => update('log', { ...draft.log, maxMemoryBytes: Number(event.target.value) })} /></Field></div><p className="field-note">{t('editor.advancedNote')}</p></div>}
      </>}
      <div className="modal-actions"><Button variant="outline" size="sm" type="button" onClick={onCancel}>{t('editor.cancel')}</Button><Button variant="primary" size="sm" type="submit" disabled={busy}>{busy ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />} {busy ? t('editor.saving') : t('editor.saveService')}</Button></div>
    </form>
  </Modal>;
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) { return <label className="field"><span>{label}{required && <i>*</i>}{hint && <small>{hint}</small>}</span>{children}</label>; }

function GroupEditor({ initial, busy, onCancel, onDelete, onSubmit }: { initial: Group | null; busy: boolean; onCancel: () => void; onDelete?: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const { t } = useI18n();
  return <Modal title={initial ? t('groupEditor.editTitle') : t('groupEditor.newTitle')} subtitle={t('groupEditor.subtitle')} blocked={busy} onClose={onCancel}>
    <form className="editor-form" onSubmit={onSubmit}>
      <Field label={t('groupEditor.name')} required><input name="name" defaultValue={initial?.name ?? ''} placeholder={t('groupEditor.placeholder')} autoFocus /></Field>
      <div className="modal-actions">{onDelete && <Button variant="ghost" size="sm" className="danger-action" type="button" onClick={onDelete}><Trash2 size={14} />{t('groupEditor.delete')}</Button>}<span className="actions-spacer" /><Button variant="outline" size="sm" type="button" onClick={onCancel}>{t('editor.cancel')}</Button><Button variant="primary" size="sm" type="submit" disabled={busy}>{busy ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />} {busy ? t('editor.saving') : t('editor.save')}</Button></div>
    </form>
  </Modal>;
}

function ImportDialog({ preview, canApply, busy, onCancel, onApply }: { preview: ImportPreview; canApply: boolean; busy: boolean; onCancel: () => void; onApply: () => void }) {
  const { t } = useI18n();
  return <Modal title={t('import.title')} subtitle={t('import.subtitle')} blocked={busy} onClose={onCancel}>
    <div className="import-preview">
      <div className="preview-summary"><div><strong>{preview.groupCount}</strong><span>{t('import.groups')}</span></div><div><strong>{preview.serviceCount}</strong><span>{t('import.services')}</span></div><div><strong>{preview.changes.addedServices + preview.changes.removedServices}</strong><span>{t('import.changes')}</span></div></div>
      {preview.errors.length ? <div className="preview-errors">{preview.errors.map((message) => <div key={message}><AlertCircle size={15} />{message}</div>)}</div> : <div className="preview-ok"><Check size={15} />{t('import.valid')}</div>}
      {preview.warnings.map((message) => <div className="preview-warning" key={message}><AlertCircle size={15} />{message}</div>)}
      {!canApply && !preview.errors.length && <div className="preview-warning"><Info size={15} />{t('import.blocked')}</div>}
      <p className="import-note"><FileJson size={15} />{t('import.note')}</p>
    </div>
    <div className="modal-actions"><Button variant="outline" size="sm" type="button" onClick={onCancel}>{t('editor.cancel')}</Button><Button variant="primary" size="sm" type="button" disabled={!canApply || busy} onClick={onApply}>{busy ? <LoaderCircle size={15} className="spin" /> : <ArrowDownToLine size={15} />} {busy ? t('import.applying') : t('import.apply')}</Button></div>
  </Modal>;
}

function Modal({ title, subtitle, onClose, blocked, wide, children }: { title: string; subtitle?: string; onClose: () => void; blocked?: boolean; wide?: boolean; children: React.ReactNode }) {
  const { dialogRef, onKeyDown } = useDialogFocus();
  const reduceMotion = useReducedMotion();
  const fadeTransition = reduceMotion ? { duration: 0.01 } : FADE_TRANSITION;
  const panelTransition = reduceMotion ? { duration: 0.01 } : SPRING_PANEL;
  const { t } = useI18n();
  return <motion.div className="modal-backdrop" role="presentation" variants={MODAL_BACKDROP_VARIANTS} initial="initial" animate="animate" exit="exit" transition={fadeTransition} onMouseDown={(event) => { if (event.target === event.currentTarget && !blocked) onClose(); }}><motion.section ref={dialogRef} className={`modal ${wide ? 'wide' : ''}`} variants={MODAL_VARIANTS} initial="initial" animate="animate" exit="exit" transition={panelTransition} role="dialog" aria-modal="true" aria-label={title} onKeyDown={onKeyDown}><div className="modal-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><Button variant="ghost" size="icon" className="icon-button" onClick={onClose} aria-label={t('common.close')} disabled={blocked}><X size={17} /></Button></div><fieldset disabled={blocked} className="modal-content-lock">{children}</fieldset></motion.section></motion.div>;
}

function EmptyState({ hasConfig, onAdd, onClear }: { hasConfig: boolean; onAdd: () => void; onClear: () => void }) {
  const { t } = useI18n();
  return <div className="empty-state"><div className="empty-icon">{hasConfig ? <Search size={22} /> : <Server size={22} />}</div><h2>{hasConfig ? t('empty.noMatchTitle') : t('empty.startTitle')}</h2><p>{hasConfig ? t('empty.noMatchDescription') : t('empty.startDescription')}</p>{hasConfig ? <Button variant="outline" size="sm" onClick={onClear}>{t('empty.clearFilters')}</Button> : <Button variant="primary" size="sm" onClick={onAdd}><Plus size={15} />{t('empty.addFirst')}</Button>}</div>;
}
function LoadingState() {
  const { t } = useI18n();
  return <div className="loading-state"><LoaderCircle size={18} className="spin" />{t('loading.config')}</div>;
}
function DesktopPrompt() {
  const { t } = useI18n();
  return <div className="desktop-prompt"><div className="desktop-prompt-card"><BrandMark large /><h1>{t('desktop.title')}</h1><p>{t('desktop.description')}</p><div className="prompt-note"><Info size={15} />{t('desktop.note')}</div></div></div>;
}
function errorText(reason: unknown, t: Translator) { return reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : t('error.operationFailed'); }

export default App;
