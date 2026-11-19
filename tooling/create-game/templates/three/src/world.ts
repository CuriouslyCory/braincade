import {
  AmbientLight,
  Color,
  DirectionalLight,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
} from 'three';

/**
 * The scene graph, kept free of the renderer and the DOM so it can be unit
 * tested in Node. Put game objects and per-frame logic here.
 */
export function createWorld() {
  const scene = new Scene();
  scene.background = new Color('#12122a');

  const camera = new PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 0, 5);

  scene.add(new AmbientLight('#ffffff', 0.6));
  const sun = new DirectionalLight('#ffffff', 1.2);
  sun.position.set(3, 4, 5);
  scene.add(sun);

  const geometry = new IcosahedronGeometry(1.2, 0);
  const material = new MeshStandardMaterial({ color: '#ffcf3f', flatShading: true });
  const gem = new Mesh(geometry, material);
  scene.add(gem);

  return {
    scene,
    camera,
    gem,
    /** Advance the simulation. `elapsed` is seconds since start. */
    update(elapsed: number) {
      gem.rotation.x = elapsed * 0.4;
      gem.rotation.y = elapsed * 0.7;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

export type World = ReturnType<typeof createWorld>;
