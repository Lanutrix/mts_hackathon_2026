// Hide the untyped suffix on the browser's highlight layer. The entire answer
// stays in its original text nodes for wrapping, selection, links and readers.
function typeCanvasText(stage: HTMLElement, preference: MediaQueryList) {
  if (typeof Highlight === "undefined" || !CSS.highlights || !Intl.Segmenter) return;
  const segmenter = new Intl.Segmenter("ru", { granularity: "grapheme" });
  const hidden = new Highlight();
  const runs: { range: Range; offsets: number[] }[] = [];
  let length = 0;
  const prose = stage.querySelectorAll([
    ".cx-plot-title h2:not(.sr-only)", ".fact-value", ".cx-prose-sheet p", ".cx-empty h3", ".cx-empty p",
    ".ar-definition p", ".ar-guide-section h3", ".ar-guide-section p", ".ar-guide-section li",
    ".ar-symbol-single p", ".ar-symbol-list dd", ".ar-brief-main p", ".ins-block h3", ".ins-citation > span", ".fact-note",
  ].join(","));
  for (const element of prose) {
    if (element.closest("details:not([open])")) continue;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement?.closest("svg,[aria-hidden=true]")) continue;
      const text = node.textContent!;
      if (!text.trim()) continue;
      const offsets = Array.from(segmenter.segment(text), part => part.index);
      const range = document.createRange();
      range.selectNodeContents(node);
      hidden.add(range);
      runs.push({ range, offsets });
      length += offsets.length;
    }
  }
  if (!length) return;
  const name = "canvas-untyped";
  CSS.highlights.set(name, hidden);
  const duration = Math.min(1250, Math.max(240, length * 6));
  const start = performance.now();
  let frame = 0, index = 0, completed = 0;
  function finish() {
    cancelAnimationFrame(frame);
    if (CSS.highlights.get(name) === hidden) CSS.highlights.delete(name);
    hidden.clear();
    runs.length = 0;
    preference.removeEventListener("change", finish);
    stage.removeEventListener("pointerdown", finish, true);
    stage.removeEventListener("focusin", finish, true);
  }
  function tick(now: number) {
    const position = Math.floor(length * Math.max(0, now - start) / duration);
    while (index < runs.length) {
      const { range, offsets } = runs[index];
      if (position < completed + offsets.length) {
        // A responsive view may replace its original text while settling its layout.
        if (range.startContainer.nodeType === Node.TEXT_NODE &&
          offsets[position - completed] <= range.endOffset)
          range.setStart(range.startContainer, offsets[position - completed]);
        frame = requestAnimationFrame(tick);
        return;
      }
      hidden.delete(range);
      completed += offsets.length;
      index++;
    }
    finish();
  }
  stage.addEventListener("pointerdown", finish, true);
  stage.addEventListener("focusin", finish, true);
  preference.addEventListener("change", finish);
  frame = requestAnimationFrame(tick);
  return finish;
}

// Run once for an accepted answer. Layout, pagination and the composer can then
// update independently, without replaying the entrance on newly mounted marks.
export function revealCanvas(stage: HTMLElement) {
  const preference = matchMedia("(prefers-reduced-motion: reduce)");
  if (preference.matches || !stage.animate) return;
  const finishText = typeCanvasText(stage, preference);
  const animations: Animation[] = [];
  const easing = "cubic-bezier(.18,.78,.22,1)";
  const rise = [
    { opacity: 0.28, translate: "0 7px" },
    { opacity: 1, translate: "0 0" },
  ];
  const trace = [
    { clipPath: "inset(-10px 100% -10px -10px)" },
    { clipPath: "inset(-10px -10px -10px -10px)" },
  ];

  function play(name: string, selector: string, frames: Keyframe[], duration: number, delay: number, stagger = 0) {
    // A large or scrollable report keeps every record in place. Only its first
    // visible marks need individual motion; the rest arrive with their panel.
    const elements = Array.from(stage.querySelectorAll(selector)).slice(0, 18);
    elements.forEach((element, i) => {
      animations.push(element.animate(frames, {
        id: "canvas-enter-" + name, duration, delay: delay + Math.min(i, 6) * stagger, easing, fill: "backwards",
      }));
    });
  }

  play("heading", ".cx-plot-title h2, .fact-value", rise, 300, 0, 25);
  play("panel", ".cx-plot > :nth-child(2)", [{ opacity: 0.58 }, { opacity: 1 }], 340, 24, 25);
  play("prose", ".cx-prose-sheet p, .cx-empty h3, .ar-definition, .fact-note, .ins-block", rise, 370, 44, 20);
  play("row", ".fact-arrivals > li, .fact-interval-rows > li, .fact-interval-sample > div, .fact-rank tbody > tr, " +
    ".fact-duration-list > li, .fact-directory > li, .cx-preview > a, .cx-axis > button, .ar-share-key > button, " +
    ".fact-status-composition dl > div, .fact-bar, .ar-dossiers > button", rise, 340, 65, 22);
  play("measure", ".fact-bar > i, .fact-duration-track > i, .fact-table-measure > i, .ar-lollipop > i, .cx-compare td > i",
    trace, 390, 85, 20);
  play("arc", ".ar-dial path", [
    { strokeDasharray: "1 1", strokeDashoffset: "1" },
    { strokeDasharray: "1 1", strokeDashoffset: "0" },
  ], 440, 60, 18);
  play("slice", ".fact-state-slice path[data-state], .cx-square-ink, .ins-well > i",
    [{ opacity: 0.15, scale: ".92" }, { opacity: 1, scale: "1" }], 370, 64, 21);
  play("link", ".fact-network > svg, .ar-branches > svg", trace, 430, 76);
  play("node", ".fact-node, .ar-leaves > button", rise, 320, 110, 32);

  function stop() {
    finishText?.();
    for (const animation of animations) animation.cancel();
    preference.removeEventListener("change", stop);
  }
  preference.addEventListener("change", stop);
  void Promise.allSettled(animations.map(animation => animation.finished)).then(() => {
    preference.removeEventListener("change", stop);
    animations.length = 0;
  });
  return stop;
}
