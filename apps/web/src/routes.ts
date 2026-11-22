export function isTrainingPath(path: string) {
  return path === "/simulation" || path.startsWith("/simulation/");
}

export function screenPath(path: string) {
  if (!isTrainingPath(path)) return path;
  return path.slice("/simulation".length) || "/live";
}

export function screenLink(target: string, source: string) {
  const url = new URL(target, location.origin);
  if (source === "simulation") {
    url.pathname =
      url.pathname === "/live" ? "/simulation" : "/simulation" + url.pathname;
    url.searchParams.delete("ns");
  } else if (source !== "demo") {
    url.searchParams.set("ns", source);
  }
  return url.pathname + url.search + url.hash;
}

export function liveReturnHref(source: string) {
  const previous = history.state?.liveOrigin;
  if (typeof previous === "string" && previous.startsWith("/") && !previous.startsWith("//")) {
    const url = new URL(previous, location.origin);
    const namespace = isTrainingPath(url.pathname) ? "simulation" : url.searchParams.get("ns") ?? "demo";
    if (url.origin === location.origin && screenPath(url.pathname) === "/live" && namespace === source)
      return url.pathname + url.search;
  }
  return screenLink("/live", source);
}
