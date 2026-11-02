const SUPPORTED = new Set(['en', 'zh_CN']);
let language = 'en';
let initialization;
const subscribers = new Set();
export const getLanguage = () => language;
function notify(value) {
  const next = SUPPORTED.has(value) ? value : 'en';
  if (next === language) return;
  language = next;
  for (const callback of subscribers) callback(language);
}
export function subscribeLanguage(callback) {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}
export function initializeLanguage() {
  if (!initialization) initialization = (async () => {
    try {
      const values = await globalThis.chrome?.storage?.local?.get(['uiLanguage']);
      notify(values?.uiLanguage);
    } catch { notify('en'); }
    return language;
  })();
  return initialization;
}
export async function setLanguage(value) {
  if (!SUPPORTED.has(value)) throw new Error('Unsupported language.');
  await globalThis.chrome.storage.local.set({uiLanguage: value});
  notify(value);
}
globalThis.chrome?.storage?.onChanged?.addListener((changes, area) => {
  if (area === 'local' && changes.uiLanguage) notify(changes.uiLanguage.newValue);
});
export function createTranslator(catalog) {
  return (source, ...values) => {
    const tagged = Array.isArray(source) && Object.hasOwn(source, 'raw');
    const key = tagged ? source.reduce((text, part, index) => text + (index ? `{${index - 1}}` : '') + part, '') : source;
    const template = language === 'zh_CN' ? key : (catalog[key] ?? key);
    return tagged ? template.replace(/\{(\d+)\}/g, (_, index) => String(values[Number(index)] ?? '')) : template;
  };
}
export function applyStaticTranslations(root, catalog) {
  const entries = [];
  const walker = root.ownerDocument.createTreeWalker(root, 4);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest('script,style,textarea')) continue;
    const original = node.textContent;
    const key = original.trim();
    if (Object.hasOwn(catalog, key)) entries.push(() => {
      if (node.isConnected) node.textContent = original.replace(key, language === 'zh_CN' ? key : catalog[key]);
    });
  }
  // Capture only initial static nodes. Never walk again over rendered prompts,
  // imported content, user-defined labels, or conversation titles.
  for (const element of [root, ...root.querySelectorAll('*')]) {
    for (const attribute of ['title','aria-label','placeholder']) {
      const original = element.getAttribute(attribute);
      if (original !== null && Object.hasOwn(catalog, original)) entries.push(() => {
        if (element.isConnected) element.setAttribute(attribute, language === 'zh_CN' ? original : catalog[original]);
      });
    }
  }
  const render = () => { for (const update of entries) update(); };
  render();
  return render;
}
