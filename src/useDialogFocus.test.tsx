import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useDialogFocus } from './useDialogFocus';

function FocusTrap() {
  const { dialogRef, onKeyDown } = useDialogFocus();
  return (
    <section ref={dialogRef} onKeyDown={onKeyDown} aria-label="dialog">
      <button type="button">First</button>
      <button type="button">Second</button>
    </section>
  );
}

describe('useDialogFocus', () => {
  it('focuses the first control, wraps with Tab, and restores the trigger', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Open';
    document.body.append(trigger);
    trigger.focus();

    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const cancelAnimationFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

    const { unmount } = render(<FocusTrap />);
    const first = screen.getByRole('button', { name: 'First' });
    const second = screen.getByRole('button', { name: 'Second' });

    expect(document.activeElement).toBe(first);

    second.focus();
    fireEvent.keyDown(screen.getByRole('region', { name: 'dialog' }), { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(screen.getByRole('region', { name: 'dialog' }), { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(second);

    unmount();
    expect(document.activeElement).toBe(trigger);
    expect(requestAnimationFrame).toHaveBeenCalledOnce();
    expect(cancelAnimationFrame).toHaveBeenCalledOnce();
  });
});
