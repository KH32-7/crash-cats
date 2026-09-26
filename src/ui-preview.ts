/** UI preview harness: real Store + MockApp, no 3D core. Served at /ui-preview.html. */
import './styles.css';
import type { Screen } from './app/AppApi';
import { MockApp } from './ui/mockApp';
import { Ui } from './ui/Ui';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas')!;
const root = document.querySelector<HTMLElement>('#ui')!;
const app = new MockApp();
app.attachCanvas(canvas);
const ui = new Ui(root, app);

const params = new URLSearchParams(location.search);
const screen = params.get('screen') as Screen | null;
if (screen) setTimeout(() => app.showScreen(screen), 50);

Object.assign(window, { mock: app, ui });

if (import.meta.hot) import.meta.hot.dispose(() => ui.dispose());
