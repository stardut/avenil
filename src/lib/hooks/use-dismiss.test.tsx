import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { type DismissBehavior, useDismiss } from "./use-dismiss";

interface ProbeProps {
  behavior?: DismissBehavior;
  escape?: boolean;
  onDismiss: () => void;
}

function DismissProbe({ behavior, escape, onDismiss }: ProbeProps) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(true, onDismiss, ref, { behavior, escape });

  return (
    <>
      <div ref={ref} data-testid="inside">
        Inside
      </div>
      <button type="button">Outside</button>
    </>
  );
}

function renderProbe(props: Omit<ProbeProps, "onDismiss"> & { onDismiss?: () => void } = {}) {
  const onDismiss = props.onDismiss ?? vi.fn();
  return { onDismiss, ...render(<DismissProbe {...props} onDismiss={onDismiss} />) };
}

describe("useDismiss", () => {
  it("dismisses on Escape and ignores events inside the scope", () => {
    const { onDismiss } = renderProbe();

    fireEvent.pointerDown(screen.getByTestId("inside"));
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("supports pass-through and consume behavior for outside gestures", () => {
    const passThroughClick = vi.fn();
    const { onDismiss: passThroughDismiss } = renderProbe();
    const passThroughOutside = screen.getByRole("button", { name: "Outside" });
    passThroughOutside.addEventListener("click", passThroughClick);

    fireEvent.pointerDown(passThroughOutside);
    fireEvent.click(passThroughOutside);

    expect(passThroughDismiss).toHaveBeenCalledTimes(1);
    expect(passThroughClick).toHaveBeenCalledTimes(1);

    const consumeClick = vi.fn();
    const { onDismiss: consumeDismiss } = renderProbe({ behavior: "consume" });
    const consumeOutside = screen.getAllByRole("button", { name: "Outside" }).at(-1)!;
    consumeOutside.addEventListener("click", consumeClick);

    fireEvent.pointerDown(consumeOutside);
    fireEvent.click(consumeOutside);

    expect(consumeDismiss).toHaveBeenCalledTimes(1);
    expect(consumeClick).not.toHaveBeenCalled();
  });
});
