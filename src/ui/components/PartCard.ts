import type { AppApi } from '../../app/AppApi';
import { getPart } from '../../shared/parts';
import { append, h, icon } from '../dom';
import { rarityColor, rarityName } from '../partInfo';

export interface PartCardOpts {
  id: string;
  level: number;
  equipped?: boolean;
  selected?: boolean;
  fusable?: boolean;
  dim?: boolean;
  size?: 'sm' | 'md' | 'lg';
  showLevel?: boolean;
  onClick?: () => void;
  tag?: string;
}

/** Cream part card with rarity rim, level badge and equipped check. */
export function partCard(app: AppApi, o: PartCardOpts): HTMLElement {
  const def = getPart(o.id);
  const cls = [
    'pcard',
    `pcard-${o.size ?? 'md'}`,
    `r-${def.rarity}`,
    o.selected ? 'sel' : '',
    o.equipped ? 'eq' : '',
    o.dim ? 'dim' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const tagName = o.onClick ? 'button' : 'div';
  const el = document.createElement(tagName);
  el.className = cls;
  el.style.setProperty('--rc', rarityColor(def.rarity));
  if (o.onClick) {
    (el as HTMLButtonElement).type = 'button';
    el.addEventListener('click', o.onClick);
  }
  el.setAttribute('aria-label', `${def.name} Lv.${o.level} ${rarityName(def.rarity)}${o.equipped ? ' 장착 중' : ''}`);
  if (o.selected) el.setAttribute('aria-pressed', 'true');
  append(el, [
    h('span', { class: 'pc-art' }, h('img', { src: app.partIcon(o.id), alt: '', draggable: 'false' })),
    h('span', { class: 'pc-name' }, def.name),
    o.showLevel !== false ? h('span', { class: 'pc-lv' }, h('small', null, 'Lv'), String(o.level)) : null,
    o.equipped ? h('span', { class: 'pc-eq', title: '장착 중' }, icon('check')) : null,
    o.fusable ? h('span', { class: 'pc-fuse', title: '합성 가능' }, icon('up')) : null,
    o.tag ? h('span', { class: 'pc-tag' }, o.tag) : null,
  ]);
  return el;
}
