import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
createRoot(document.getElementById('root')!).render(<App />);

// PWA：独自ドメインで動くとき（GitHub Pages 等）だけ Service Worker を登録。Claude のプレビュー内では登録しない
const inFrame = (() => { try { return window.self !== window.top; } catch { return true; } })();
if ('serviceWorker' in navigator && !inFrame && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
// データがブラウザの自動整理で消されにくくなるよう永続化を要求（対応ブラウザのみ）
try { navigator.storage?.persist?.(); } catch { /* noop */ }
