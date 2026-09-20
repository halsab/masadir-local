export const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export const button = (
  label: string,
  className: string,
  action: () => void,
): HTMLButtonElement => {
  const node = element('button', className, label);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
};

export const setBusy = (root: HTMLElement, busy: boolean): void => {
  root.setAttribute('aria-busy', String(busy));
};
