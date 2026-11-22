import Select from "./Select";
import { useSyncExternalStore } from "react";
import { Icon } from "./Brand";

type Appearance = "system" | "dark" | "light";
declare global {
  interface Window {
    srezAppearance: { set: (value: Appearance) => void };
  }
}
const modes = { system: "Как в системе", light: "Светлая", dark: "Тёмная" };
function subscribe(update: () => void) {
  window.addEventListener("srez-appearance", update);
  return () => window.removeEventListener("srez-appearance", update);
}

export function ThemeControl({ compact = false }: { compact?: boolean }) {
  const mode = useSyncExternalStore(
    subscribe,
    () =>
      (document.documentElement.dataset.appearance || "system") as Appearance,
  );
  return (
    <label
      className={"theme-pick" + (compact ? " theme-pick--compact" : "")}
      data-hint={"Тема · " + modes[mode]}
    >
      <Icon
        name={mode === "system" ? "system" : mode === "dark" ? "moon" : "sun"}
        size={19}
      />
      {!compact && <span>Тема оформления</span>}
      <Select
        aria-label="Тема оформления"
        value={mode}
        onChange={(event) =>
          window.srezAppearance.set(event.target.value as Appearance)
        }
      >
        {Object.entries(modes).map(([value, label]) => (
          <option value={value} key={value}>
            {label}
          </option>
        ))}
      </Select>
    </label>
  );
}
export default ThemeControl;
