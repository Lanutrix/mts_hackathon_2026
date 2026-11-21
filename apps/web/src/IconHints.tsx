import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Hint = { target: Element; text: string };
function identify(node: EventTarget | null): Hint | null {
  if (!(node instanceof Element) || node.closest('[data-testid="wallboard"]'))
    return null;
  const target =
    node.closest("[data-hint], button, a, label, [role=img]") ||
    node.closest("[data-srez-icon]");
  if (!target) return null;
  const svg = target.matches("[data-srez-icon]")
    ? target
    : target.querySelector("svg");
  const text =
    target.getAttribute("data-hint") ||
    target.getAttribute("aria-label") ||
    (svg &&
      (target.getAttribute("title") || svg.getAttribute("data-srez-icon")));
  return text ? { target, text } : null;
}
export default function IconHints() {
  const [hint, setHint] = useState<Hint | null>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let timer = 0;
    let hold = 0;
    let held: Element | null = null;
    const clear = () => {
      clearTimeout(timer);
      clearTimeout(hold);
      setHint(null);
    };
    const enter = (e: PointerEvent | FocusEvent) => {
      if ("pointerType" in e && e.pointerType === "touch") return;
      const item = identify(e.target);
      if (item?.target === identify(e.relatedTarget)?.target) return;
      clear();
      if (item)
        timer = window.setTimeout(
          () => setHint(item),
          e.type === "focusin" ? 80 : 250,
        );
    };
    const leave = (e: PointerEvent | FocusEvent) => {
      if (identify(e.target)?.target !== identify(e.relatedTarget)?.target)
        clear();
    };
    const down = (e: PointerEvent) => {
      held = null;
      clear();
      const item = identify(e.target);
      if (!item || e.pointerType !== "touch") return;
      setHint(item);
      hold = window.setTimeout(() => {
        held = item.target;
      }, 420);
    };
    const up = () => {
      clearTimeout(hold);
      timer = window.setTimeout(clear, 1400);
    };
    const click = (e: MouseEvent) => {
      if (held && e.target instanceof Node && held.contains(e.target)) {
        e.preventDefault();
        e.stopPropagation();
      }
      held = null;
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") clear();
    };
    document.addEventListener("pointerover", enter);
    document.addEventListener("pointerout", leave);
    document.addEventListener("focusin", enter);
    document.addEventListener("focusout", leave);
    document.addEventListener("pointerdown", down);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", clear);
    document.addEventListener("click", click, true);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", clear, true);
    window.addEventListener("resize", clear);
    return () => {
      clearTimeout(timer);
      clearTimeout(hold);
      document.removeEventListener("pointerover", enter);
      document.removeEventListener("pointerout", leave);
      document.removeEventListener("focusin", enter);
      document.removeEventListener("focusout", leave);
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", clear);
      document.removeEventListener("click", click, true);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", clear, true);
      window.removeEventListener("resize", clear);
    };
  }, []);
  useLayoutEffect(() => {
    if (!hint || !bubble.current) return;
    const box = hint.target.getBoundingClientRect(),
      tip = bubble.current;
    const left = Math.min(
      innerWidth - tip.offsetWidth - 8,
      Math.max(8, box.left + (box.width - tip.offsetWidth) / 2),
    );
    const top =
      box.bottom + tip.offsetHeight + 14 < innerHeight
        ? box.bottom + 6
        : Math.max(6, box.top - tip.offsetHeight - 6);
    tip.style.left = left + "px";
    tip.style.top = top + "px";
  }, [hint]);
  if (!hint?.target.isConnected) return null;
  const layer =
    hint.target.closest("dialog[open], [popover]:popover-open") ||
    document.body;
  return createPortal(
    <span ref={bubble} role="tooltip" className="srez-hint">
      {hint.text}
    </span>,
    layer,
  );
}
