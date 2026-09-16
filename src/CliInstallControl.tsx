import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Info, LoaderCircle, TerminalSquare } from 'lucide-react';
import { Button } from './components/ui/button';
import { useI18n } from './i18n';
import type { CliInstallInfo } from './types';

type CliInstallControlProps = {
  info: CliInstallInfo | null;
  error?: string | null;
  busy: boolean;
  onInstall: () => void;
  onRetry?: () => void;
  onCopyError: () => void;
};

export default function CliInstallControl({ info, error, busy, onInstall, onRetry, onCopyError }: CliInstallControlProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState<string | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
  }, []);

  const copyCommand = async (command: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(command);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = command;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const copiedSuccessfully = document.execCommand('copy');
        textarea.remove();
        if (!copiedSuccessfully) throw new Error('copy failed');
      }
      setCopied(command);
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => {
        setCopied(null);
        copyTimerRef.current = null;
      }, 1800);
    } catch {
      onCopyError();
    }
  };

  if (!info && error) {
    return <div className="cli-install-panel cli-install-error"><div><Info size={16} /><span>{error}</span></div>{onRetry && <Button variant="outline" size="sm" type="button" onClick={onRetry}>{t('error.retry')}</Button>}</div>;
  }

  if (!info) {
    return <div className="cli-install-panel cli-install-loading"><LoaderCircle size={16} className="spin" />{t('settings.cli.loading')}</div>;
  }

  if (!info.supported) {
    return <div className="cli-install-panel cli-install-unavailable"><Info size={16} />{t('settings.cli.unsupported')}</div>;
  }

  return (
    <section className="cli-install-panel">
      <div className="cli-install-intro">
        <span className="cli-install-icon"><TerminalSquare size={17} /></span>
        <div>
          <strong>{t('settings.cli.title')}</strong>
          <p>{t('settings.cli.description')}</p>
        </div>
      </div>
      <div className="cli-install-target">
        <span>{t('settings.cli.target')}</span>
        <code>{info.linkPath}</code>
      </div>
      {info.conflict && <div className="cli-install-warning"><Info size={15} />{t('settings.cli.conflict', { path: info.conflict })}</div>}
      {info.installed ? (
        <div className="cli-install-status success"><Check size={15} />{t('settings.cli.installed')}</div>
      ) : (
        <Button variant="primary" size="sm" type="button" disabled={busy || Boolean(info.conflict)} onClick={onInstall}>
          {busy ? <LoaderCircle size={15} className="spin" /> : <TerminalSquare size={15} />}
          {busy ? t('settings.cli.installing') : t('settings.cli.install')}
        </Button>
      )}
      <CommandBlock label={t('settings.cli.installCommand')} command={info.installCommand} copied={copied === info.installCommand} onCopy={() => void copyCommand(info.installCommand)} copyLabel={t('settings.cli.copyCommand')} />
      {info.pathConfigured ? (
        <div className="cli-install-status success"><Check size={15} />{t('settings.cli.pathConfigured')}</div>
      ) : (
        <>
          <div className="cli-install-note"><Info size={15} />{t('settings.cli.pathNotConfigured')}</div>
          <CommandBlock label={t('settings.cli.pathCommand')} command={info.pathCommand} copied={copied === info.pathCommand} onCopy={() => void copyCommand(info.pathCommand)} copyLabel={t('settings.cli.copyCommand')} />
          <CommandBlock label={t('settings.cli.reloadCommand')} command={info.reloadCommand} copied={copied === info.reloadCommand} onCopy={() => void copyCommand(info.reloadCommand)} copyLabel={t('settings.cli.copyCommand')} />
        </>
      )}
    </section>
  );
}

function CommandBlock({ label, command, copied, onCopy, copyLabel }: { label: string; command: string; copied: boolean; onCopy: () => void; copyLabel: string }) {
  return <div className="cli-command"><div className="cli-command-head"><span>{label}</span><Button variant="ghost" size="icon" className="icon-button" type="button" aria-label={copyLabel} onClick={onCopy}>{copied ? <Check size={14} /> : <Copy size={14} />}</Button></div><pre><code>{command}</code></pre></div>;
}
