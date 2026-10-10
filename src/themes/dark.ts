// Neutral dark theme: near-black page with a faint blue undertone, solid
// raised cards, hairline borders. Floating bars keep a translucent blur.
export default {
  meta: {
    name: '黑白灰',
    author: 'Ethan',
    label: 'dark',
    extend: '',
  },
  colors: {
    'primary-color': '#eef1f5',
    'primary-color-end': '#eef1f5',
    'second-color': '#c4c9d2',
    'third-color': '#8a909b',
    'button-text-color': '#0b0c0e',

    'danger-color': '#c4c9d2',
    'succeed-color': '#eef1f5',

    'icon-nav-bar-right': '#d9dde4',
    'unimportant-icon-color': '#ffffff4d',

    'status-bar-background-color': '#0b0c0e',
    'background-color': '#0b0c0e',
    'nav-bar-color': '#0b0c0ed9',
    'tab-bar-color': '#16181c80',
    'popup-color': '#1a1c21',
    'divider-color': '#ffffff12',
    'card-color': '#16181c',
    'dialog-color': '#1a1c21',
    'switch-close-background-color': '#33363d',
    'switch-active-background-color': '#eef1f5',
    'compare-item-background-color': '#1f2228',
    'picker-mask-near-color': '#1a1c2166',
    'picker-mask-far-color': '#1a1c21',

    'primary-text-color': '#f3f5f8',
    'second-text-color': '#d9dde4',
    'comment-text-color': '#b7bdc7',
    'lowest-text-color': '#9ca2ad',

    'img-brightness': '100',
    'nav-bar-blur': '20px',
    'tab-bar-blur': '16px',
    'sticky-title-blur': '20px',

    // Design tokens used by design-system.scss.
    'surface-2': '#1f2228',
    'surface-3': '#2a2d34',
    'stroke': '#ffffff0f',
    'stroke-strong': '#ffffff1f',
    'focus-ring': '#ffffff33',
    'card-shadow': 'none',
    'float-shadow': '0 16px 40px #00000080, 0 2px 8px #0000004d',
    'flow-fill': '#ffffff0f',
    'flow-fill-high': '#ffffff1a',
    'flow-edge': '#ffffff2e',
    // Kept for components that still read the old glass names.
    'glass-stroke': '#ffffff0f',
    'glass-highlight': 'transparent',
    'glass-fill': '#1f2228',
    'glass-sheen': 'transparent',

    'compare-tag-text-color': '#d9dde4',
    'compare-tag-background-color': '#2a2d34',
  },
};
