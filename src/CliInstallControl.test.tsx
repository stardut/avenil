import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import CliInstallControl from './CliInstallControl';
import { I18nProvider } from './i18n';
import type { CliInstallInfo } from './types';

const info: CliInstallInfo = {
  supported: true,
  installed: false,
  pathConfigured: false,
  linkPath: '~/.local/bin/avenil',
  executablePath: '/Applications/Avenil.app/Contents/MacOS/avenil',
  installCommand: 'ln -s app ~/.local/bin/avenil',
  pathCommand: 'export PATH="$HOME/.local/bin:$PATH"',
  reloadCommand: 'source "$HOME/.zprofile"',
  conflict: null,
};

function renderControl(props: Partial<React.ComponentProps<typeof CliInstallControl>> = {}) {
  return render(
    <I18nProvider>
      <CliInstallControl
        info={info}
        busy={false}
        onInstall={vi.fn()}
        onCopyError={vi.fn()}
        {...props}
      />
    </I18nProvider>,
  );
}

describe('CliInstallControl', () => {
  it('shows a retry action when loading CLI information fails', () => {
    const onRetry = vi.fn();
    renderControl({ info: null, error: 'CLI unavailable', onRetry });

    expect(screen.getByText('CLI unavailable')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('disables installation when the target path conflicts and exposes copy actions', () => {
    const onInstall = vi.fn();
    renderControl({ info: { ...info, conflict: '~/.local/bin/avenil' }, onInstall });

    expect(screen.getByText(/Another file already occupies/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Install CLI' })).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Copy command' })).toHaveLength(3);
    expect(onInstall).not.toHaveBeenCalled();
  });
});
