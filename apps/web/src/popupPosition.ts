// Keep both scrolling filter panels and their nested lists inside the visual viewport.
export function positionPopup(popup: HTMLElement, anchor: HTMLElement, align: "start" | "end") {
  const viewport = window.visualViewport;
  function place() {
    const rect = anchor.getBoundingClientRect();
    const left = (viewport?.offsetLeft ?? 0) + 8;
    const top = (viewport?.offsetTop ?? 0) + 8;
    const right = left + (viewport?.width ?? document.documentElement.clientWidth) - 16;
    const bottom = top + (viewport?.height ?? window.innerHeight) - 16;
    const width = Math.min(right - left, Math.max(rect.width, align === "end" ? 320 : 224));
    const x = align === "end" ? rect.right - width : rect.left;
    const below = Math.max(0, bottom - rect.bottom - 4);
    const above = Math.max(0, rect.top - top - 4);
    const opensUp = below < Math.min(popup.scrollHeight, 320) && above > below;
    popup.style.width = width + "px";
    popup.style.left = Math.max(left, Math.min(x, right - width)) + "px";
    popup.style.setProperty("--popup-space", (opensUp ? above : below) + "px");
    const y = opensUp ? rect.top - 4 - popup.offsetHeight : rect.bottom + 4;
    popup.style.top = Math.min(bottom - popup.offsetHeight, Math.max(top, y)) + "px";
  }
  const onScroll = (event: Event) => {
    if (!(event.target instanceof Node && popup.contains(event.target))) place();
  };
  place();
  const observer = new ResizeObserver(place);
  observer.observe(anchor);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", place);
  viewport?.addEventListener("resize", place);
  viewport?.addEventListener("scroll", place);
  return () => {
    observer.disconnect();
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", place);
    viewport?.removeEventListener("resize", place);
    viewport?.removeEventListener("scroll", place);
  };
}
