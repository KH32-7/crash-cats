import { AVATARS, type AvatarId } from '../../app/Store';
import type { ConfirmOpts, Tone, UiCtx } from '../context';
import { h, icon, ribbon } from '../dom';

/** Toast stack (top-center). */
export class Toasts {
  readonly el = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });

  show(text: string, tone: Tone = 'neutral'): void {
    const t = h('div', { class: `toast ${tone}` }, h('span', null, text));
    this.el.appendChild(t);
    while (this.el.children.length > 3) this.el.firstElementChild?.remove();
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3000);
  }
}

/** Modal layer: confirm dialogs + profile editor. */
export class Modals {
  readonly el = h('div', { class: 'modal-layer' });
  private closeTop: (() => void) | null = null;
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this.closeTop) this.closeTop();
  };

  constructor(private readonly ctx: Pick<UiCtx, 'sfx' | 'app' | 'store'>) {
    window.addEventListener('keydown', this.onKey);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
  }

  private open(title: string, body: HTMLElement, actions: HTMLElement[], onDismiss: () => void, cls = ''): () => void {
    const panel = h(
      'div',
      { class: `modal paper ${cls}`.trim(), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      ribbon(title, 'modal-title'),
      h('div', { class: 'modal-body' }, body),
      h('div', { class: 'modal-actions' }, actions),
    );
    const back = h('div', { class: 'modal-back' }, panel);
    back.addEventListener('pointerdown', (e) => {
      if (e.target === back) dismiss();
    });
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      back.classList.add('out');
      setTimeout(() => back.remove(), 180);
      if (this.closeTop === dismiss) this.closeTop = null;
    };
    const dismiss = () => {
      onDismiss();
      close();
    };
    this.closeTop = dismiss;
    this.el.appendChild(back);
    requestAnimationFrame(() => (panel.querySelector('.btn-gold, .btn-red, input') as HTMLElement | null)?.focus());
    return close;
  }

  confirm(o: ConfirmOpts): Promise<boolean> {
    return new Promise((resolve) => {
      const body = typeof o.body === 'string' ? h('p', { class: 'modal-text' }, o.body) : o.body;
      const cancel = h('button', { class: 'btn btn-dark', type: 'button' }, o.cancelText ?? '취소');
      const ok = h('button', { class: `btn ${o.danger ? 'btn-red' : 'btn-gold'}`, type: 'button' }, o.okIcon ?? null, o.okText ?? '확인');
      const close = this.open(o.title, body, [cancel, ok], () => resolve(false));
      cancel.addEventListener('click', () => {
        this.ctx.sfx('click');
        resolve(false);
        close();
      });
      ok.addEventListener('click', () => {
        resolve(true);
        close();
      });
    });
  }

  profile(): void {
    const p = this.ctx.store.get();
    let chosen: AvatarId = p.avatar;
    const input = h('input', {
      class: 'name-input',
      type: 'text',
      maxlength: '12',
      value: p.name,
      'aria-label': '이름',
      autocomplete: 'off',
      spellcheck: 'false',
    });
    const counter = h('span', { class: 'name-count' }, `${p.name.length}/12`);
    input.addEventListener('input', () => (counter.textContent = `${input.value.length}/12`));
    const grid = h('div', { class: 'avatar-grid', role: 'radiogroup', 'aria-label': '아바타' });
    const renderGrid = () => {
      grid.innerHTML = '';
      for (const a of AVATARS) {
        const b = h(
          'button',
          {
            class: `avatar-opt ${a === chosen ? 'sel' : ''}`,
            type: 'button',
            role: 'radio',
            'aria-checked': String(a === chosen),
            onClick: () => {
              chosen = a;
              this.ctx.sfx('click');
              renderGrid();
            },
          },
          h('img', { src: this.ctx.app.avatarUrl(a), alt: '', draggable: 'false' }),
          a === chosen ? h('span', { class: 'avatar-check' }, icon('check')) : null,
        );
        grid.appendChild(b);
      }
    };
    renderGrid();
    const body = h(
      'div',
      { class: 'profile-edit' },
      h('label', { class: 'field-label' }, '이름'),
      h('div', { class: 'name-row' }, input, counter),
      h('label', { class: 'field-label' }, '아바타'),
      grid,
    );
    const cancel = h('button', { class: 'btn btn-dark', type: 'button' }, '취소');
    const save = h('button', { class: 'btn btn-gold', type: 'button' }, icon('check'), '저장');
    const close = this.open('프로필', body, [cancel, save], () => undefined, 'modal-profile');
    const doSave = () => {
      const name = input.value.trim();
      if (!name) {
        this.ctx.sfx('error');
        input.classList.add('shake');
        setTimeout(() => input.classList.remove('shake'), 400);
        return;
      }
      this.ctx.store.setName(name);
      this.ctx.store.setAvatar(chosen);
      this.ctx.sfx('equip');
      close();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doSave();
    });
    cancel.addEventListener('click', () => {
      this.ctx.sfx('click');
      close();
    });
    save.addEventListener('click', doSave);
  }
}
