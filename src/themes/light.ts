// Neutral light theme: white surfaces on a cool grey page, solid cards,
// hairline borders. Floating bars keep a light translucent blur.
export default {
  meta: {
    name: '黑白灰',
    author: 'Ethan',
    label: 'light',
    extend: '',
  },
  colors: {
    'primary-color': '#15171c',
    'primary-color-end': '#15171c',
    'second-color': '#4b5260',
    'third-color': '#8a909b',
    'button-text-color': '#ffffff',

    'danger-color': '#2b2f37',
    'succeed-color': '#15171c',

    'icon-nav-bar-right': '#4b5260',
    'unimportant-icon-color': '#10141c38',

    'status-bar-background-color': '#f2f3f6',
    'background-color': '#f2f3f6',
    'nav-bar-color': '#f2f3f6d9',
    'tab-bar-color': '#ffffffb3',
    'popup-color': '#ffffff',
    'divider-color': '#10141c14',
    'card-color': '#ffffff',
    'dialog-color': '#ffffff',
    'switch-close-background-color': '#dfe2e8',
    'switch-active-background-color': '#15171c',
    'compare-item-background-color': '#eef0f4',
    'picker-mask-near-color': '#ffffff66',
    'picker-mask-far-color': '#ffffff',

    'primary-text-color': '#111318',
    'second-text-color': '#2b2f37',
    'comment-text-color': '#4b5260',
    'lowest-text-color': '#5f6673',

    'img-brightness': '0',
    'nav-bar-blur': '20px',
    'tab-bar-blur': '16px',
    'sticky-title-blur': '20px',

    // Design tokens used by design-system.scss.
    'surface-2': '#eef0f4',
    'surface-3': '#e3e6ec',
    'stroke': '#10141c0f',
    'stroke-strong': '#10141c1f',
    'focus-ring': '#10141c2e',
    'card-shadow': '0 1px 2px #10141c0a',
    'float-shadow': '0 12px 32px #10141c1f, 0 2px 6px #10141c0f',
    'flow-fill': '#10141c09',
    'flow-fill-high': '#10141c12',
    'flow-edge': '#10141c24',
    // Kept for components that still read the old glass names.
    'glass-stroke': '#10141c0f',
    'glass-highlight': 'transparent',
    'glass-fill': '#eef0f4',
    'glass-sheen': 'transparent',

    'compare-tag-text-color': '#2b2f37',
    'compare-tag-background-color': '#eef0f4',
  },
};
