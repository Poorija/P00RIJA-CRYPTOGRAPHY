/* The page has no bundler and no React; sileo needs both. This is the one
 * place they meet: React, react-dom and sileo (with the motion it brings) are
 * packed into vendor/sileo/sileo.bundle.min.js, and the page talks to them
 * through window.PoorijaSileo alone. js/app.js never imports anything — it
 * finds the global or falls back to its own plain toast. */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster, sileo } from 'sileo';

function mount(container, props = {}) {
  const root = createRoot(container);
  const render = (next) => root.render(createElement(Toaster, next));
  render(props);
  return {
    /* The theme follows the app's, so the Toaster is drawn again with it. */
    update: render,
    unmount: () => root.unmount(),
  };
}

window.PoorijaSileo = Object.freeze({
  version: '0.1.6',
  mount,
  sileo,
});
