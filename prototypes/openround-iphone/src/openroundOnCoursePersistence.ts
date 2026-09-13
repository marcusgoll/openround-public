export type OnCourseStorage = Pick<Storage, "getItem" | "setItem">;

export function getBrowserOnCourseStorage(): OnCourseStorage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function createMemoryOnCourseStorage(
  initial: Readonly<Record<string, string>> = {},
): OnCourseStorage {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}
