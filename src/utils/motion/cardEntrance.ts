// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 ZHENG YI HENG

import { isPageTransitionRunning } from './pageTransitions';

// List cards rise into place one after another when they first appear, e.g.
// when the subscriptions arrive after the app starts. Each card animates once:
// dragging, sorting or refreshing a list moves or reuses the same elements and
// does not replay it. During a page transition the whole page is already
// animating, so cards added then appear as they are.

const CARD_SELECTOR = '.sub-item-wrapper';
// Sortable's floating copy of the card being dragged.
const DRAG_COPY_SELECTOR = '.sortable-fallback, .sortable-drag';
const STAGGER_MS = 36;
const MAX_STAGGER_STEPS = 8;

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const seen = new WeakSet<Element>();

const collectCards = (records: MutationRecord[]) => {
  const cards: HTMLElement[] = [];
  records.forEach((record) => {
    record.addedNodes.forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      if (node.matches(CARD_SELECTOR)) cards.push(node);
      node.querySelectorAll<HTMLElement>(CARD_SELECTOR).forEach((card) => cards.push(card));
    });
  });
  return cards;
};

export const installCardEntrance = (container: HTMLElement) => {
  if (typeof container.animate !== 'function' || typeof MutationObserver === 'undefined') return;

  const observer = new MutationObserver((records) => {
    const cards = collectCards(records).filter((card) => {
      if (seen.has(card)) return false;
      seen.add(card);
      return true;
    });
    if (cards.length === 0 || reducedMotion.matches || isPageTransitionRunning()) return;

    const viewportHeight = window.innerHeight;
    let step = 0;
    cards.forEach((card) => {
      if (card.closest(DRAG_COPY_SELECTOR)) return;
      const rect = card.getBoundingClientRect();
      // Cards below the fold are not seen arriving, so skip their work.
      if (rect.height === 0 || rect.top > viewportHeight || rect.bottom < 0) return;

      card.animate(
        [
          { opacity: 0, transform: 'translateY(14px) scale(0.98)' },
          { opacity: 1, transform: 'none' },
        ],
        {
          duration: 460,
          delay: Math.min(step, MAX_STAGGER_STEPS) * STAGGER_MS,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          fill: 'backwards',
        },
      );
      step += 1;
    });
  });

  observer.observe(container, { childList: true, subtree: true });
};
