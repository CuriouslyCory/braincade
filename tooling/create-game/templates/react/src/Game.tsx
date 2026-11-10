import type { GameContext, GameWord } from '@braincade/game-sdk';
import { useEffect, useState } from 'react';
import './game.css';

/**
 * Starter screen showing the main context APIs: words.next, speech.speak,
 * progress.record, and exit. Replace it with the real game.
 */
export function Game({ ctx }: { ctx: GameContext }) {
  const [words, setWords] = useState<GameWord[] | null>(null);
  const [index, setIndex] = useState(0);
  const [correct, setCorrect] = useState(0);

  useEffect(() => {
    void ctx.words.next({ count: 5 }).then(setWords);
  }, [ctx]);

  const word = words?.[index];

  async function answer(isCorrect: boolean) {
    if (!word) return;
    await ctx.progress.record({ word: word.word, correct: isCorrect });
    if (isCorrect) setCorrect((n) => n + 1);
    setIndex((i) => i + 1);
  }

  return (
    <main className="game">
      <h1>__GAME_TITLE__</h1>
      {!words && <p>Loading words…</p>}
      {words && !word && <p>All done!</p>}
      {word && (
        <>
          <p className="word" data-testid="word">
            {word.word}
          </p>
          <div className="actions">
            {ctx.has('speech') && (
              <button
                type="button"
                onClick={() => void ctx.speech.speak(word.sentence ?? word.word)}
              >
                🔊 Hear it
              </button>
            )}
            <button type="button" onClick={() => void answer(true)}>
              Got it
            </button>
            <button type="button" onClick={() => void answer(false)}>
              Missed it
            </button>
          </div>
        </>
      )}
      <button type="button" className="finish" onClick={() => void ctx.exit({ score: correct })}>
        Finish
      </button>
    </main>
  );
}
