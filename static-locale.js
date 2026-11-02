import { applyStaticTranslations, initializeLanguage, subscribeLanguage, getLanguage } from './i18n.js';
import catalog from './i18n-html.js';

// Capture the static DOM before popup rendering replaces status text and options.
export const staticLocaleReady = (async () => {
  await initializeLanguage();
  const translateStatic = applyStaticTranslations(document.body, catalog);
  const renderStatic = () => {
    document.documentElement.lang = getLanguage() === 'zh_CN' ? 'zh-CN' : 'en';
    translateStatic();
  };
  renderStatic();
  subscribeLanguage(renderStatic);
})();

await staticLocaleReady;
await import('./popup.js');
