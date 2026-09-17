import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import WorkspaceTransferMenu from './WorkspaceTransferMenu';
import { I18nProvider } from './i18n';

describe('WorkspaceTransferMenu', () => {
  it('opens the three transfer actions and invokes the selected callback', () => {
    const onIdeImport = vi.fn();
    const onImportConfig = vi.fn();
    const onExportConfig = vi.fn();
    render(
      <I18nProvider>
        <WorkspaceTransferMenu onIdeImport={onIdeImport} onImportConfig={onImportConfig} onExportConfig={onExportConfig} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Import / Export' }));
    expect(screen.getByRole('menu', { name: 'Import and export actions' })).toBeTruthy();
    expect(screen.getAllByRole('menuitem')).toHaveLength(3);

    fireEvent.click(screen.getByRole('menuitem', { name: /Import from IDE/ }));
    expect(onIdeImport).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Import / Export' })).toHaveAttribute('aria-expanded', 'false');
  });
});
