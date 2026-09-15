"use client";
// Adapted from beUI components/motion/select.tsx at commit
// 8d3fa7b4b3b4d74f53ea7096d5eb59e4479c0340 (MIT).
// Uses Avenil CSS tokens, portal positioning and keyboard navigation.

import { Check, ChevronDown } from "lucide-react";
import {
  motion,
  type Transition,
  useReducedMotion,
  type Variants,
} from "motion/react";
import {
  createContext,
  type ReactNode,
  type KeyboardEvent,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useDismiss } from "../../lib/hooks/use-dismiss";
import { EASE_OUT } from "../../lib/ease";
import { cn } from "../../lib/utils";

const INSTANT_TRANSITION: Transition = { duration: 0 };

const CHEVRON_TRANSITION: Transition = { type: "spring", duration: 0.4, bounce: 0.3 };

const LIST_VARIANTS: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.035, delayChildren: 0.05 } },
};
const ITEM_VARIANTS: Variants = {
  hidden: { opacity: 0, y: -6, filter: "blur(3px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)" },
};

type Placement = "bottom" | "top";

interface SelectContextValue {
  value: string | undefined;
  open: boolean;
  setOpen: (open: boolean) => void;
  select: (value: string) => void;
  register: (value: string, label: string) => void;
  unregister: (value: string) => void;
  labelFor: (value: string | undefined) => string | undefined;
  reduce: boolean;
  triggerId: string;
  listId: string;
  disabled: boolean;
  placement: Placement;
  setPlacement: (p: Placement) => void;
  activeValue: string | undefined;
  setActiveValue: (value: string) => void;
}

const SelectContext = createContext<SelectContextValue | null>(null);

function useSelectContext(component: string) {
  const ctx = useContext(SelectContext);
  if (!ctx) throw new Error(`${component} must be used within <Select>`);
  return ctx;
}

export interface SelectProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
    open?: boolean;
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

export function Select({
  value,
  defaultValue,
  onValueChange,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  disabled = false,
  className,
  children,
}: SelectProps) {
  const reduce = useReducedMotion() ?? false;
  const baseId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const [internal, setInternal] = useState(defaultValue);
  const [labels, setLabels] = useState<Map<string, string>>(new Map());
  const [activeValue, setActiveValue] = useState<string>();
  const [placement, setPlacement] = useState<Placement>("bottom");

  const controlled = value !== undefined;
  const current = controlled ? value : internal;
  const openControlled = openProp !== undefined;
  const open = openControlled ? openProp : internalOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      if (!openControlled) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange, openControlled],
  );

  const select = useCallback(
    (next: string) => {
      if (!controlled) setInternal(next);
      onValueChange?.(next);
      setOpen(false);
      document.getElementById(`${baseId}-trigger`)?.focus();
    },
    [controlled, onValueChange, setOpen, baseId],
  );

  const register = useCallback((v: string, label: string) => {
    setLabels((m) => (m.get(v) === label ? m : new Map(m).set(v, label)));
  }, []);
  const unregister = useCallback((v: string) => {
    setLabels((m) => {
      if (!m.has(v)) return m;
      const next = new Map(m);
      next.delete(v);
      return next;
    });
  }, []);

  const close = useCallback(() => setOpen(false), [setOpen]);
  const insideList = useCallback((target: Element) => Boolean(document.getElementById(`${baseId}-list`)?.contains(target)), [baseId]);
  useDismiss(open, close, rootRef, { escape: false, ignore: insideList });

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const options = Array.from(document.querySelectorAll<HTMLButtonElement>(`[id="${baseId}-list"] [role="option"]:not(:disabled)`));
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (event.key === "Tab") { setOpen(false); return; }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (!options.length) return;
      const currentIndex = options.findIndex((item) => item.dataset.value === activeValue);
      const selectedIndex = options.findIndex((item) => item.dataset.value === current);
      const next = !open ? Math.max(0, selectedIndex)
        : event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
        : (currentIndex + (event.key === "ArrowUp" ? -1 : 1) + options.length) % options.length;
      setActiveValue(options[next].dataset.value!);
      setOpen(true);
    } else if (open && ["Enter", " "].includes(event.key)) {
      event.preventDefault();
      if (activeValue !== undefined) select(activeValue);
    }
  };

  const ctx = useMemo<SelectContextValue>(
    () => ({
      value: current,
      open,
      setOpen,
      select,
      register,
      unregister,
      labelFor: (v) => (v === undefined ? undefined : labels.get(v)),
      reduce,
      triggerId: `${baseId}-trigger`,
      listId: `${baseId}-list`,
      disabled,
      placement,
      setPlacement,
      activeValue,
      setActiveValue,
    }),
    [
      current,
      open,
      setOpen,
      select,
      register,
      unregister,
      labels,
      reduce,
      baseId,
      disabled,
      placement,
      activeValue,
    ],
  );

  return (
    <SelectContext.Provider value={ctx}>
      <div ref={rootRef} onKeyDown={handleKeyDown} className={cn("beui-select", className)}>
        {children}
      </div>
    </SelectContext.Provider>
  );
}

export interface SelectTriggerProps {
  "aria-label"?: string;
  className?: string;
  children: ReactNode;
}

export function SelectTrigger({ className, children, "aria-label": ariaLabel }: SelectTriggerProps) {
  const ctx = useSelectContext("SelectTrigger");
  const isTop = ctx.placement === "top";
  const kf = ctx.open ? [0, 0, 8] : [8, 0, 8];
  const kfT: Transition = ctx.reduce
    ? { duration: 0 }
    : ctx.open
      ? { duration: 0.6, times: [0, 0.4, 1], ease: EASE_OUT }
      : { duration: 0.42, times: [0, 0.5, 1], ease: EASE_OUT };
  return (
    <motion.button
      type="button"
      id={ctx.triggerId}
      disabled={ctx.disabled}
      role="combobox"
      aria-label={ariaLabel}
      aria-activedescendant={ctx.open && ctx.activeValue !== undefined ? `${ctx.listId}-${encodeURIComponent(ctx.activeValue)}` : undefined}
      aria-haspopup="listbox"
      aria-expanded={ctx.open}
      aria-controls={ctx.listId}
      onClick={() => { if (ctx.value !== undefined) ctx.setActiveValue(ctx.value); ctx.setOpen(!ctx.open); }}
      initial={false}
      animate={{
        borderTopLeftRadius: isTop ? kf : 8,
        borderTopRightRadius: isTop ? kf : 8,
        borderBottomLeftRadius: isTop ? 8 : kf,
        borderBottomRightRadius: isTop ? 8 : kf,
      }}
      transition={{
        borderTopLeftRadius: isTop ? kfT : INSTANT_TRANSITION,
        borderTopRightRadius: isTop ? kfT : INSTANT_TRANSITION,
        borderBottomLeftRadius: isTop ? INSTANT_TRANSITION : kfT,
        borderBottomRightRadius: isTop ? INSTANT_TRANSITION : kfT,
      }}
      className={cn(
        "beui-select-trigger",
        className,
      )}
    >
      {children}
      <motion.span
        aria-hidden
        animate={{ rotate: ctx.open ? 180 : 0 }}
        transition={ctx.reduce ? { duration: 0 } : CHEVRON_TRANSITION}
        className="beui-select-chevron"
      >
        <ChevronDown size={16} />
      </motion.span>
    </motion.button>
  );
}

export interface SelectValueProps {
  placeholder?: string;
  className?: string;
}

export function SelectValue({ placeholder, className }: SelectValueProps) {
  const ctx = useSelectContext("SelectValue");
  const label = ctx.labelFor(ctx.value);
  return (
    <span
      className={cn("beui-select-value", !label && "placeholder", className)}
    >
      {label ?? placeholder ?? "Select"}
    </span>
  );
}

export interface SelectContentProps {
  className?: string;
  children: ReactNode;
}

export function SelectContent({ className, children }: SelectContentProps) {
  const ctx = useSelectContext("SelectContent");
  const innerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0 });
  const open = ctx.open;
  const { setPlacement } = ctx;

  useEffect(() => {
    if (!open || ctx.activeValue === undefined) return;
    document.getElementById(`${ctx.listId}-${encodeURIComponent(ctx.activeValue)}`)?.scrollIntoView({ block: "nearest" });
  }, [open, ctx.activeValue, ctx.listId]);

  useLayoutEffect(() => {
    const node = innerRef.current;
    if (!node) return;
    const measure = () => setHeight(node.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const trigger = document.getElementById(ctx.triggerId);
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const above = rect.top;
      const below = window.innerHeight - rect.bottom;
      const top = below < height + 16 && above > below;
      setPlacement(top ? "top" : "bottom");
      setPosition({ left: rect.left, top: top ? rect.top - height - 8 : rect.bottom, width: rect.width });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [open, ctx.triggerId, setPlacement, height]);

  const isTop = ctx.placement === "top";
  const nearGap = open ? 8 : 0;
  const nearRadius = open ? 12 : 0;

  const gapT: Transition = open
    ? { type: "spring", duration: 0.6, bounce: 0.5, delay: 0.12 }
    : { type: "spring", duration: 0.3, bounce: 0.1 };
  const radiusT: Transition = open
    ? { duration: 0.3, ease: EASE_OUT, delay: 0.14 }
    : { duration: 0.16, ease: EASE_OUT };

  return createPortal(
    <motion.div
      id={ctx.listId}
      role="listbox"
      aria-labelledby={ctx.triggerId}
      aria-hidden={!open}
      inert={!open}
      initial={false}
      animate={
        ctx.reduce
          ? { opacity: open ? 1 : 0, height: open ? height : 0 }
          : {
              opacity: open ? 1 : 0,
              height: open ? height : 0,
              marginTop: isTop ? 0 : nearGap,
              marginBottom: isTop ? nearGap : 0,
              borderTopLeftRadius: isTop ? 12 : nearRadius,
              borderTopRightRadius: isTop ? 12 : nearRadius,
              borderBottomLeftRadius: isTop ? nearRadius : 12,
              borderBottomRightRadius: isTop ? nearRadius : 12,
            }
      }
      transition={
        ctx.reduce
          ? { duration: 0.12 }
          : {
              opacity: open
                ? { duration: 0.18 }
                : { duration: 0.16, delay: 0.12 },
              height: open
                ? { type: "spring", duration: 0.42, bounce: 0.14 }
                : { duration: 0.26, ease: EASE_OUT, delay: 0.14 },
              marginTop: isTop ? INSTANT_TRANSITION : gapT,
              marginBottom: isTop ? gapT : INSTANT_TRANSITION,
              borderTopLeftRadius: isTop ? INSTANT_TRANSITION : radiusT,
              borderTopRightRadius: isTop ? INSTANT_TRANSITION : radiusT,
              borderBottomLeftRadius: isTop ? radiusT : INSTANT_TRANSITION,
              borderBottomRightRadius: isTop ? radiusT : INSTANT_TRANSITION,
            }
      }
      style={{
        position: "fixed",
        left: position.left,
        top: position.top,
        width: position.width,
        transformOrigin: isTop ? "bottom" : "top",
        overflow: "hidden",
        pointerEvents: open ? "auto" : "none",
      }}
      className={cn(
        "beui-select-content",
        className,
      )}
    >
      <motion.div
        ref={innerRef}
        variants={ctx.reduce ? undefined : LIST_VARIANTS}
        initial={false}
        animate={open ? "show" : "hidden"}
        className="beui-select-list"
      >
        {children}
      </motion.div>
    </motion.div>,
    document.body,
  );
}

export interface SelectItemProps {
  value: string;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

export function SelectItem({
  value,
  disabled = false,
  className,
  children,
}: SelectItemProps) {
  const ctx = useSelectContext("SelectItem");
  const selected = ctx.value === value;
  const label = typeof children === "string" ? children : value;

  useLayoutEffect(() => {
    ctx.register(value, label);
    return () => ctx.unregister(value);
  }, [ctx.register, ctx.unregister, value, label]);

  return (
    <motion.div variants={ctx.reduce ? undefined : ITEM_VARIANTS}>
      <button
        type="button"
        role="option"
        id={`${ctx.listId}-${encodeURIComponent(value)}`}
        data-value={value}
        tabIndex={-1}
        onPointerDown={(event) => event.preventDefault()}
        onPointerMove={() => ctx.setActiveValue(value)}
        aria-selected={selected}
        disabled={disabled || ctx.disabled}
        onClick={() => ctx.select(value)}
        className={cn(
          "beui-select-item",
          selected && "selected",
          ctx.activeValue === value && "active",
          className,
        )}
      >
        {children}
        {selected ? <Check size={14} /> : null}
      </button>
    </motion.div>
  );
}
