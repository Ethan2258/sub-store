import type { SupportedLocale } from "./languages";

// Each language is its own chunk, so the first page only downloads the one it
// shows. splash.ts and loadLocaleMessages share these imports, and the browser
// fetches each chunk once however many times it is imported.
export const localeLoaders: Record<
  SupportedLocale,
  () => Promise<{ default: Record<string, any> }>
> = {
  zh: () => import("./zh"),
  en: () => import("./en"),
  ru: () => import("./ru"),
};
