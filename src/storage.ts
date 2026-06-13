/**
 * Storage awareness for the local-first build.
 *
 * IndexedDB quotas are browser-decided, not fixed: Chromium grants up to
 * ~60% of free disk per origin, Firefox ~10% capped near 10 GB, Safari far
 * less. Data is "best-effort" by default — the browser may evict it under
 * disk pressure unless navigator.storage.persist() is granted. Video makes
 * this concrete: ~600 MB per 10 min of 1080p.
 */

export interface StorageInfo {
  usageBytes: number;
  quotaBytes: number;
  persisted: boolean;
}

export async function getStorageInfo(): Promise<StorageInfo | null> {
  if (!navigator.storage?.estimate) return null;
  const est = await navigator.storage.estimate();
  const persisted = navigator.storage.persisted
    ? await navigator.storage.persisted()
    : false;
  return {
    usageBytes: est.usage ?? 0,
    quotaBytes: est.quota ?? 0,
    persisted,
  };
}

/**
 * Ask the browser to exempt this origin's data from automatic eviction.
 * Browsers grant or deny based on engagement heuristics — a denial here is
 * the browser's call, not an error.
 */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  return navigator.storage.persist();
}

export function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} kB`;
  return `${n} B`;
}

export function isQuotaError(e: unknown): boolean {
  return (
    (e instanceof DOMException &&
      (e.name === "QuotaExceededError" ||
        e.name === "NS_ERROR_DOM_QUOTA_REACHED")) ||
    (e instanceof Error && /quota/i.test(e.message))
  );
}
