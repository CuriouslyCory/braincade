import { defineGame } from '@braincade/game-sdk';
import { WebGLRenderer } from 'three';
import { createWorld } from './world';

export default defineGame({
  async mount(root, ctx) {
    // Fetch data before allocating anything, so a failure here leaves nothing to clean up.
    const [first] = await ctx.words.next({ count: 1 });

    // Register each cleanup step as its resource is created. If setup throws
    // part-way, everything created so far is released before the error propagates.
    const cleanups: Array<() => void> = [];
    const cleanup = () => {
      for (const fn of cleanups.splice(0).reverse()) fn();
    };

    try {
      const renderer = new WebGLRenderer({ antialias: true });
      cleanups.push(() => renderer.dispose());
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      root.style.position = 'relative';
      root.append(renderer.domElement);
      cleanups.push(() => root.replaceChildren());

      // HTML overlays are the easiest way to show words and buttons over the 3D scene.
      const overlay = document.createElement('div');
      overlay.style.cssText =
        'position:absolute;inset:auto 0 24px;display:flex;flex-direction:column;align-items:center;gap:12px;font:800 32px system-ui;color:#fff';
      const label = document.createElement('div');
      label.textContent = first?.word ?? '__GAME_TITLE__';
      const finish = document.createElement('button');
      finish.textContent = 'Finish';
      finish.style.cssText =
        'font:700 18px system-ui;padding:10px 18px;border:0;border-radius:999px';
      finish.onclick = () => void ctx.exit();
      overlay.append(label, finish);
      root.append(overlay);

      const world = createWorld();
      cleanups.push(() => world.dispose());

      const resize = () => {
        const { clientWidth: width, clientHeight: height } = root;
        renderer.setSize(width, height);
        world.camera.aspect = width / Math.max(height, 1);
        world.camera.updateProjectionMatrix();
      };
      const observer = new ResizeObserver(resize);
      observer.observe(root);
      cleanups.push(() => observer.disconnect());
      resize();

      let paused = false;
      cleanups.push(
        ctx.on('pause', () => {
          paused = true;
        }),
        ctx.on('resume', () => {
          paused = false;
        }),
      );

      renderer.setAnimationLoop((time) => {
        if (paused) return;
        world.update(time / 1000);
        renderer.render(world.scene, world.camera);
      });
      cleanups.push(() => renderer.setAnimationLoop(null));
    } catch (error) {
      cleanup();
      throw error;
    }

    // Free GPU memory when the player exits; games are mounted and unmounted often.
    return cleanup;
  },
});
