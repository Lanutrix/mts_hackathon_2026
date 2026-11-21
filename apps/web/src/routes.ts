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
