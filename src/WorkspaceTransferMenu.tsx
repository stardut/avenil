import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowDownToLine, ArrowDownUp, ArrowUpFromLine, ChevronDown, FileCode2 } from 'lucide-react';
import { Button } from './components/ui/button';
import { useDismiss } from './lib/hooks/use-dismiss';
import { EASE_OUT } from './lib/ease';
import { useI18n } from './i18n';

type Props = {
  onIdeImport: () => void;
  onImportConfig: () => void;
  onExportConfig: () => void;
};

const MENU_VARIANTS = {
  initial: { opacity: 0, y: 6, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 4, scale: 0.98 },
};

const MENU_TRANSITION = { duration: 0.16, ease: EASE_OUT } as const;
const FOCUSABLE_SELECTOR = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export default function WorkspaceTransferMenu({ onIdeImport, onImportConfig, onExportConfig }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const reduceMotion = useReducedMotion();
  const close = useCallback(() => setOpen(false), []);

  useDismiss(open, close, menuRef, { behavior: 'consume', escape: false });

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const choose = useCallback((action: () => void) => {
    setOpen(false);
    triggerRef.current?.focus();
    action();
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      const focusable = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => element.isConnected && element.getClientRects().length);
      const menuItems = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
      const boundary = event.shiftKey ? triggerRef.current : menuItems[menuItems.length - 1];
      const boundaryIndex = boundary ? focusable.indexOf(boundary) : -1;
      const targetIndex = event.shiftKey ? boundaryIndex - 1 : boundaryIndex + 1;
      const target = focusable[targetIndex] ?? triggerRef.current;
      setOpen(false);
      target?.focus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (!items.length) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[nextIndex]?.focus();
  };

  return <div className="transfer-menu" ref={menuRef}>
    <Button
      ref={triggerRef}
      variant="ghost"
      size="sm"
      className={`sidebar-action transfer-trigger ${open ? 'open' : ''}`}
      type="button"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls="workspace-transfer-menu"
      onClick={() => setOpen((current) => !current)}
    >
      <span className="transfer-trigger-content"><ArrowDownUp size={16} /><span>{t('transfer.trigger')}</span></span>
      <ChevronDown size={14} aria-hidden="true" />
    </Button>
    <AnimatePresence initial={false}>
      {open && <motion.div
        id="workspace-transfer-menu"
        className="transfer-popover"
        role="menu"
        aria-label={t('transfer.menuAria')}
        variants={MENU_VARIANTS}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={reduceMotion ? { duration: 0.01 } : MENU_TRANSITION}
        onKeyDown={handleKeyDown}
      >
        <span className="transfer-popover-label">{t('transfer.section')}</span>
        <TransferMenuItem icon={<FileCode2 size={15} />} label={t('transfer.importIde')} hint={t('transfer.importIdeHint')} onClick={() => choose(onIdeImport)} />
        <TransferMenuItem icon={<ArrowDownToLine size={15} />} label={t('transfer.importConfig')} hint={t('transfer.importConfigHint')} onClick={() => choose(onImportConfig)} />
        <div className="transfer-popover-separator" role="separator" />
        <TransferMenuItem icon={<ArrowUpFromLine size={15} />} label={t('transfer.exportConfig')} hint={t('transfer.exportConfigHint')} onClick={() => choose(onExportConfig)} />
      </motion.div>}
    </AnimatePresence>
  </div>;
}

function TransferMenuItem({ icon, label, hint, onClick }: { icon: React.ReactNode; label: string; hint: string; onClick: () => void }) {
  return <Button variant="ghost" size="sm" className="transfer-menu-item" role="menuitem" onClick={onClick}>
    <span className="transfer-menu-item-icon">{icon}</span>
    <span className="transfer-menu-item-copy"><strong>{label}</strong><small>{hint}</small></span>
  </Button>;
}
