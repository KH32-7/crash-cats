import type { AppApi, SlotScreenAnchor } from '../../app/AppApi';
import type { SlotKind } from '../../app/Store';
import { h, icon } from '../dom';
import { MOUNT_NAME, slotName } from '../partInfo';

export interface SlotRef {
  kind: SlotKind;
  index: number;
}

interface Node {
  wrap: HTMLElement;
  ring: HTMLButtonElement;
  tag: HTMLElement;
  state: string;
}

export const slotKey = (s: SlotRef) => `${s.kind}:${s.index}`;

/** DOM rings over every car slot, repositioned every frame from app.garage.getSlotAnchors(). */
export class SlotHotspots {
  readonly el = h('div', { class: 'hotspots' });
  private readonly nodes = new Map<string, Node>();
  private raf = 0;
  selected: SlotRef | null = null;
  /** Slot keys that accept the currently selected card. */
  compat = new Set<string>();

  constructor(
    private readonly app: AppApi,
    private readonly onTap: (slot: SlotRef, anchor: SlotScreenAnchor) => void,
  ) {}

  start(): void {
    cancelAnimationFrame(this.raf);
    const loop = () => {
      this.update();
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    for (const n of this.nodes.values()) n.wrap.remove();
    this.nodes.clear();
  }

  /** Brief pop animation on a slot (after equip). */
  flash(slot: SlotRef): void {
    const n = this.nodes.get(slotKey(slot));
    if (!n) return;
    n.ring.classList.remove('pop');
    void n.ring.offsetWidth;
    n.ring.classList.add('pop');
  }

  private update(): void {
    let anchors: SlotScreenAnchor[] = [];
    try {
      anchors = this.app.garage.getSlotAnchors();
    } catch {
      anchors = [];
    }
    const seen = new Set<string>();
    const selKey = this.selected ? slotKey(this.selected) : '';
    for (const a of anchors) {
      if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) continue;
      const key = `${a.kind}:${a.index}`;
      seen.add(key);
      let n = this.nodes.get(key);
      if (!n) {
        const tag = h('span', { class: 'slot-tag' });
        const ring = h('button', { class: 'slot-ring', type: 'button' });
        const wrap = h('div', { class: `slot-hs k-${a.kind}` }, ring, tag);
        ring.addEventListener('click', (e) => {
          e.stopPropagation();
          const cur = this.lastAnchors.get(key);
          if (cur) this.onTap({ kind: cur.kind, index: cur.index }, cur);
        });
        this.el.appendChild(wrap);
        n = { wrap, ring, tag, state: '' };
        this.nodes.set(key, n);
      }
      this.lastAnchors.set(key, a);
      n.wrap.style.transform = `translate3d(${a.x.toFixed(1)}px, ${a.y.toFixed(1)}px, 0)`;
      const sel = key === selKey;
      const compat = this.compat.has(key);
      const state = `${a.filled ? 'f' : 'e'}|${sel ? 's' : ''}|${compat ? 'c' : ''}|${a.mount ?? ''}`;
      if (state !== n.state) {
        n.state = state;
        n.ring.className = `slot-ring ${a.filled ? 'filled' : 'empty'} ${sel ? 'sel' : ''} ${compat ? 'compat' : ''}`;
        n.ring.innerHTML = '';
        if (!a.filled) n.ring.append(icon('plus'));
        n.ring.setAttribute('aria-label', `${slotName(a.kind, a.mount)} ${a.index + 1}${a.filled ? ' (장착됨)' : ' (비어 있음)'}`);
        n.tag.textContent = a.kind === 'weapon' && a.mount ? MOUNT_NAME[a.mount] : '';
        n.tag.hidden = !(a.kind === 'weapon' && a.mount);
      }
    }
    for (const [key, n] of this.nodes) {
      if (!seen.has(key)) {
        n.wrap.remove();
        this.nodes.delete(key);
        this.lastAnchors.delete(key);
      }
    }
  }

  private readonly lastAnchors = new Map<string, SlotScreenAnchor>();
}
