export type MessageKey = Parameters<typeof browser.i18n.getMessage>[0];

export function msg(key: MessageKey, substitutions?: string | string[]): string {
  return browser.i18n.getMessage(key, substitutions) || key;
}

export function localiseDocument(root: ParentNode = document): void {
  document.documentElement.lang = browser.i18n.getUILanguage();
  for (const element of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = element.dataset.i18n;
    if (key) element.textContent = msg(key as MessageKey);
  }
  for (const element of root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]')) {
    const key = element.dataset.i18nPlaceholder;
    if (key) element.placeholder = msg(key as MessageKey);
  }
}
