import { useEffect, useMemo, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from './components/ui/select';
import { inTauri } from './api';

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
      notify?.(`无法同步原生窗口主题：${reason instanceof Error ? reason.message : '请检查桌面权限'}`, 'error');
    });
  }, [mode, notify]);

  const changeMode = (next: ThemeMode) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      notify?.('主题已切换，但本机无法保存偏好；下次启动将跟随系统', 'info');
    }
    setMode(next);
  };

  return useMemo(() => ({ mode, resolved, changeMode }), [mode, resolved]);
}

export default function ThemeControl({ mode, onChange }: { mode: ThemeMode; onChange: (mode: ThemeMode) => void }) {
  return (
    <div className="theme-control">
      <span className="theme-description"><strong>主题</strong><small>选择外观，偏好会自动保存</small></span>
      <Select value={mode} onValueChange={(value) => onChange(value as ThemeMode)}>
        <SelectTrigger aria-label="选择主题"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="system">跟随系统</SelectItem>
          <SelectItem value="light">浅色</SelectItem>
          <SelectItem value="dark">深色</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
