import { defineGame } from '@braincade/game-sdk';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Game } from './Game';

export default defineGame({
  mount(root, ctx) {
    const reactRoot = createRoot(root);
    reactRoot.render(createElement(Game, { ctx }));
    return () => reactRoot.unmount();
  },
});
