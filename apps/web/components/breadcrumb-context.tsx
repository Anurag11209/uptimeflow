"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

interface BreadcrumbLabelMap {
  [pathSegmentValue: string]: string;
}

interface BreadcrumbContextValue {
  labels: BreadcrumbLabelMap;
  setLabel: (key: string, label: string | undefined) => void;
}

const BreadcrumbContext = createContext<BreadcrumbContextValue | null>(null);

/** Scopes label overrides to the dashboard shell. Mount once in the layout. */
export function BreadcrumbProvider({ children }: { children: React.ReactNode }) {
  const [labels, setLabels] = useState<BreadcrumbLabelMap>({});

  const setLabel = useMemo(
    () => (key: string, label: string | undefined) => {
      setLabels((prev) => {
        if (label === undefined) {
          if (!(key in prev)) return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        }
        if (prev[key] === label) return prev;
        return { ...prev, [key]: label };
      });
    },
    [],
  );

  const value = useMemo(() => ({ labels, setLabel }), [labels, setLabel]);

  return <BreadcrumbContext.Provider value={value}>{children}</BreadcrumbContext.Provider>;
}

function useBreadcrumbContext(): BreadcrumbContextValue {
  const ctx = useContext(BreadcrumbContext);
  if (!ctx) {
    throw new Error("useBreadcrumbContext must be used within BreadcrumbProvider");
  }
  return ctx;
}

export function useBreadcrumbLabels(): BreadcrumbLabelMap {
  return useBreadcrumbContext().labels;
}

/**
 * Call from a detail page once its entity has loaded, e.g.
 * `useSetBreadcrumbLabel(monitor?.id, monitor?.name)`.
 * Registers a human-readable label for a dynamic route segment (an ID) and
 * cleans it up on unmount so stale labels don't leak into other pages.
 */
export function useSetBreadcrumbLabel(key: string | undefined, label: string | undefined) {
  const { setLabel } = useBreadcrumbContext();

  useEffect(() => {
    if (!key || !label) return;
    setLabel(key, label);
    return () => setLabel(key, undefined);
  }, [key, label, setLabel]);
}
