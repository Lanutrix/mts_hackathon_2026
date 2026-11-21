// Runs before first paint, including when the device starts the installed app.
(() => {
  const key = "srez:appearance";
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const normalize = (value) =>
    ["light", "dark"].includes(value) ? value : "system";
  function stored() {
    try {
      return normalize(localStorage.getItem(key));
    } catch {
      return "system";
    }
  }
  let mode = stored();
  function apply() {
    const theme = mode === "system" ? (media.matches ? "dark" : "light") : mode;
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.appearance = mode;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#18171f" : "#e2e0ee");
    const manifest = document.querySelector('link[rel="manifest"]');
    const href =
      theme === "dark" ? "/srez-night.webmanifest" : "/manifest.webmanifest";
    if (manifest && manifest.getAttribute("href") !== href)
      manifest.setAttribute("href", href);
    window.dispatchEvent(new Event("srez-appearance"));
  }
  window.srezAppearance = {
    set(value) {
      mode = normalize(value);
      try {
        localStorage.setItem(key, mode);
      } catch {
        /* The choice still applies in this tab. */
      }
      apply();
    },
  };
  media.addEventListener("change", () => {
    if (mode === "system") apply();
  });
  window.addEventListener("storage", (event) => {
    if (event.key === key || event.key === null) {
      mode = stored();
      apply();
    }
  });
  apply();
})();
