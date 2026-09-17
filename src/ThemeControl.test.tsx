import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { I18nProvider } from './i18n';
import { useTheme } from './ThemeControl';

function ThemeProbe() {
  const { mode, resolved, changeMode } = useTheme();
  return (
    <div>
      <output data-testid="mode">{mode}</output>
      <output data-testid="resolved">{resolved}</output>
      <button type="button" onClick={() => changeMode('dark')}>Dark</button>
    </div>
  );
}

describe('useTheme', () => {
  it('updates the document theme and persists explicit choices', () => {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.append(meta);

    render(
      <I18nProvider>
        <ThemeProbe />
      </I18nProvider>,
    );

    expect(screen.getByTestId('mode').textContent).toBe('system');
    expect(document.documentElement.dataset.theme).toBe('dark');

    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));

    expect(screen.getByTestId('mode').textContent).toBe('dark');
    expect(screen.getByTestId('resolved').textContent).toBe('dark');
    expect(window.localStorage.getItem('rundock.theme-mode')).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(meta.content).toBe('#151515');
  });
});
