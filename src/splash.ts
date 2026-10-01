import { getInitialLocale } from './locales/languages';
import { localeLoaders } from './locales/loaders';

// Download the current language alongside the app instead of after it.
// initializeApp waits for it and handles a failed download.
localeLoaders[getInitialLocale()]().catch(() => {});

// This script runs as soon as it downloads, and with the app preloaded from
// index.html the app can be ready before the page body has been parsed. Start
// it only once the body (and #app in it) exists.
const domReady = new Promise<void>((resolve) => {
  if (document.readyState !== 'loading') resolve();
  else document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
});

setTimeout(() => {
  Promise.all([import('./main'), domReady]).then(([{ initializeApp }]) => {
    initializeApp();
  });
}, 10);
