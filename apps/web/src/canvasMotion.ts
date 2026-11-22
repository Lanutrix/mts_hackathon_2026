// Run once for an accepted answer. Layout, pagination and the composer can then
// update independently, without replaying the entrance on newly mounted marks.
export function revealCanvas(stage: HTMLElement) {
  const preference = matchMedia("(prefers-reduced-motion: reduce)");
  if (preference.matches || !stage.animate) return;
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
