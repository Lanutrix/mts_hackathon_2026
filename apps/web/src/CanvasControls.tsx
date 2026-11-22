import { answerElement as elPart } from "../../../packages/contracts/answerCatalog";
import { useLayoutEffect, useRef, useState } from "react";
export const formatCount = (n: number) => n.toLocaleString("ru-RU");
export function useBox() {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth,
        height = el.clientHeight;
      setBox((old) =>
        old.width === width && old.height === height ? old : { width, height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, ...box };
}
export function PageControls({
  page,
  pages,
  goto,
  label,
}: {
  page: number;
  pages: number;
  goto: (p: number) => void;
  label: string;
}) {
  if (pages < 2) return null;
  return (
    <nav {...elPart("page-turner")} className="cx-pager" aria-label={label}>
      <button
        type="button"
        onClick={() => goto(page - 1)}
        {...elPart("previous-page")}
        disabled={!page}
        aria-label="Предыдущая страница"
        data-hint="Предыдущая страница"
      >
        ←
      </button>
      <span {...elPart("page-position")} aria-live="polite">
        {page + 1} / {pages}
      </span>
      <button
        type="button"
        onClick={() => goto(page + 1)}
        {...elPart("next-page")}
        disabled={page + 1 >= pages}
        aria-label="Следующая страница"
        data-hint="Следующая страница"
      >
        →
      </button>
    </nav>
  );
}
