// Entry point. The HTML build had its markup, styles and script inline; here
// they are separate files that port.mjs keeps in sync with new HTML versions.
import './styles.css';
import markup from './markup.html?raw';

// game.ts looks up HUD elements at load time, so the markup must be in the
// page before it runs.
document.body.insertAdjacentHTML('afterbegin', markup);
await import('./game');
