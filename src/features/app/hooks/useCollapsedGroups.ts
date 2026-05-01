import { useCallback, useState } from "react";

export function useCollapsedGroups(
  storageKey: string,
  defaultCollapsedGroupIds: string[] = [],
) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    const defaultSet = new Set(defaultCollapsedGroupIds);
    if (typeof window === "undefined") {
      return defaultSet;
    }
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return defaultSet;
    }
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return new Set(parsed.filter((value) => typeof value === "string"));
      }
    } catch {
      // Ignore invalid stored data.
    }
    return defaultSet;
  });

  const persistCollapsedGroups = useCallback(
    (next: Set<string>) => {
      if (typeof window === "undefined") {
        return;
      }
      window.localStorage.setItem(
        storageKey,
        JSON.stringify(Array.from(next)),
      );
    },
    [storageKey],
  );

  const toggleGroupCollapse = useCallback(
    (groupId: string) => {
      setCollapsedGroups((prev) => {
        const next = new Set(prev);
        if (next.has(groupId)) {
          next.delete(groupId);
        } else {
          next.add(groupId);
        }
        persistCollapsedGroups(next);
        return next;
      });
    },
    [persistCollapsedGroups],
  );

  return { collapsedGroups, toggleGroupCollapse };
}
