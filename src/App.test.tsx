import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

describe('App', () => {
  it('hydrates the browser preview with the demo service workspace', async () => {
    window.history.replaceState({}, '', '/?preview=1');
    vi.resetModules();
    const [{ default: App }, { I18nProvider }] = await Promise.all([
      import('./App'),
      import('./i18n'),
    ]);

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    expect(await screen.findByText('订单 API')).toBeTruthy();
    expect(screen.getByText('内容 Worker')).toBeTruthy();
    expect(screen.getByText('A quiet place for things to run.')).toBeTruthy();
  });

  it('keeps the stop button animated while an asynchronous stop is in progress', async () => {
    window.history.replaceState({}, '', '/?preview=1');
    vi.resetModules();
    const [{ default: App }, { I18nProvider }] = await Promise.all([
      import('./App'),
      import('./i18n'),
    ]);

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    const stopButton = (await screen.findAllByRole('button', { name: 'Stop' }))[0];
    fireEvent.click(stopButton);

    expect(screen.getByRole('button', { name: 'Stopping' })).toBeTruthy();
  });
});
