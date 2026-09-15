import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, ChevronRight, FileCode2, FolderOpen, Info, LoaderCircle, X } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import type { Candidate, IdeImportInput, IdeImportPreview } from './types';
import { useDialogFocus } from './useDialogFocus';
import { Button } from './components/ui/button';
import { Tooltip } from './components/ui/tooltip';
import { EASE_OUT, SPRING_PANEL } from './lib/ease';

type Props = {
  preview: IdeImportPreview | null;
  busy: boolean;
  blockedReason: string | null;
  onChooseProjectDirectory: () => Promise<string | null>;
  onPreview: (input: IdeImportInput) => void;
  onApply: (preview: IdeImportPreview, selectedIds: string[], groupName: string) => void;
  onClearPreview: () => void;
  onClose: () => void;
};

const statusMeta = {
  ready: { label: '可导入', className: 'ready' },
  needsInput: { label: '需要补充', className: 'needs-input' },
  unsupported: { label: '不支持', className: 'unsupported' },
} as const;

const IDE_BACKDROP_VARIANTS = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0, pointerEvents: 'none' as const },
};

const IDE_MODAL_VARIANTS = {
  initial: { opacity: 0, y: 12, scale: 0.98, filter: 'blur(4px)' },
  animate: { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' },
  exit: { opacity: 0, y: 7, scale: 0.985, filter: 'blur(3px)' },
};

const IDE_FADE_TRANSITION = { duration: 0.18, ease: EASE_OUT } as const;

export default function IdeImportDialog({ preview, busy, blockedReason, onChooseProjectDirectory, onPreview, onApply, onClearPreview, onClose }: Props) {
  const { dialogRef, onKeyDown } = useDialogFocus();
  const reduceMotion = useReducedMotion();
  const fadeTransition = reduceMotion ? { duration: 0.01 } : IDE_FADE_TRANSITION;
  const panelTransition = reduceMotion ? { duration: 0.01 } : SPRING_PANEL;
  const [projectRoot, setProjectRoot] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [groupName, setGroupName] = useState('');
  const [pickingDirectory, setPickingDirectory] = useState(false);

  useEffect(() => {
    if (!preview) {
      setSelectedIds([]);
      setGroupName('');
      return;
    }
    setProjectRoot(preview.projectRoot);
    setSelectedIds(preview.candidates.filter((candidate) => candidate.status === 'ready').map((candidate) => candidate.id));
    setGroupName(preview.suggestedGroupName);
  }, [preview]);

  const selectedCount = selectedIds.length;
  const readyCandidates = useMemo(() => preview?.candidates.filter((candidate) => candidate.status === 'ready') ?? [], [preview]);
  const canPreview = projectRoot.trim().startsWith('/');
  const canApply = Boolean(preview && selectedCount && groupName.trim() && !busy && !pickingDirectory && !blockedReason);

  const updateProjectRoot = (value: string) => {
    setProjectRoot(value);
    onClearPreview();
  };

  const submitPreview = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canPreview || busy) return;
    onClearPreview();
    onPreview({ projectRoot: projectRoot.trim() });
  };

  const chooseProjectDirectory = async () => {
    if (busy || pickingDirectory) return;
    setPickingDirectory(true);
    try {
      const selected = await onChooseProjectDirectory();
      if (!selected) return;
      setProjectRoot(selected);
      onClearPreview();
      onPreview({ projectRoot: selected });
    } finally {
      setPickingDirectory(false);
    }
  };

  const toggleCandidate = (candidate: Candidate) => {
    if (candidate.status !== 'ready' || busy) return;
    setSelectedIds((current) => current.includes(candidate.id) ? current.filter((id) => id !== candidate.id) : [...current, candidate.id]);
  };

  return <motion.div className="modal-backdrop" role="presentation" variants={IDE_BACKDROP_VARIANTS} initial="initial" animate="animate" exit="exit" transition={fadeTransition} onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <motion.section ref={dialogRef} className="modal wide ide-import-modal" variants={IDE_MODAL_VARIANTS} initial="initial" animate="animate" exit="exit" transition={panelTransition} role="dialog" aria-modal="true" aria-label="从 IDE 导入" onKeyDown={onKeyDown}>
      <div className="modal-head">
        <div><h2>从 IDE 导入</h2><p>读取普通运行配置，追加到 Avenil 项目组</p></div>
        <Tooltip content="关闭导入" side="left"><Button variant="ghost" size="icon" className="icon-button" onClick={onClose} aria-label="关闭" disabled={busy}><X size={17} /></Button></Tooltip>
      </div>
      <fieldset disabled={busy} className="modal-content-lock">
      <div className="ide-import-body">
        <div className="ide-import-notice"><FileCode2 size={15} /><span>选择项目根目录后，Avenil 会自动查找 VS Code 和 JetBrains 的运行配置；仅导入普通运行配置，不提供调试。</span></div>
        <form className="ide-path-form" onSubmit={submitPreview}>
          <label className="field"><span>项目根目录 <i>*</i><small>Avenil 将从目录下的 .vscode、.idea 或 .run 中查找配置</small></span><div className="ide-root-picker"><input value={projectRoot} onChange={(event) => updateProjectRoot(event.target.value)} placeholder="/Users/you/project" autoFocus disabled={busy || pickingDirectory} aria-label="项目根目录" /><Button variant="outline" size="sm" type="button" onClick={() => void chooseProjectDirectory()} disabled={busy || pickingDirectory}>{pickingDirectory ? <LoaderCircle size={14} className="spin" /> : <FolderOpen size={14} />}选择目录</Button></div></label>
          <div className="ide-path-actions"><span>{!projectRoot ? '请选择项目根目录' : !canPreview ? '请输入以 / 开头的绝对路径' : preview ? '已找到配置，可继续确认导入' : '准备自动查找 IDE 配置'}</span><Button variant="outline" size="sm" type="submit" disabled={!canPreview || busy || pickingDirectory}>{busy && !preview ? <LoaderCircle size={14} className="spin" /> : <ChevronRight size={14} />}查找配置</Button></div>
        </form>

        {preview && <div className="ide-preview">
          <div className="ide-preview-head"><div><strong>已发现 {preview.sources.length} 个 IDE 配置文件</strong><div className="ide-source-list">{preview.sources.map((source) => <span key={source.path}><b>{source.kind === 'vscode' ? 'VS Code' : 'JetBrains'}</b><code>{source.path}</code></span>)}</div></div><span className="ide-demo-label">{preview.warnings.some((warning) => warning.startsWith('演示数据')) ? '浏览器演示数据' : '本机配置'}</span></div>
          <div className="ide-meta"><span>项目根目录 <code>{preview.projectRoot}</code></span><label>目标项目组<input value={groupName} onChange={(event) => setGroupName(event.target.value)} /></label></div>
          <div className="ide-candidate-list">{preview.candidates.map((candidate) => <CandidateRow key={candidate.id} candidate={candidate} checked={selectedIds.includes(candidate.id)} onToggle={() => toggleCandidate(candidate)} />)}</div>
          {preview.warnings.map((warning) => <div className="ide-warning" key={warning}><Info size={14} />{warning}</div>)}
          {blockedReason && <div className="ide-warning blocked"><AlertCircle size={14} />{blockedReason}</div>}
        </div>}
      </div>
      <div className="modal-actions ide-import-actions"><Button variant="outline" size="sm" type="button" onClick={onClose} disabled={busy}>取消</Button><span className="actions-spacer" /><span className="ide-selection-count">{preview ? `${selectedCount}/${readyCandidates.length} 个可导入配置` : '尚未读取预览'}</span><Button variant="primary" size="sm" type="button" disabled={!canApply} onClick={() => preview && onApply(preview, selectedIds, groupName.trim())}>{busy ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}添加到 Avenil</Button></div>
      </fieldset>
    </motion.section>
  </motion.div>;
}

function CandidateRow({ candidate, checked, onToggle }: { candidate: Candidate; checked: boolean; onToggle: () => void }) {
  const meta = statusMeta[candidate.status];
  const service = candidate.service;
  return <article className={`ide-candidate ${meta.className}`}>
    <label className="ide-candidate-main"><input type="checkbox" checked={checked} disabled={candidate.status !== 'ready'} onChange={onToggle} /><span><strong>{candidate.name}</strong><small>{service ? `${service.workdir} · ${service.command}` : candidate.warnings[0] || '无法转换为普通运行服务'}</small>{service?.env.length ? <em>环境变量：{service.env.map((item) => item.key).join('、')}</em> : null}{candidate.warnings.slice(1).map((warning) => <em key={warning}>{warning}</em>)}{candidate.missing.length ? <em className="missing">缺少：{candidate.missing.join('、')}</em> : null}</span></label><span className={`ide-status ${meta.className}`}>{meta.label}</span>
  </article>;
}
