import { useEffect, useMemo, useState } from "react";
import { groups, mergeStreams, type Dashboard, type Signal } from "./liveFeed";

// Keep the prefix contiguous even when the same ticket belongs to several queues.
export function useLivePrefix(
  data: Dashboard,
  signal: Signal,
  sort: string,
  query: string,
  target: number,
) {
  const scope = JSON.stringify([data.namespace, data.revision, query]);
  const [cache, setCache] = useState<{ scope: string; pages: Dashboard[] }>({
    scope,
    pages: [],
  });
  const [fault, setFault] = useState({ scope: "", message: "" });
  const [attempt, setAttempt] = useState(0);
  const depth = scope === cache.scope ? cache.pages.length : 0;
  const records = useMemo(
    () =>
      mergeStreams(
        data,
        scope === cache.scope ? cache.pages : [],
        signal,
        sort,
        target,
      ),
    [data, scope, cache, signal, sort, target],
  );
  const loading = records.length < target;
  useEffect(() => {
    if (!loading) return;
    const controller = new AbortController();
    const params = new URLSearchParams(query);
    params.set("ns", data.namespace);
    for (const group of groups) params.set(group, String((depth + 1) * 30));
    setFault({ scope, message: "" });
    void fetch("/api/dashboard?" + params, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось получить заявки.");
        const next: Dashboard = await response.json();
        if (controller.signal.aborted) return;
        if (
          next.revision !== data.revision ||
          next.namespace !== data.namespace
        )
          throw new Error("Источник обновился. Ожидаем новую версию.");
        setCache((previous) => ({
          scope,
          pages: [...(previous.scope === scope ? previous.pages : []), next],
        }));
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setFault({ scope, message: error.message });
      });
    return () => controller.abort();
  }, [data.revision, data.namespace, query, depth, loading, scope, attempt]);
  return {
    records,
    loading,
    error: fault.scope === scope && loading ? fault.message : "",
    retry: () => setAttempt((n) => n + 1),
  };
}
