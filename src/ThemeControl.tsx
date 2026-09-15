import { useEffect, useMemo, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from './components/ui/select';
import { inTauri } from './api';
import { LANGUAGE_OPTIONS, useI18n, type LanguagePreference } from './i18n';

export type ThemeMode = 'system' | 'light' | 'dark';

// This storage key survives the Avenil rebrand to retain the user's preference.
const STORAGE_KEY = 'rundock.theme-mode';

function readThemeMode(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
  } catch {
    return 'system';
  }
}

function useSystemDark() {
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return;
    const update = () => setSystemDark(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);

  return systemDark;
}

export function useTheme(notify?: (message: string, tone?: 'error' | 'success' | 'info') => void) {
  const { t } = useI18n();
  const [mode, setMode] = useState<ThemeMode>(readThemeMode);
  const systemDark = useSystemDark();
  const resolved = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute('content', resolved === 'dark' ? '#151515' : '#ffffff');
  }, [resolved]);

  useEffect(() => {
    if (!inTauri) return;
    void getCurrentWindow().setTheme(mode === 'system' ? null : mode).catch((reason: unknown) => {
      notify?.(t('error.nativeTheme', { reason: reason instanceof Error ? reason.message : t('error.operationFailed') }), 'error');
    });
  }, [mode, notify, t]);

  const changeMode = (next: ThemeMode) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      notify?.(t('error.themeNotSaved'), 'info');
    }
    setMode(next);
  };

  return useMemo(() => ({ mode, resolved, changeMode }), [mode, resolved]);
}

export default function ThemeControl({ mode, onChange }: { mode: ThemeMode; onChange: (mode: ThemeMode) => void }) {
  const { t } = useI18n();
  return (
    <div className="theme-control">
      <span className="theme-description"><strong>{t('settings.theme')}</strong><small>{t('settings.themeDescription')}</small></span>
      <Select value={mode} onValueChange={(value) => onChange(value as ThemeMode)}>
        <SelectTrigger aria-label={t('settings.theme')}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="system">{t('settings.theme.system')}</SelectItem>
          <SelectItem value="light">{t('settings.theme.light')}</SelectItem>
          <SelectItem value="dark">{t('settings.theme.dark')}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

export function LanguageControl() {
  const { language, changeLanguage, t } = useI18n();
  return (
    <div className="theme-control language-control">
      <span className="theme-description"><strong>{t('settings.language')}</strong><small>{t('settings.languageDescription')}</small></span>
      <Select value={language} onValueChange={(value) => changeLanguage(value as LanguagePreference)}>
        <SelectTrigger aria-label={t('settings.language')}><SelectValue /></SelectTrigger>
        <SelectContent>
          {LANGUAGE_OPTIONS.map((option) => <SelectItem value={option.value} key={option.value}>{t(option.labelKey)}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
