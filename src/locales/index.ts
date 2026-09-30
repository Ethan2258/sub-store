import { createI18n } from "vue-i18n";

import { getInitialLocale, type SupportedLocale } from "./languages";
import { localeLoaders } from "./loaders";

const initialLocale = getInitialLocale();

const i18n = createI18n({
  locale: initialLocale, // 初始化配置语言
  messages: {},
});

// Messages are loaded on demand; call this before showing a language.
export const loadLocaleMessages = async (locale: SupportedLocale) => {
  if (i18n.global.availableLocales.includes(locale)) return;

  const { default: messages } = await localeLoaders[locale]();
  i18n.global.setLocaleMessage(locale, messages);
};

export const loadInitialLocaleMessages = () => loadLocaleMessages(initialLocale);

export default i18n;
