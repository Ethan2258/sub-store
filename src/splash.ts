import { getInitialLocale } from './locales/languages';
import { localeLoaders } from './locales/loaders';

// Download the current language alongside the app instead of after it.
// initializeApp waits for it and handles a failed download.
localeLoaders[getInitialLocale()]().catch(() => {});

setTimeout(() => {
  import('./main').then(({ initializeApp }) => {
    initializeApp();
  });
}, 10);
