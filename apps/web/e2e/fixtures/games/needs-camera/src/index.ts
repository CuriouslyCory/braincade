import { defineGame } from '@braincade/game-sdk';

export default defineGame({
  mount(root) {
    root.textContent = 'This should never mount on a host without a camera.';
    return undefined;
  },
});
