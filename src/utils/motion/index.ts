// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 ZHENG YI HENG

import type { Router } from 'vue-router';

import { installCardEntrance } from './cardEntrance';
import { installPageTransitions } from './pageTransitions';

export const installMotion = (router: Router, appContainer: HTMLElement) => {
  installPageTransitions(router);
  installCardEntrance(appContainer);

  // iOS Safari only applies :active (the press feedback in motion.scss) when
  // a touchstart listener exists; a passive one costs nothing while scrolling.
  document.addEventListener('touchstart', () => {}, { passive: true });
};
