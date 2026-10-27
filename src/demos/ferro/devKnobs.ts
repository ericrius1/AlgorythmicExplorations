// DEV ONLY (remove before shipping): ?k=name:value,... overrides demo knobs.
export function devKnobs<T extends object>(knobs: T): T {
  if (!import.meta.env.DEV) return knobs;
  const k = new URLSearchParams(location.search).get("k");
  if (!k) return knobs;
  for (const pair of k.split(",")) {
    const [name, v] = pair.split(":");
    (knobs as Record<string, unknown>)[name] = v === "true" ? true : v === "false" ? false : Number(v);
  }
  return knobs;
}
