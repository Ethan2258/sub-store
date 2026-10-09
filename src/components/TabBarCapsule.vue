<!--
  SPDX-License-Identifier: GPL-3.0-only
  Copyright (C) 2026 ZHENG YI HENG

  The glass capsule behind the active tab. It is one element that slides to
  the tab that becomes active and briefly stretches on the way, like a drop of
  liquid, instead of a separate capsule appearing under each tab.
  Place it as the first child of <nut-tabbar> so the tab icons draw above it.
-->
<template>
  <span
    ref="capsule"
    class="tabbar-capsule"
    :class="{ 'is-ready': isReady, 'is-hidden': !isVisible }"
    :style="{ transform: `translate3d(${x}px, ${y}px, 0)` }"
    aria-hidden="true"
  >
    <span ref="glass" class="tabbar-capsule__glass" />
  </span>
</template>

<script lang="ts" setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps<{
  // Index of the active <nut-tabbar-item>, counting hidden ones.
  activeIndex: number;
}>();

const CAPSULE_WIDTH = 64;
const CAPSULE_TOP_OFFSET = -2;

const capsule = ref<HTMLElement>();
const glass = ref<HTMLElement>();
const x = ref(0);
const y = ref(0);
const isVisible = ref(false);
// Transitions start only after the first placement, so the capsule does not
// slide in from the left edge when the page loads.
const isReady = ref(false);

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let resizeObserver: ResizeObserver | undefined;

const getItems = () => {
  const bar = capsule.value?.parentElement;
  return bar ? Array.from(bar.querySelectorAll<HTMLElement>(':scope > .nut-tabbar-item')) : [];
};

const place = () => {
  const bar = capsule.value?.parentElement;
  const item = getItems()[props.activeIndex];
  if (!bar || !item || item.offsetParent === null) {
    isVisible.value = false;
    return;
  }

  const barRect = bar.getBoundingClientRect();
  const itemRect = item.getBoundingClientRect();
  x.value = itemRect.left - barRect.left + itemRect.width / 2 - CAPSULE_WIDTH / 2;
  y.value = itemRect.top - barRect.top + CAPSULE_TOP_OFFSET;
  isVisible.value = true;
};

const stretch = (distance: number) => {
  if (!glass.value || typeof glass.value.animate !== 'function' || reducedMotion.matches) return;
  // Longer jumps stretch a little more.
  const amount = Math.min(0.3, 0.08 + Math.abs(distance) / 600);
  glass.value.animate(
    [
      { transform: 'scale(1, 1)' },
      { transform: `scale(${1 + amount}, ${1 - amount / 3})`, offset: 0.35 },
      { transform: `scale(${1 - amount / 5}, ${1 + amount / 8})`, offset: 0.72 },
      { transform: 'scale(1, 1)' },
    ],
    { duration: 560, easing: 'ease-out' },
  );
};

watch(
  () => props.activeIndex,
  () => {
    const previousX = x.value;
    const wasVisible = isVisible.value;
    place();
    if (isReady.value && wasVisible && isVisible.value && previousX !== x.value) {
      stretch(x.value - previousX);
    }
  },
  { flush: 'post' },
);

onMounted(async () => {
  await nextTick();
  place();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    isReady.value = true;
  }));

  // Tabs can be shown or hidden in settings and the bar resizes with the
  // window; both move the active tab.
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => place());
    getItems().forEach((item) => resizeObserver?.observe(item));
  } else {
    window.addEventListener('resize', place);
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  window.removeEventListener('resize', place);
});
</script>

<style lang="scss">
.tabbar-capsule {
  position: absolute;
  top: 0;
  left: 0;
  width: 64px;
  height: 40px;
  pointer-events: none;

  &.is-ready {
    // A slight overshoot so the capsule settles like a spring.
    transition:
      transform 540ms cubic-bezier(0.3, 1.3, 0.45, 1),
      opacity 200ms ease;
  }

  &.is-hidden {
    opacity: 0;
  }
}

.tabbar-capsule__glass {
  display: block;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  border-radius: 999px;
  background: var(--surface-2, var(--glass-fill));
  border: 0;
  box-shadow: none;
}
</style>
