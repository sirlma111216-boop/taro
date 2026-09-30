import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import '@fontsource/gowun-batang/400.css';
import '@fontsource/gowun-batang/700.css';
import './styles/base.css';
import './styles/screens.css';
import './styles/cards.css';
import './styles/print.css';
import { App } from './app.ts';

const root = document.getElementById('app');
if (root) {
  const app = new App(root);
  void app.start();
  if (import.meta.env.DEV) (window as unknown as { __app?: App }).__app = app;
}
