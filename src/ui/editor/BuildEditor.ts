import type { SlotKind } from '../../app/Store';
import { fuseCost } from '../../app/Store';
import { MAX_LEVEL, computeStats, getChassis, getPart, type PartKind } from '../../shared/parts';
import { partCard } from '../components/PartCard';
import { SlotHotspots, slotKey, type SlotRef } from '../components/SlotHotspots';
import type { UiCtx } from '../context';
import { append, clear, fmt, h, icon, img, pulse } from '../dom';
import { KIND_ICON, KIND_NAME, MOUNT_NAME, partStats, rarityColor, rarityName, sellValue, slotName } from '../partInfo';
import type { EditorAdapter, EditorItem } from './adapters';

const TABS: PartKind[] = ['chassis', 'wheel', 'weapon', 'gadget'];
export const PAINTS = ['#e23b35', '#ff8a1f', '#f5c21b', '#3fae4a', '#3f8fe0', '#8a5ad6'];

/**
 * CATS-style build editor: 3D car frame with slot rings, part cards by tab,
 * detail panel with equip / fuse / sell. Shared by the garage and the P2 builder.
 */
export class BuildEditor {
  readonly el: HTMLElement;
  readonly statsEl: HTMLElement;
  readonly frameEl: HTMLElement;
  /** Extra actions area at the end of the side panel (P2 builder). */
  readonly footerEl: HTMLElement;
  private readonly paintsEl: HTMLElement;
  private readonly paintBtn: HTMLButtonElement;
  private readonly paintPop: HTMLElement;
  private readonly sideEl: HTMLElement;
  private readonly detailEl: HTMLElement;
  private readonly tabsEl: HTMLElement;
  private readonly tabList: HTMLElement;
  private readonly filterEl: HTMLElement;
  private readonly cardsEl: HTMLElement;
  private readonly hs: SlotHotspots;
  private tab: PartKind = 'weapon';
  private selKey: string | null = null;
  private selSlot: SlotRef | null = null;
  private unsub: (() => void) | null = null;
  private busy = false;
  private readonly onDocDown = (e: PointerEvent) => {
    if (this.paintPop.hidden) return;
    const t = e.target as Node;
    if (!this.paintPop.contains(t) && !this.paintBtn.contains(t)) this.setPaintOpen(false);
  };

  constructor(
    private readonly ctx: UiCtx,
    readonly ad: EditorAdapter,
  ) {
    this.statsEl = h('div', { class: 'build-stats' });
    this.paintsEl = h('div', { class: 'paints', role: 'radiogroup', 'aria-label': '페인트' });
    this.frameEl = h('div', { class: 'ed-frame frame' });
    this.detailEl = h('div', { class: 'ed-detail' });
    this.tabList = h('div', { class: 'ed-tablist', role: 'tablist' });
    this.paintBtn = h(
      'button',
      { class: 'paint-btn', type: 'button', 'aria-label': '페인트', title: '페인트', 'aria-expanded': 'false', onClick: () => this.setPaintOpen(this.paintPop.hidden !== false) },
      h('i', { class: 'paint-dot' }),
    );
    this.paintPop = h('div', { class: 'paint-pop', role: 'radiogroup', 'aria-label': '페인트', hidden: true });
    this.tabsEl = h('div', { class: 'ed-tabs' }, this.tabList, this.paintBtn, this.paintPop);
    this.filterEl = h('div', { class: 'ed-filter' });
    this.cardsEl = h('div', { class: 'ed-cards' });
    this.footerEl = h('div', { class: 'ed-footer' });
    this.hs = new SlotHotspots(ctx.app, (s) => this.onSlot(s));
    this.el = h(
      'div',
      { class: `editor mode-${ad.mode}` },
      this.hs.el,
      h('div', { class: 'ed-stage' }, this.paintsEl, this.frameEl),
      (this.sideEl = h('div', { class: 'ed-side panel-dark' }, this.detailEl, this.tabsEl, this.filterEl, this.cardsEl, this.footerEl)),
    );
  }

  /**
   * Portrait: the car gets the whole band between the top bar and the parts panel, edge to edge
   * (header chips sit at the band's edges; the car is width-limited anyway). Landscape: null → use frameEl.
   */
  portraitFrame(): { left: number; top: number; width: number; height: number } | null {
    if (innerHeight <= innerWidth) return null;
    const screen = this.el.closest('.screen');
    if (!screen) return null;
    const sr = screen.getBoundingClientRect();
    const top = sr.top + parseFloat(getComputedStyle(screen).paddingTop || '0');
    const bottom = this.sideEl.getBoundingClientRect().top - 6;
    if (bottom - top < 60) return null;
    return { left: 0, top, width: innerWidth, height: bottom - top };
  }

  private setPaintOpen(open: boolean): void {
    this.paintPop.hidden = !open;
    this.paintBtn.setAttribute('aria-expanded', String(open));
    this.paintBtn.classList.toggle('on', open);
    if (open) this.ctx.sfx('click');
  }

  enter(): void {
    this.unsub?.();
    this.unsub = this.ad.subscribe(() => this.render());
    this.selKey = null;
    this.selSlot = null;
    this.ctx.app.garage.highlightSlot(null);
    this.hs.start();
    this.setPaintOpen(false);
    document.addEventListener('pointerdown', this.onDocDown, true);
    this.render();
  }

  leave(): void {
    this.unsub?.();
    this.unsub = null;
    document.removeEventListener('pointerdown', this.onDocDown, true);
    this.setPaintOpen(false);
    this.hs.stop();
    this.selSlot = null;
    this.ctx.app.garage.highlightSlot(null);
  }

  // ------------------------------------------------------------------ interactions

  private setSlot(slot: SlotRef | null): void {
    this.selSlot = slot;
    this.ctx.app.garage.highlightSlot(slot);
  }

  private onTab(kind: PartKind): void {
    if (kind === this.tab) return;
    this.ctx.sfx('click');
    this.tab = kind;
    if (this.selSlot && this.selSlot.kind !== kind) this.setSlot(null);
    this.cardsEl.scrollTo({ left: 0, top: 0 });
    this.render();
  }

  private onCard(item: EditorItem): void {
    const def = getPart(item.id);
    const s = this.selSlot;
    if (s && def.kind === s.kind) {
      if (this.ad.slotKey(s.kind, s.index) === item.key && this.ad.mode === 'player') {
        this.selKey = item.key;
        this.ctx.sfx('click');
        this.render();
        return;
      }
      if (this.ad.canEquip(s.kind, s.index, item.key)) {
        this.ad.equip(s.kind, s.index, item.key);
        this.ctx.sfx('equip');
        this.hs.flash(s);
        this.selKey = item.key;
        this.setSlot(null);
        this.render();
      } else {
        this.ctx.sfx('error');
        this.ctx.toast('이 슬롯에는 장착할 수 없어요', 'bad');
      }
      return;
    }
    this.ctx.sfx('click');
    // Tapping the selected card again deselects it.
    this.selKey = this.selKey === item.key ? null : item.key;
    this.render();
  }

  private onSlot(slot: SlotRef): void {
    const inSlot = this.ad.slotKey(slot.kind, slot.index);
    const same = this.selSlot && slotKey(this.selSlot) === slotKey(slot);
    if (same) {
      if (inSlot) {
        this.ad.equip(slot.kind, slot.index, null);
        this.ctx.sfx('unequip');
      } else this.ctx.sfx('click');
      this.setSlot(null);
      this.render();
      return;
    }
    // A compatible card is selected → drop it straight into the tapped slot.
    const sel = this.selKey ? this.ad.item(this.selKey) : undefined;
    if (sel && inSlot !== sel.key && getPart(sel.id).kind === slot.kind && this.ad.canEquip(slot.kind, slot.index, sel.key) && !this.selSlot) {
      this.ad.equip(slot.kind, slot.index, sel.key);
      this.ctx.sfx('equip');
      this.hs.flash(slot);
      this.render();
      return;
    }
    this.ctx.sfx('click');
    this.setSlot(slot);
    this.tab = slot.kind;
    this.selKey = inSlot;
    this.render();
  }

  private equipSelected(item: EditorItem): void {
    const def = getPart(item.id);
    if (def.kind === 'chassis') {
      this.ad.setChassis(item.key);
      this.ctx.sfx('equip');
      this.setSlot(null);
      return;
    }
    const s = this.selSlot;
    if (s && s.kind === def.kind && this.ad.canEquip(s.kind, s.index, item.key)) {
      this.ad.equip(s.kind, s.index, item.key);
      this.ctx.sfx('equip');
      this.hs.flash(s);
      this.setSlot(null);
      return;
    }
    const at = this.ad.autoEquip(item.key);
    if (!at) {
      this.ctx.sfx('error');
      const mounts = def.kind === 'weapon' ? def.mounts.map((m) => MOUNT_NAME[m]).join('/') : '';
      this.ctx.toast(mounts ? `이 차체에는 ${mounts} 무기 슬롯이 없어요` : '장착할 슬롯이 없어요', 'bad');
      return;
    }
    this.ctx.sfx('equip');
    this.hs.flash(at);
  }

  private unequipSelected(item: EditorItem): void {
    const s = this.selSlot;
    if (s && this.ad.slotKey(s.kind, s.index) === item.key) this.ad.equip(s.kind, s.index, null);
    else this.ad.unequip(item.key);
    this.setSlot(null);
    this.ctx.sfx('unequip');
  }

  private async fuse(item: EditorItem): Promise<void> {
    if (this.busy) return;
    const store = this.ctx.store;
    const partners = store.fusePartners(item.key);
    const def = getPart(item.id);
    if (!partners.length) return;
    const cost = fuseCost(item.level);
    const stats = partStats(def, item.level, true).filter((s) => s.next);
    const body = h(
      'div',
      { class: 'fuse-preview' },
      h(
        'div',
        { class: 'fuse-cards' },
        partCard(this.ctx.app, { id: item.id, level: item.level, size: 'sm' }),
        h('span', { class: 'fuse-op' }, icon('plus')),
        partCard(this.ctx.app, { id: item.id, level: item.level, size: 'sm' }),
        h('span', { class: 'fuse-op eq' }, '='),
        partCard(this.ctx.app, { id: item.id, level: item.level + 1, size: 'sm', tag: 'UP!' }),
      ),
      h(
        'div',
        { class: 'fuse-stats' },
        stats.map((s) => h('div', { class: 'fuse-stat' }, icon(s.icon), h('span', null, s.label), h('b', null, s.value), icon('back', 'arrow'), h('b', { class: 'up' }, s.next!))),
      ),
      h('p', { class: 'modal-text small' }, `같은 ${def.name} Lv.${item.level} 하나가 사용돼요.`),
    );
    this.busy = true;
    const ok = await this.ctx.confirm({ title: '합성', body, okText: fmt(cost), okIcon: img('coin.png', 'btn-coin') });
    this.busy = false;
    if (!ok) return;
    const partner = partners.find((p) => !store.isEquipped(p.uid)) ?? partners[0];
    const keepPartner = store.isEquipped(partner.uid) && !store.isEquipped(item.key);
    const [a, b] = keepPartner ? [partner.uid, item.key] : [item.key, partner.uid];
    const res = store.fuse(a, b);
    if (!res.ok) {
      this.ctx.sfx('error');
      this.ctx.toast(res.reason ?? '합성할 수 없어요', 'bad');
      return;
    }
    this.selKey = a;
    this.ctx.sfx('fuse');
    this.ctx.toast(`${def.name} Lv.${res.item?.level ?? item.level + 1} 달성!`, 'good');
    this.render();
    const art = this.detailEl.querySelector('.dt-art');
    if (art) pulse(art, 'fused');
  }

  private async sell(item: EditorItem): Promise<void> {
    if (this.busy) return;
    const def = getPart(item.id);
    const value = sellValue(def, item.level);
    this.busy = true;
    const ok = await this.ctx.confirm({
      title: '판매',
      body: h(
        'div',
        { class: 'sell-preview' },
        partCard(this.ctx.app, { id: item.id, level: item.level, size: 'sm' }),
        h('p', { class: 'modal-text' }, `${def.name} Lv.${item.level}을(를) 판매할까요?`, h('br'), h('small', null, '판매한 부품은 되돌릴 수 없어요.')),
      ),
      okText: `판매 +${fmt(value)}`,
      danger: true,
    });
    this.busy = false;
    if (!ok) return;
    const got = this.ctx.store.sell(item.key);
    if (got > 0) {
      this.ctx.sfx('coin');
      this.ctx.toast(`코인 +${fmt(got)}`, 'good');
      if (this.selKey === item.key) this.selKey = null;
      this.render();
    } else {
      this.ctx.sfx('error');
    }
  }

  // ------------------------------------------------------------------ render

  render(): void {
    const build = this.ad.build();
    const stats = computeStats(build);
    const slots = [...build.wheels, ...build.weapons, ...build.gadgets];
    const used = slots.filter(Boolean).length;
    clear(this.statsEl);
    this.statsEl.append(
      h('span', { class: 'bs hp', title: '체력' }, icon('heart'), h('b', { class: 'num' }, fmt(stats.hp))),
      h('span', { class: 'bs dmg', title: '공격력' }, icon('sword'), h('b', { class: 'num' }, fmt(stats.damage))),
      h('span', { class: 'bs slots', title: '슬롯' }, icon('gear'), h('b', { class: 'num' }, `${used}/${slots.length}`)),
    );

    // paints (left column in landscape, popover from the tabs row in portrait)
    const chassisDef = getChassis(build.chassis.id);
    for (const box of [this.paintsEl, this.paintPop]) {
      clear(box);
      for (const p of [undefined, ...PAINTS] as (string | undefined)[]) {
        const on = (build.paint ?? undefined) === p;
        box.appendChild(
          h(
            'button',
            {
              class: `swatch ${on ? 'on' : ''} ${p ? '' : 'default'}`,
              type: 'button',
              role: 'radio',
              'aria-checked': String(on),
              'aria-label': p ? `페인트 ${p}` : '기본 색상',
              title: p ? '페인트' : '기본 색상',
              style: `--sw:${p ?? chassisDef.color}`,
              onClick: () => {
                if (box === this.paintPop) this.setPaintOpen(false);
                if (on) return;
                this.ctx.sfx('click');
                this.ad.setPaint(p);
              },
            },
            p ? null : h('small', null, '기본'),
          ),
        );
      }
    }
    this.paintBtn.style.setProperty('--sw', build.paint ?? chassisDef.color);

    // tabs
    clear(this.tabList);
    for (const k of TABS) {
      const n = this.ad.items(k).length;
      this.tabList.appendChild(
        h(
          'button',
          {
            class: `ed-tab ${k === this.tab ? 'on' : ''}`,
            type: 'button',
            role: 'tab',
            'aria-selected': String(k === this.tab),
            onClick: () => this.onTab(k),
          },
          icon(KIND_ICON[k]),
          h('span', { class: 'lbl' }, KIND_NAME[k]),
          h('span', { class: 'cnt' }, String(n)),
        ),
      );
    }

    // filter chip
    clear(this.filterEl);
    const s = this.selSlot;
    let items = this.ad.items(this.tab);
    if (s && s.kind === this.tab) {
      const mount = s.kind === 'weapon' ? chassisDef.weaponSlots[s.index]?.mount : undefined;
      items = items.filter((i) => this.ad.canEquip(s.kind, s.index, i.key));
      this.filterEl.append(
        h(
          'button',
          {
            class: 'filter-chip',
            type: 'button',
            onClick: () => {
              this.ctx.sfx('click');
              this.setSlot(null);
              this.render();
            },
          },
          h('span', null, `${slotName(s.kind, mount)}에 맞는 부품`),
          icon('close'),
        ),
      );
    }
    this.filterEl.hidden = !this.filterEl.firstChild;

    // cards
    clear(this.cardsEl);
    if (!items.length) {
      this.cardsEl.append(
        h('div', { class: 'ed-empty' }, s ? '이 슬롯에 맞는 부품이 없어요' : '아직 부품이 없어요. 상자를 열어 보세요!'),
      );
    }
    for (const it of items) {
      const equipped = this.ad.isEquipped(it.key);
      this.cardsEl.appendChild(
        partCard(this.ctx.app, {
          id: it.id,
          level: it.level,
          equipped,
          selected: it.key === this.selKey,
          fusable: this.ad.mode === 'player' && this.ad.fusable(it.key),
          showLevel: this.ad.mode === 'player',
          onClick: () => this.onCard(it),
        }),
      );
    }

    // hotspot state
    this.hs.selected = s;
    this.hs.compat = new Set();
    const sel = this.selKey ? this.ad.item(this.selKey) : undefined;
    if (sel && !s) {
      const kind = getPart(sel.id).kind;
      if (kind !== 'chassis') {
        const k = kind as SlotKind;
        const len = k === 'wheel' ? build.wheels.length : k === 'weapon' ? build.weapons.length : build.gadgets.length;
        for (let i = 0; i < len; i++) if (this.ad.canEquip(k, i, sel.key) && this.ad.slotKey(k, i) !== sel.key) this.hs.compat.add(`${k}:${i}`);
      }
    }

    this.renderDetail(sel);
  }

  private renderDetail(sel: EditorItem | undefined): void {
    const d = this.detailEl;
    clear(d);
    const build = this.ad.build();
    const chassisDef = getChassis(build.chassis.id);
    if (!sel) {
      const s = this.selSlot;
      if (s) {
        const mount = s.kind === 'weapon' ? chassisDef.weaponSlots[s.index]?.mount : undefined;
        d.append(
          h(
            'div',
            { class: 'dt-hint' },
            h('div', { class: 'dt-hint-ico' }, icon(KIND_ICON[s.kind])),
            h('div', null, h('b', null, `빈 ${slotName(s.kind, mount)}`), h('p', null, '아래 목록에서 부품을 골라 끼우세요.')),
          ),
        );
      } else {
        d.append(
          h(
            'div',
            { class: 'dt-hint' },
            h('div', { class: 'dt-hint-ico' }, icon('wrench')),
            h(
              'div',
              null,
              h('b', null, `${chassisDef.name} 개조 중`),
              h('p', null, '차의 ＋ 슬롯을 누르거나 부품 카드를 골라 보세요.'),
            ),
          ),
        );
      }
      return;
    }

    const def = getPart(sel.id);
    const equipped = this.ad.isEquipped(sel.key);
    const isChassis = def.kind === 'chassis';
    const stats = partStats(def, sel.level);
    const levelBox =
      this.ad.mode === 'player'
        ? h(
            'div',
            { class: 'dt-level' },
            h('span', null, `Lv.${sel.level}`),
            h('i', { class: 'dt-level-bar' }, h('i', { style: `width:${(sel.level / MAX_LEVEL) * 100}%` })),
            h('small', null, `/${MAX_LEVEL}`),
          )
        : null;
    append(d, [
      h(
        'div',
        { class: 'dt-head' },
        h('div', { class: 'dt-art', style: `--rc:${rarityColor(def.rarity)}` }, h('img', { src: this.ctx.app.partIcon(def.id), alt: '', draggable: 'false' })),
        h(
          'div',
          { class: 'dt-title' },
          h('div', { class: 'dt-name' }, def.name),
          h(
            'div',
            { class: 'dt-tags' },
            h('span', { class: 'rar-pill', style: `--rc:${rarityColor(def.rarity)}` }, rarityName(def.rarity)),
            h('span', { class: 'kind-pill' }, KIND_NAME[def.kind]),
            equipped ? h('span', { class: 'eq-pill' }, icon('check'), '장착 중') : null,
          ),
          levelBox,
        ),
      ),
      h(
        'div',
        { class: 'dt-stats' },
        stats.map((st) => h('span', { class: `stat st-${st.icon}`, title: st.label }, icon(st.icon), h('small', null, st.label), h('b', null, st.value))),
      ),
      h('p', { class: 'dt-desc' }, def.desc),
      def.kind === 'weapon'
        ? h(
            'div',
            { class: 'dt-mounts' },
            h('small', null, '장착 위치'),
            (['front', 'top', 'back'] as const).map((m) => h('span', { class: `mount ${def.mounts.includes(m) ? 'ok' : ''}` }, MOUNT_NAME[m])),
          )
        : null,
    ]);

    const actions = h('div', { class: 'dt-actions' });
    // equip / unequip
    const s = this.selSlot;
    if (isChassis) {
      const cur = this.ad.chassisKey() === sel.key;
      actions.append(
        h(
          'button',
          { class: 'btn btn-gold', type: 'button', disabled: cur, onClick: () => this.equipSelected(sel) },
          icon(cur ? 'check' : 'swap'),
          cur ? '사용 중' : '차체 교체',
        ),
      );
    } else if (s && s.kind === def.kind && this.ad.slotKey(s.kind, s.index) !== sel.key && this.ad.canEquip(s.kind, s.index, sel.key)) {
      actions.append(h('button', { class: 'btn btn-gold', type: 'button', onClick: () => this.equipSelected(sel) }, icon('plus'), '이 슬롯에 장착'));
    } else if (equipped) {
      actions.append(h('button', { class: 'btn btn-dark', type: 'button', onClick: () => this.unequipSelected(sel) }, icon('minus'), '해제'));
      if (this.ad.mode === 'p2')
        actions.append(h('button', { class: 'btn btn-gold', type: 'button', onClick: () => this.equipSelected(sel) }, icon('plus'), '하나 더'));
    } else {
      actions.append(h('button', { class: 'btn btn-gold', type: 'button', onClick: () => this.equipSelected(sel) }, icon('plus'), '장착'));
    }

    if (this.ad.mode === 'player') {
      const partners = this.ctx.store.fusePartners(sel.key);
      const maxed = sel.level >= MAX_LEVEL;
      const fuseBtn = h(
        'button',
        {
          class: 'btn btn-teal btn-fuse',
          type: 'button',
          disabled: !partners.length,
          title: maxed ? '최대 레벨' : partners.length ? '같은 부품 두 개를 합쳐 레벨업' : `같은 ${def.name} Lv.${sel.level}이(가) 하나 더 필요해요`,
          onClick: () => void this.fuse(sel),
        },
        icon('up'),
        h(
          'span',
          { class: 'fuse-lbl' },
          '합성',
          h(
            'small',
            null,
            maxed ? '최대' : partners.length ? [img('coin.png', 'btn-coin'), fmt(fuseCost(sel.level))] : `${partners.length + 1}/2`,
          ),
        ),
      );
      actions.append(fuseBtn);
      const lockedChassis = this.ad.chassisKey() === sel.key;
      actions.append(
        h(
          'button',
          {
            class: 'btn btn-red btn-sell',
            type: 'button',
            disabled: lockedChassis,
            title: lockedChassis ? '사용 중인 차체는 팔 수 없어요' : '판매',
            onClick: () => void this.sell(sel),
          },
          '판매',
        ),
      );
    }
    d.append(actions);
  }
}
