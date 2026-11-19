import { defineGame } from '@braincade/game-sdk';

/** Calls every bridge method and writes results into data attributes for Playwright. */
export default defineGame({
  async mount(root, ctx) {
    const report = (key: string, value: unknown) => {
      root.dataset[key] = typeof value === 'string' ? value : JSON.stringify(value);
    };
    const finish = root.ownerDocument.createElement('button');
    finish.textContent = 'Finish';
    finish.style.cssText = 'display:block;margin:30vh auto;font-size:20px';
    finish.onclick = () => void ctx.exit({ score: 7 });
    root.append(finish);

    report('learner', ctx.session.learner.name);
    report('capabilities', ctx.session.capabilities);

    const words = await ctx.words.next({ count: 3 });
    report(
      'words',
      words.map((w) => w.word),
    );

    const first = words[0];
    if (first) {
      await ctx.progress.record({
        word: first.word,
        correct: false,
        mode: 'typed',
        response: `${first.word}x`,
      });
    }

    await ctx.storage.set('visits', ((await ctx.storage.get<number>('visits')) ?? 0) + 1);
    report('visits', await ctx.storage.get('visits'));

    if (ctx.has('print')) {
      await ctx.print({
        title: 'Fixture sheet',
        pages: [{ blocks: [{ type: 'heading', text: 'Hi' }] }],
      });
      report('printed', 'yes');
    }
    if (ctx.has('speech')) {
      void ctx.speech.speak('bridge check').then(() => report('spoke', 'yes'));
    }

    report('checks', 'done');
    return () => {
      window.localStorage.setItem('bridge-check:cleaned-up', 'yes');
    };
  },
});
