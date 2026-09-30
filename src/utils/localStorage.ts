/**
 * Reads JSON persisted by the application without letting an interrupted or
 * manually edited value prevent the application from starting.
 */
export const readLocalStorageJson = <T>(
  key: string,
  isValid: (value: unknown) => value is T,
): T | undefined => {
  const rawValue = localStorage.getItem(key);
  if (rawValue === null) return undefined;

  try {
    const value: unknown = JSON.parse(rawValue);
    if (isValid(value)) return value;
  } catch {
    // Fall through to remove the invalid cache entry.
  }

  localStorage.removeItem(key);
  return undefined;
};
