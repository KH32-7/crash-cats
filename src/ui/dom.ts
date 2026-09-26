import { ICONS, type IconName } from './icons';

export type Child = Node | string | number | null | undefined | false | Child[];
export type Props = Record<string, unknown>;

/** Tiny hyperscript helper. `onClick` etc. become listeners; `class`, `style`, `html` are special. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'style') el.setAttribute('style', String(v));
      else if (k === 'html') el.innerHTML = String(v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el: Element, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function icon(name: IconName, cls = ''): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = `ico ${cls}`.trim();
  s.innerHTML = ICONS[name];
  return s;
}

/** Only touch the DOM if the text actually changed (HUD hot path). */
export function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export function toggle(el: Element, cls: string, on: boolean): void {
  if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
}

export const ASSET = (file: string): string => `${import.meta.env.BASE_URL}assets/img/${file}`;

export function img(file: string, cls = '', alt = ''): HTMLImageElement {
  return h('img', { src: ASSET(file), class: cls, alt, draggable: 'false', decoding: 'async' });
}

export function fmt(n: number): string {
  return Math.round(n).toLocaleString('ko-KR');
}

export function signed(n: number): string {
  return n > 0 ? `+${fmt(n)}` : n < 0 ? `-${fmt(-n)}` : '0';
}

/** Animate a number in `el` from `from` to `to`. Returns a cancel fn. */
export function countUp(el: Element, from: number, to: number, ms: number, format: (n: number) => string = fmt): () => void {
  const t0 = performance.now();
  let raf = 0;
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / ms);
    const e = 1 - Math.pow(1 - k, 3);
    setText(el, format(from + (to - from) * e));
    if (k < 1) raf = requestAnimationFrame(step);
  };
  setText(el, format(from));
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

/** Restart a CSS animation class. */
export function pulse(el: Element, cls: string): void {
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
}

export function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Red ribbon banner with notched tails. */
export function ribbon(text: string, cls = ''): HTMLDivElement {
  return h('div', { class: `ribbon ${cls}`.trim() }, h('span', { class: 'ribbon-body' }, text));
}

export function backButton(onClick: () => void, label = '뒤로'): HTMLButtonElement {
  const b = h('button', { class: 'back-btn', type: 'button', 'aria-label': label, title: label, onClick }, icon('back'));
  return b;
}
