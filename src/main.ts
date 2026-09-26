import './styles.css';
import { App } from './app/App';
import { Ui } from './ui/Ui';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
const root = document.querySelector<HTMLElement>('#ui');
if (!canvas || !root) throw new Error('Missing #game-canvas or #ui');

const app = new App(canvas);
if (import.meta.env.DEV) window.__APP__ = app;
const loading = document.createElement('div');
loading.className = 'boot-loading';
loading.innerHTML = `<img src="${import.meta.env.BASE_URL}assets/img/logo.png" alt="CRASH CATS" /><div class="boot-bar"><i></i></div>`;
document.body.appendChild(loading);
const bar = loading.querySelector<HTMLElement>('i')!;

app
  .init((p) => (bar.style.width = `${Math.round(p * 100)}%`))
  .then(() => {
    new Ui(root, app);
    loading.classList.add('done');
    window.setTimeout(() => loading.remove(), 500);
  })
  .catch((err) => {
    console.error(err);
    loading.innerHTML = '<p style="color:#fff;font:16px sans-serif">로딩에 실패했어요. 새로고침 해주세요.</p>';
  });
