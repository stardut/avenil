import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import IdeImportDialog from './IdeImportDialog';
import { I18nProvider } from './i18n';
import type { Candidate, IdeImportPreview, Service } from './types';

const service: Service = {
  id: 'service-web',
  name: 'Web',
  groupId: null,
  workdir: '/workspace/demo',
  command: 'pnpm dev',
  shell: { program: '/bin/zsh', args: ['-lc'] },
  env: [],
  port: null,
  url: null,
  log: { maxBytes: 2 * 1024 * 1024, rotateCount: 3, maxMemoryBytes: 4 * 1024 * 1024 },
};

const candidate = (overrides: Partial<Candidate>): Candidate => ({
  id: 'candidate-ready',
  name: 'Web',
  status: 'ready',
  service,
  warnings: [],
  missing: [],
  ...overrides,
});

const preview: IdeImportPreview = {
  snapshotId: 'preview-1',
  projectRoot: '/workspace/demo',
  sources: [{ path: '/workspace/demo/.vscode/launch.json', kind: 'vscode' }],
  suggestedGroupName: 'demo',
  candidates: [
    candidate({}),
    candidate({ id: 'candidate-unsupported', name: 'Debugger', status: 'unsupported', service: null, warnings: ['debug only'] }),
  ],
  warnings: [],
};

function renderDialog(props: Partial<React.ComponentProps<typeof IdeImportDialog>> = {}) {
  return render(
    <I18nProvider>
      <IdeImportDialog
        preview={null}
        busy={false}
        blockedReason={null}
        onChooseProjectDirectory={vi.fn(async () => null)}
        onPreview={vi.fn()}
        onApply={vi.fn()}
        onClearPreview={vi.fn()}
        onClose={vi.fn()}
        {...props}
      />
    </I18nProvider>,
  );
}

describe('IdeImportDialog', () => {
  it('requires an absolute project root before requesting a preview', () => {
    const onPreview = vi.fn();
    renderDialog({ onPreview });

    const find = screen.getByRole('button', { name: 'Find configurations' });
    expect(find).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Project root' }), { target: { value: 'relative' } });
    expect(find).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox', { name: 'Project root' }), { target: { value: '/workspace/demo' } });
    expect(find).not.toBeDisabled();
    fireEvent.click(find);
    expect(onPreview).toHaveBeenCalledWith({ projectRoot: '/workspace/demo' });
  });

  it('selects ready candidates by default and excludes unsupported candidates', () => {
    const onApply = vi.fn();
    renderDialog({ preview, onApply });

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Add to Avenil' }));
    expect(onApply).toHaveBeenCalledWith(preview, ['candidate-ready'], 'demo');
  });
});
