import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useHoverGesture } from './lib/hooks/use-hover-gesture';
import { useTapGesture } from './lib/hooks/use-tap-gesture';

describe('interaction hooks', () => {
  it('does not treat touch contact as a hover', () => {
    const { result } = renderHook(() => useHoverGesture());

    expect(result.current.enter({ pointerId: 1, pointerType: 'touch', buttons: 1 })).toBe(false);
    expect(result.current.leave({ pointerId: 1, pointerType: 'touch', buttons: 0 })).toBe(false);
    expect(result.current.enter({ pointerId: 2, pointerType: 'mouse', buttons: 0 })).toBe(true);
    expect(result.current.leave({ pointerId: 2, pointerType: 'mouse', buttons: 0 })).toBe(true);
  });

  it('records one pointer gesture and clears it when consumed or dropped', () => {
    const { result } = renderHook(() => useTapGesture<string>());
    const pointer = { pointerType: 'touch' } as PointerEvent;

    result.current.start(pointer, 'opened');
    expect(result.current.take()).toEqual({ pointerType: 'touch', state: 'opened' });
    expect(result.current.take()).toBeNull();

    result.current.start(pointer, 'closed');
    result.current.drop();
    expect(result.current.take()).toBeNull();
  });
});
