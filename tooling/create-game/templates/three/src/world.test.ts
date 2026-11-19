import { describe, expect, it } from 'vitest';
import { createWorld } from './world';

describe('createWorld', () => {
  it('animates the gem over time', () => {
    const world = createWorld();
    world.update(0);
    const start = world.gem.rotation.y;
    world.update(2);
    expect(world.gem.rotation.y).not.toBe(start);
    world.dispose();
  });
});
