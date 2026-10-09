import '@/assets/styles/fonts.scss';
import '@/assets/styles/global.scss';
import '@/assets/styles/overwritten_css_var.scss';
// import VConsole from 'vconsole';
// const vConsole = new VConsole();
import SvgIcon from '@/components/SvgIcon.vue';
import i18n, { loadInitialLocaleMessages } from '@/locales';
import '@/plugin/awesomeIcon';

import nutUi from '@/plugin/nutui';
import router from '@/router';
import '@/plugin/touch.js'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';

import 'modern-css-reset/dist/reset.min.css';
import '@/assets/styles/reduced-motion-fix.scss';
import '@/assets/styles/design-system.scss';
import '@/assets/styles/motion.scss';
import { createPinia } from 'pinia';
import 'virtual:svg-icons-register';
import { createApp } from 'vue';

import App from './App.vue';
import { installMotion } from '@/utils/motion';
import { prefetchTabPages } from '@/utils/prefetch';

export async function initializeApp() {
  try {
    await loadInitialLocaleMessages();
  } catch (e) {
    // Still start the app; untranslated text shows its message keys.
    console.error('Failed to load language messages', e);
  }

  // 创建一个回调函数来处理变化
  const callback = function(mutationsList, observer) {
    for(let mutation of mutationsList) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
            if (document.body.classList.contains('nut-overflow-hidden')) {
                document.body.classList.remove('nut-overflow-hidden');
            }
        }
    }
  };

  // 创建一个观察器实例，将回调函数作为参数
  const observer = new MutationObserver(callback);

  // 开始观察`body`元素上的`class`属性的变化
  observer.observe(document.body, { attributes: true });
  const pinia = createPinia();
  const app = createApp(App);

  nutUi(app);
  installMotion(router, document.getElementById('app') as HTMLElement);
  app.use(router);
  app.use(pinia);
  app.use(i18n);
  app.component('font-awesome-icon', FontAwesomeIcon);
  app.component('svg-icon', SvgIcon);
  app.mount('#app');
  prefetchTabPages();
}
