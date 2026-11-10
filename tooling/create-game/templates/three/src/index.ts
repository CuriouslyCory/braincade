import { defineGame } from '@braincade/game-sdk';
import { WebGLRenderer } from 'three';
import { createWorld } from './world';

export default defineGame({
  async mount(root, ctx) {
    const [first] = await ctx.words.next({ count: 1 });

    const renderer = new WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    root.style.position = 'relative';
    root.append(renderer.domElement);

    // HTML overlays are the easiest way to show words and buttons over the 3D scene.
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:absolute;inset:auto 0 24px;display:flex;flex-direction:column;align-items:center;gap:12px;font:800 32px system-ui;color:#fff';
    const label = document.createElement('div');
    label.textContent = first?.word ?? '__GAME_TITLE__';
    const finish = document.createElement('button');
    finish.textContent = 'Finish';
    finish.style.cssText = 'font:700 18px system-ui;padding:10px 18px;border:0;border-radius:999px';
    finish.onclick = () => void ctx.exit();
    overlay.append(label, finish);
    root.append(overlay);

    const world = createWorld();
    const resize = () => {
      const { clientWidth: width, clientHeight: height } = root;
      renderer.setSize(width, height);
      world.camera.aspect = width / Math.max(height, 1);
      world.camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(root);
    resize();

    let paused = false;
    const offPause = ctx.on('pause', () => {
      paused = true;
    });
    const offResume = ctx.on('resume', () => {
      paused = false;
    });
    renderer.setAnimationLoop((time) => {
      if (paused) return;
      world.update(time / 1000);
      renderer.render(world.scene, world.camera);
    });

    // Free GPU memory when the player exits; games are mounted and unmounted often.
    return () => {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      offPause();
      offResume();
      world.dispose();
      renderer.dispose();
      root.replaceChildren();
    };
  },
});
