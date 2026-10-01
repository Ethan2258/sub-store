// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 ZHENG YI HENG

// Tabs other than subscriptions load on demand (router/index.ts) so the first
// page downloads less. Fetch them once the app has started and is idle, so the
// first switch to another tab is still instant. Skipped when the browser is
// asked to save data; the tabs then load when opened.
const tabPages = [
  () => import('@/views/File.vue'),
  () => import('@/views/Sync.vue'),
  () => import('@/views/My.vue'),
];

const START_DELAY_MS = 1500;

export const prefetchTabPages = () => {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return;

  const load = () => tabPages.forEach((page) => page().catch(() => {}));
  window.setTimeout(() => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(load, { timeout: 3000 });
    } else {
      load();
    }
  }, START_DELAY_MS);
};
