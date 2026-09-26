import type { OnlineMatchState, OnlineState, Side } from '../../app/AppApi';
import type { PlayerCard } from '../../shared/protocol';
import type { ScreenView, UiCtx } from '../context';
import { backButton, clear, fmt, h, icon, img, ribbon, setText, signed } from '../dom';

/** Round pips (best-of-3). */
export function pips(score: number, of: number, cls = ''): HTMLElement {
  return h(
    'span',
    { class: `pips ${cls}`.trim(), 'aria-label': `${score}승` },
    Array.from({ length: of }, (_, i) => h('i', { class: i < score ? 'on' : '' })),
  );
}

/** 온라인 대전 — connect / queue / room / best-of-3 build phase. */
export class OnlineScreen implements ScreenView {
  readonly el: HTMLElement;
  readonly topBar = true;
  readonly editing = false;
  private readonly panel: HTMLElement;
  private readonly frame: HTMLElement;
  private readonly frameTag: HTMLElement;
  private readonly onlineCount: HTMLElement;
  private key = '';
  private viewOpp = false;
  private code = '';
  private queuedAt = 0;
  private timer = 0;
  private unsub: (() => void) | null = null;
  private dyn: { count?: HTMLElement; ring?: HTMLElement; elapsed?: HTMLElement } = {};

  constructor(private readonly ctx: UiCtx) {
    this.panel = h('div', { class: 'on-panel panel-dark' });
    this.frameTag = h('div', { class: 'frame-tag', hidden: true });
    this.frame = h('div', { class: 'on-frame frame' }, this.frameTag);
    this.onlineCount = h('span', { class: 'online-count' });
    this.el = h(
      'section',
      { class: 'screen online', 'aria-label': '온라인 대전' },
      h('div', { class: 'page-head' }, backButton(() => this.back()), ribbon('온라인 대전', 'head-ribbon'), this.onlineCount),
      h('div', { class: 'on-layout' }, this.panel, this.frame),
    );
  }

  frameEl(): HTMLElement {
    return this.frame;
  }

  private get online() {
    return this.ctx.app.online;
  }

  private back(): void {
    this.ctx.sfx('click');
    const st = this.online.getState();
    if (st.status === 'match' && st.match && st.match.phase !== 'done') {
      void this.ctx
        .confirm({ title: '대전 나가기', body: '지금 나가면 기권패로 처리돼요. 나갈까요?', okText: '나가기', danger: true })
        .then((ok) => {
          if (!ok) return;
          this.online.leave();
          this.ctx.go('home');
        });
      return;
    }
    if (st.status === 'queued' || st.status === 'room') this.online.cancel();
    if (st.status === 'match') this.online.leave();
    this.ctx.go('home');
  }

  enter(): void {
    this.key = '';
    this.unsub = this.ctx.app.on('online', (st) => this.render(st));
    const st = this.online.getState();
    if (st.status === 'offline' && !st.error) this.online.connect();
    this.render(this.online.getState());
    this.timer = window.setInterval(() => this.tick(), 250);
  }

  leave(): void {
    this.unsub?.();
    this.unsub = null;
    clearInterval(this.timer);
    this.setViewOpp(false, null);
  }

  private setViewOpp(on: boolean, m: OnlineMatchState | null): void {
    if (this.viewOpp === on) return;
    this.viewOpp = on;
    this.ctx.app.garage.setBuildOverride(on && m ? m.opponentBuild : null);
  }

  private stateKey(st: OnlineState): string {
    const m = st.match;
    return [
      st.status,
      st.error ?? '',
      st.roomCode ?? '',
      m ? [m.matchId, m.phase, m.round, m.youReady, m.opponentReady, m.score.join(':'), m.matchWinner, m.lastRoundWinner, m.trophyDelta].join('|') : '',
    ].join('#');
  }

  private render(st: OnlineState): void {
    setText(this.onlineCount, st.status === 'offline' || st.status === 'connecting' ? '' : `${fmt(st.online)}명 접속 중`);
    this.onlineCount.hidden = !this.onlineCount.textContent;
    const key = this.stateKey(st);
    if (key === this.key) return;
    const prevStatus = this.key.split('#')[0];
    this.key = key;
    if (st.status === 'queued' && prevStatus !== 'queued') this.queuedAt = Date.now();
    const m = st.status === 'match' ? st.match : undefined;
    if (!m || m.phase !== 'build') this.setViewOpp(false, null);
    else if (this.viewOpp) this.ctx.app.garage.setBuildOverride(m.opponentBuild);

    clear(this.panel);
    this.dyn = {};
    this.panel.className = `on-panel panel-dark st-${st.status}${m ? ` ph-${m.phase}` : ''}`;
    switch (st.status) {
      case 'offline':
        this.renderOffline(st);
        break;
      case 'connecting':
        this.panel.append(h('div', { class: 'on-center' }, h('div', { class: 'spinner' }), h('p', { class: 'on-big' }, '서버에 연결 중…')));
        break;
      case 'idle':
        this.renderIdle();
        break;
      case 'queued':
        this.renderQueued();
        break;
      case 'room':
        this.renderRoom(st.roomCode ?? '----');
        break;
      case 'match':
        if (m) this.renderMatch(m);
        break;
    }
    this.renderFrameTag(m);
    this.tick();
    this.ctx.refreshFrame();
  }

  private renderFrameTag(m: OnlineMatchState | undefined): void {
    clear(this.frameTag);
    if (!m || m.phase !== 'build') {
      this.frameTag.hidden = true;
      return;
    }
    this.frameTag.hidden = false;
    this.frameTag.classList.toggle('opp', this.viewOpp);
    this.frameTag.append(icon('eye'), this.viewOpp ? `상대 차 · ${m.opponent.name}` : '내 차');
  }

  private renderOffline(st: OnlineState): void {
    this.panel.append(
      h(
        'div',
        { class: 'on-center' },
        h('div', { class: 'on-ico bad' }, icon('globe')),
        h('p', { class: 'on-big' }, '서버에 연결되지 않았어요'),
        st.error ? h('p', { class: 'on-sub' }, st.error) : null,
        h(
          'button',
          {
            class: 'btn btn-gold',
            type: 'button',
            onClick: () => {
              this.ctx.sfx('click');
              this.online.connect();
            },
          },
          icon('refresh'),
          '다시 연결',
        ),
      ),
    );
  }

  private renderIdle(): void {
    const input = h('input', {
      class: 'code-input',
      type: 'text',
      inputmode: 'text',
      maxlength: '4',
      placeholder: 'ABCD',
      value: this.code,
      'aria-label': '방 코드',
      autocomplete: 'off',
      autocapitalize: 'characters',
      spellcheck: 'false',
    });
    const join = h('button', { class: 'btn btn-cream', type: 'button', disabled: this.code.length !== 4 }, '참가');
    input.addEventListener('input', () => {
      const v = input.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
      if (input.value !== v) input.value = v;
      this.code = v;
      join.disabled = v.length !== 4;
    });
    const doJoin = () => {
      if (this.code.length !== 4) {
        this.ctx.sfx('error');
        return;
      }
      this.ctx.sfx('click');
      this.online.joinRoom(this.code);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doJoin();
    });
    join.addEventListener('click', doJoin);
    this.panel.append(
      h(
        'div',
        { class: 'on-idle' },
        h('p', { class: 'on-rules' }, icon('flag'), '3판 2선승 · 라운드마다 상대 차를 보고 내 차를 고칠 수 있어요'),
        h(
          'button',
          {
            class: 'btn btn-gold btn-xl',
            type: 'button',
            onClick: () => {
              this.ctx.sfx('whoosh');
              this.online.queue();
            },
          },
          icon('bolt'),
          '빠른 매칭',
        ),
        h(
          'button',
          {
            class: 'btn btn-teal',
            type: 'button',
            onClick: () => {
              this.ctx.sfx('click');
              this.online.createRoom();
            },
          },
          icon('users'),
          '방 만들기',
        ),
        h('div', { class: 'join-row' }, h('label', { class: 'join-lbl' }, '코드로 참가'), input, join),
      ),
    );
  }

  private renderQueued(): void {
    const elapsed = h('b', { class: 'num' }, '0:00');
    this.dyn.elapsed = elapsed;
    this.panel.append(
      h(
        'div',
        { class: 'on-center' },
        h(
          'div',
          { class: 'radar' },
          h('i'),
          h('i'),
          h('i'),
          h('img', { src: this.ctx.app.avatarUrl(this.ctx.store.get().avatar), alt: '' }),
        ),
        h('p', { class: 'on-big' }, '상대를 찾는 중', h('span', { class: 'dots' }, h('i', null, '.'), h('i', null, '.'), h('i', null, '.'))),
        h('p', { class: 'on-sub' }, '대기 시간 ', elapsed),
        h(
          'button',
          {
            class: 'btn btn-dark',
            type: 'button',
            onClick: () => {
              this.ctx.sfx('click');
              this.online.cancel();
            },
          },
          icon('close'),
          '취소',
        ),
      ),
    );
  }

  private renderRoom(code: string): void {
    const copy = h(
      'button',
      {
        class: 'btn btn-cream btn-sm',
        type: 'button',
        onClick: () => {
          this.ctx.sfx('click');
          navigator.clipboard?.writeText(code).then(
            () => this.ctx.toast('코드를 복사했어요', 'good'),
            () => this.ctx.toast('복사할 수 없어요', 'bad'),
          );
        },
      },
      icon('copy'),
      '복사',
    );
    this.panel.append(
      h(
        'div',
        { class: 'on-center' },
        h('p', { class: 'on-sub' }, '친구에게 방 코드를 알려주세요'),
        h('div', { class: 'room-code', 'aria-label': `방 코드 ${code}` }, [...code].map((c) => h('span', null, c))),
        copy,
        h('p', { class: 'on-big' }, '친구를 기다리는 중', h('span', { class: 'dots' }, h('i', null, '.'), h('i', null, '.'), h('i', null, '.'))),
        h(
          'button',
          {
            class: 'btn btn-dark',
            type: 'button',
            onClick: () => {
              this.ctx.sfx('click');
              this.online.cancel();
            },
          },
          icon('close'),
          '취소',
        ),
      ),
    );
  }

  private playerCard(card: PlayerCard, ready: boolean | null, you: boolean): HTMLElement {
    return h(
      'div',
      { class: `pl-card ${you ? 'you' : 'opp'} ${ready ? 'ready' : ''}` },
      h('img', { class: 'pl-av', src: this.ctx.app.avatarUrl(card.avatar), alt: '' }),
      h('b', { class: 'pl-name' }, card.name),
      h('span', { class: 'pl-tr' }, img('trophy.png'), h('span', { class: 'num' }, fmt(card.trophies))),
      ready === null ? null : h('span', { class: `pl-ready ${ready ? 'on' : ''}` }, ready ? [icon('check'), '준비 완료'] : '준비 중…'),
    );
  }

  private scoreRow(m: OnlineMatchState): HTMLElement {
    const me = m.score[m.you];
    const op = m.score[(1 - m.you) as Side];
    return h('div', { class: 'score-row' }, pips(me, m.roundsToWin, 'you'), h('b', { class: 'score-num num' }, `${me} : ${op}`), pips(op, m.roundsToWin, 'opp'));
  }

  private renderMatch(m: OnlineMatchState): void {
    const p = this.ctx.store.get();
    const meCard: PlayerCard = { name: p.name, avatar: p.avatar, trophies: p.trophies };
    if (m.phase === 'build') {
      const count = h('b', { class: 'num' });
      const ring = h('div', { class: 'count-ring' }, count, h('small', null, '초'));
      this.dyn.count = count;
      this.dyn.ring = ring;
      const toggle = h(
        'button',
        {
          class: `toggle ${this.viewOpp ? 'on' : ''}`,
          type: 'button',
          role: 'switch',
          'aria-checked': String(this.viewOpp),
          onClick: () => {
            this.ctx.sfx('click');
            this.setViewOpp(!this.viewOpp, m);
            toggle.classList.toggle('on', this.viewOpp);
            toggle.setAttribute('aria-checked', String(this.viewOpp));
            this.renderFrameTag(m);
          },
        },
        h('i', { class: 'toggle-knob' }),
        h('span', null, '상대 차 보기'),
      );
      this.panel.append(
        h(
          'div',
          { class: 'on-build' },
          h('div', { class: 'ob-top' }, ribbon(`라운드 ${m.round}`, 'round-ribbon'), ring),
          this.scoreRow(m),
          h('div', { class: 'vs-row' }, this.playerCard(meCard, m.youReady, true), h('span', { class: 'vs' }, 'VS'), this.playerCard(m.opponent, m.opponentReady, false)),
          toggle,
          h('p', { class: 'on-note' }, this.viewOpp ? '지금 상대의 차가 보이고 있어요.' : '상대 차를 보고 차고에서 대응해 보세요!'),
          h(
            'div',
            { class: 'ob-actions' },
            h(
              'button',
              {
                class: 'btn btn-cream',
                type: 'button',
                disabled: m.youReady,
                onClick: () => {
                  this.ctx.sfx('click');
                  this.ctx.state.garageReturn = 'online';
                  this.ctx.go('garage');
                },
              },
              icon('wrench'),
              '차고에서 수정',
            ),
            h(
              'button',
              {
                class: 'btn btn-gold btn-ready',
                type: 'button',
                disabled: m.youReady,
                onClick: () => {
                  this.ctx.sfx('equip');
                  this.online.ready();
                },
              },
              icon('check'),
              m.youReady ? '준비됨' : '준비 완료',
            ),
          ),
        ),
      );
      return;
    }
    if (m.phase === 'battle') {
      this.panel.append(
        h(
          'div',
          { class: 'on-center' },
          ribbon(`라운드 ${m.round}`, 'round-ribbon'),
          this.scoreRow(m),
          h('p', { class: 'on-big' }, '배틀 진행 중…'),
          h(
            'button',
            {
              class: 'btn btn-gold',
              type: 'button',
              onClick: () => {
                this.ctx.sfx('click');
                this.ctx.go('battle');
              },
            },
            icon('eye'),
            '관전하기',
          ),
        ),
      );
      return;
    }
    if (m.phase === 'roundResult') {
      const w = m.lastRoundWinner;
      const title = w === undefined || w === -1 ? '무승부' : w === m.you ? '라운드 승리!' : '라운드 패배';
      this.panel.append(
        h(
          'div',
          { class: 'on-center' },
          ribbon(title, `round-ribbon ${w === m.you ? 'good' : w === -1 ? '' : 'bad'}`),
          this.scoreRow(m),
          h('p', { class: 'on-sub' }, '다음 라운드를 준비하는 중…'),
          h('div', { class: 'spinner sm' }),
        ),
      );
      return;
    }
    // done
    const w = m.matchWinner;
    const win = w === m.you;
    const draw = w === -1 || w === undefined;
    const delta = m.trophyDelta ?? 0;
    this.panel.append(
      h(
        'div',
        { class: 'on-center on-done' },
        ribbon(draw ? '무승부' : win ? '승리!' : '패배', `round-ribbon big ${win ? 'good' : draw ? '' : 'bad'}`),
        h('div', { class: 'vs-row' }, this.playerCard(meCard, null, true), h('span', { class: 'vs' }, 'VS'), this.playerCard(m.opponent, null, false)),
        this.scoreRow(m),
        m.forfeit ? h('p', { class: 'on-sub' }, win ? '상대가 대전을 떠났어요' : '기권으로 끝났어요') : null,
        h('div', { class: `delta-chip ${delta >= 0 ? 'up' : 'down'}` }, img('trophy.png'), h('b', { class: 'num' }, signed(delta))),
        h(
          'div',
          { class: 'ob-actions' },
          h(
            'button',
            {
              class: 'btn btn-dark',
              type: 'button',
              onClick: () => {
                this.ctx.sfx('click');
                this.online.leave();
                this.ctx.go('home');
              },
            },
            '나가기',
          ),
          h(
            'button',
            {
              class: 'btn btn-gold',
              type: 'button',
              onClick: () => {
                this.ctx.sfx('whoosh');
                this.online.leave();
                this.online.queue();
              },
            },
            icon('refresh'),
            '다시 매칭',
          ),
        ),
      ),
    );
  }

  private tick(): void {
    const st = this.online.getState();
    const m = st.match;
    if (this.dyn.count && m && m.phase === 'build') {
      const left = Math.max(0, Math.ceil((m.buildDeadline - Date.now()) / 1000));
      setText(this.dyn.count, String(left));
      this.dyn.ring?.classList.toggle('urgent', left <= 5);
    }
    if (this.dyn.elapsed) {
      const s = Math.floor((Date.now() - this.queuedAt) / 1000);
      setText(this.dyn.elapsed, `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
    }
  }
}
