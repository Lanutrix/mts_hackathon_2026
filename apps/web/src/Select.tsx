import { useId, useImperativeHandle, useLayoutEffect, useRef, useState,
  type ComponentPropsWithRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { positionPopup } from "./popupPosition";
import "./select.css";

// The select remains the labelled, focusable form control. Its value, validation,
// form reset, input/change events and ref all follow normal HTML form semantics.
export default function Select({ ref, ...props }: ComponentPropsWithRef<"select">) {
  const control = useRef<HTMLSelectElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [options, setOptions] = useState<HTMLOptionElement[] | null>(null);
  const [active, setActive] = useState(0);
  const search = useRef({ prefix: "", time: 0 });
  useImperativeHandle(ref, () => control.current!, []);
  const expanded = options !== null;

  function open() {
    const select = control.current;
    if (!select || select.matches(":disabled") || !select.options.length) return;
    const choices = Array.from(select.options).filter(option => !option.hidden);
    setActive(Math.max(0, choices.findIndex(option => option.selected)));
    search.current.prefix = "";
    setOptions(choices);
  }

  function close(restore: boolean) {
    setOptions(null);
    if (restore) control.current?.focus({ preventScroll: true });
  }

  function choose(option: HTMLOptionElement) {
    const select = control.current;
    if (!select || !select.contains(option) || option.matches(":disabled")) return;
    if (select.selectedIndex !== option.index) {
      select.selectedIndex = option.index;
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    close(true);
  }

  useLayoutEffect(() => {
    const select = control.current;
    const menu = list.current;
    if (!expanded || !select || !menu) return;
    menu.showPopover();
    const unposition = positionPopup(menu, select, "start");
    menu.focus({ preventScroll: true });
    const outside = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && !menu.contains(target) && target !== select) close(false);
    };
    // A live filter's options can change while the popup is open.
    const changed = new MutationObserver(() => close(true));
    changed.observe(select, { childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ["disabled", "hidden", "value"] });
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    return () => {
      changed.disconnect();
      unposition();
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside);
    };
  }, [expanded]);

  useLayoutEffect(() => {
    const menu = list.current;
    const item = menu?.children[active] as HTMLElement | undefined;
    if (!menu || !item) return;
    const offset = item.offsetTop;
    if (offset < menu.scrollTop) menu.scrollTop = offset;
    else if (offset + item.offsetHeight > menu.scrollTop + menu.clientHeight)
      menu.scrollTop = offset + item.offsetHeight - menu.clientHeight;
  }, [active, options]);

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (!options) return;
    const { key } = event;
    if (key === "Tab") { close(true); return; }
    if (key === "Escape" || key === "F4") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (key === "Enter" || key === " ") {
      event.preventDefault();
      if (options[active]) choose(options[active]);
      return;
    }
    const enabled = options.map((option, index) => ({ option, index }))
      .filter(({ option }) => !option.matches(":disabled"));
    if (!enabled.length) return;
    const position = enabled.findIndex(entry => entry.index === active);
    const last = enabled.length - 1;
    const page = Math.max(1, Math.floor((list.current?.clientHeight ?? 44) /
      ((list.current?.children[active] as HTMLElement)?.offsetHeight || 44)));
    const moves: Record<string, number> = { ArrowDown: position + 1, ArrowUp: position - 1,
      Home: 0, End: last, PageDown: position + page, PageUp: position - page };
    if (Object.hasOwn(moves, key)) {
      event.preventDefault();
      setActive(enabled[Math.max(0, Math.min(last, moves[key]))].index);
    } else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const now = performance.now();
      const char = key.toLocaleLowerCase();
      const prefix = (now - search.current.time < 700 ? search.current.prefix : "") + char;
      search.current = { prefix, time: now };
      const repeating = [...prefix].every(letter => letter === char);
      const start = Math.max(0, position + (repeating ? 1 : 0));
      const ordered = [...enabled.slice(start), ...enabled.slice(0, start)];
      const match = ordered.find(({ option }) => option.label.trim().toLocaleLowerCase()
        .startsWith(repeating ? char : prefix));
      if (match) setActive(match.index);
    }
  }

  const native = props.multiple || (props.size ?? 0) > 1 || !HTMLElement.prototype.showPopover;
  if (native) return <select {...props} ref={control} />;
  const select = control.current;
  const host = select?.closest("dialog[open], [popover]:popover-open, details[open]") ?? document.body;
  return <>
    <select {...props} ref={control} className={["srez-select", props.className].filter(Boolean).join(" ")}
      aria-haspopup="listbox" aria-controls={expanded ? listId : undefined} aria-expanded={expanded}
      onMouseDown={event => {
        props.onMouseDown?.(event);
        if (event.button === 0 && !event.defaultPrevented) {
          event.preventDefault();
          event.currentTarget.focus({ preventScroll: true });
        }
      }}
      onClick={event => {
        props.onClick?.(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        if (expanded) close(true); else open();
      }}
      onKeyDown={event => {
        props.onKeyDown?.(event);
        if (event.defaultPrevented || !["Enter", " ", "ArrowUp", "ArrowDown", "F4"].includes(event.key)) return;
        event.preventDefault();
        open();
      }}
    />
    {options && select && createPortal(
      <div id={listId} className="srez-options" popover="manual" role="listbox" tabIndex={-1}
        aria-label={props["aria-label"] ?? select.labels?.[0]?.firstChild?.textContent?.trim()}
        aria-labelledby={props["aria-labelledby"]} aria-activedescendant={options[active] ? listId + "-" + active : undefined}
        ref={list} onKeyDown={navigate}>
        {options.map((option, index) => (
          <div key={option.index} id={listId + "-" + index} role="option" aria-selected={option.selected}
            aria-disabled={option.matches(":disabled") || undefined} data-active={index === active}
            onMouseDown={event => event.preventDefault()} onClick={() => choose(option)}>
            <span>{option.label}</span>
            {option.selected && <span aria-hidden="true">✓</span>}
          </div>
        ))}
      </div>, host
    )}
  </>;
}
