// Dev-only harness: boots the App core without the DOM UI to inspect 3D scenes.
import { App } from './app/App';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas')!;
const log = document.querySelector<HTMLElement>('#log')!;
const app = new App(canvas);
window.__APP__ = app;
const params = new URLSearchParams(location.search);
app.on('battleEvent', (e) => (log.textContent = JSON.stringify(e)));
app.on('battleEnd', (e) => (log.textContent = 'END ' + JSON.stringify(e)));
await app.init();
const state = params.get('state');
if (state) await window.__THREE_GAME_TEST_HOOKS__!.setState(state);
