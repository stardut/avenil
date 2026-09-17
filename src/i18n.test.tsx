import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { I18nProvider, useI18n } from './i18n';

function LanguageProbe() {
  const { language, resolvedLanguage, t, changeLanguage } = useI18n();
  return (
    <div>
      <output data-testid="language">{language}</output>
      <output data-testid="resolved">{resolvedLanguage}</output>
      <output data-testid="title">{t('document.title')}</output>
      <button type="button" onClick={() => changeLanguage('en')}>English</button>
    </div>
  );
}

describe('I18nProvider', () => {
  it('exposes the resolved locale and persists an explicit language choice', () => {
    render(
      <I18nProvider>
        <LanguageProbe />
      </I18nProvider>,
    );

    expect(screen.getByTestId('language').textContent).toBe('system');
    expect(screen.getByTestId('resolved').textContent).toBe('en');
    expect(screen.getByTestId('title').textContent).toBe('Avenil · Local Service Console');

    fireEvent.click(screen.getByRole('button', { name: 'English' }));

    expect(screen.getByTestId('language').textContent).toBe('en');
    expect(window.localStorage.getItem('rundock.language')).toBe('en');
    expect(document.documentElement.lang).toBe('en-US');
  });
});
