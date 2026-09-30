// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 ZHENG YI HENG

import { nextTick } from 'vue';
import type { RouteLocationNormalized, Router } from 'vue-router';

// Animates route changes with the View Transitions API. Switching tabs fades
// the page; opening a page slides it in from the right and going back slides
// it out. The nav bar, tab bar and side bar keep their place (see motion.scss).
// Browsers without the API, and users who ask for reduced motion, get the
// instant change they had before.

export type PageTransitionDirection = 'fade' | 'forward' | 'back';

type ViewTransitionLike = { finished: Promise<void> };
type StartViewTransition = (update: () => Promise<void>) => ViewTransitionLike;

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

let running = 0;

/** True while a page transition animates, so other entrance effects can wait. */
export const isPageTransitionRunning = () => running > 0;

const isTabRoute = (route: RouteLocationNormalized) => route.meta?.needTabBar === true;

const getHistoryPosition = (): number | undefined => {
  const position = window.history.state?.position;
  return typeof position === 'number' ? position : undefined;
};

const getDirection = (
  to: RouteLocationNormalized,
  from: RouteLocationNormalized,
  pop: PopInfo | null,
  currentPosition: number | undefined,
): PageTransitionDirection => {
  if (isTabRoute(to) && isTabRoute(from)) return 'fade';

  if (pop && pop.position !== undefined && currentPosition !== undefined) {
    return pop.position < currentPosition ? 'back' : 'forward';
  }

  const toDepth = isTabRoute(to) ? 0 : 1;
  const fromDepth = isTabRoute(from) ? 0 : 1;
  return toDepth < fromDepth ? 'back' : 'forward';
};

type PopInfo = {
  position?: number;
  // The browser already animated this navigation (e.g. iOS swipe back).
  hasUAVisualTransition: boolean;
};

export const installPageTransitions = (router: Router) => {
  const startViewTransition = (document as Document & {
    startViewTransition?: StartViewTransition;
  }).startViewTransition?.bind(document);
  if (!startViewTransition) return;

  const root = document.documentElement;
  let pendingPop: PopInfo | null = null;
  let currentPosition = getHistoryPosition();
  let finishUpdate: (() => void) | null = null;

  // Registered in the capture phase so it runs before vue-router reacts to the
  // same event and starts the navigation.
  window.addEventListener(
    'popstate',
    (event) => {
      pendingPop = {
        position: typeof event.state?.position === 'number' ? event.state.position : undefined,
        hasUAVisualTransition: (event as PopStateEvent & { hasUAVisualTransition?: boolean })
          .hasUAVisualTransition === true,
      };
    },
    true,
  );

  const finish = () => {
    const done = finishUpdate;
    finishUpdate = null;
    done?.();
  };

  router.beforeResolve((to, from) => {
    const pop = pendingPop;
    pendingPop = null;

    if (
      reducedMotion.matches
      || document.visibilityState === 'hidden'
      || from.matched.length === 0
      || to.path === from.path
      || pop?.hasUAVisualTransition
    ) {
      return true;
    }

    // A navigation that starts while the previous one is still updating
    // replaces it; release the earlier update so it does not wait for nothing.
    finish();

    const direction = getDirection(to, from, pop, currentPosition);

    return new Promise<boolean>((resolve) => {
      let resolved = false;
      const proceed = () => {
        if (resolved) return;
        resolved = true;
        resolve(true);
      };

      const settle = () => {
        running -= 1;
        if (running === 0) delete root.dataset.pageTransition;
      };

      root.dataset.pageTransition = direction;
      running += 1;

      try {
        startViewTransition(
          () => new Promise<void>((done) => {
            // The navigation already went ahead without waiting (see below).
            if (resolved) {
              done();
              return;
            }
            finishUpdate = done;
            proceed();
            // Never keep the page frozen if the navigation does not complete.
            window.setTimeout(done, 1500);
          }),
        ).finished.finally(settle);
      } catch {
        settle();
        proceed();
        return;
      }

      // The browser calls the update callback even when it skips the
      // animation; this only guards against it never getting to that.
      window.setTimeout(proceed, 500);
    });
  });

  router.afterEach(async () => {
    pendingPop = null;
    currentPosition = getHistoryPosition() ?? currentPosition;
    if (!finishUpdate) return;

    // The router's own afterEach restores the scroll position after the next
    // tick; let that run first so the new page is captured where it will stay.
    await nextTick();
    finish();
  });

  router.onError(finish);
};
