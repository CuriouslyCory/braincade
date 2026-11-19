import {
  type AttemptInput,
  type CapturedImage,
  type GameContext,
  type GameWord,
  type HandwritingReading,
  HostError,
} from '@braincade/game-sdk';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import {
  type Comparison,
  compareWords,
  findWordIndex,
  normalizeWord,
  sentenceWords,
  splitToken,
} from './compare';
import {
  buildReadBack,
  type ReadBackWord,
  readBackText,
  targetAttempt,
  type Verdict,
  verdict,
} from './robot';
import './game.css';

export const SENTENCES_PER_SESSION = 3;
export const SILLY_TAG = 'silly-sentence';
const CAPTURE_PROMPT = 'Snap your sentence';
/** The speech protocol accepts up to 1000 characters. */
const MAX_SPEECH = 1000;

type Phase =
  | { name: 'loading' }
  | { name: 'load-error'; message: string }
  | { name: 'empty' }
  | { name: 'intro' }
  | { name: 'prompt'; notice?: string }
  | { name: 'reading'; photo: CapturedImage; error?: string }
  | { name: 'result' }
  | { name: 'done' };

/** The latest reading for one sentence. */
interface SentenceResult {
  photo: CapturedImage;
  readBack: ReadBackWord[];
  comparison: Comparison;
  verdict: Verdict;
}

function cameraErrorMessage(error: unknown): string {
  if (error instanceof HostError && error.code === 'unsupported') {
    return "This device doesn't have a camera the robot can use.";
  }
  // The host explains how to turn the camera back on; retrying won't help until then.
  if (error instanceof HostError && error.code === 'permission-denied') return error.message;
  return "The camera didn't open. Let's try that again!";
}

function readErrorMessage(error: unknown): string {
  if (error instanceof HostError) {
    if (error.code === 'timeout') return 'The robot took too long to read that. Try again?';
    if (error.code === 'unsupported') return "This device can't read handwriting yet.";
  }
  return "The robot couldn't reach its reading brain. Check the internet, then try again.";
}

function Emoji({ children }: { children: string }) {
  return <span aria-hidden="true">{children}</span>;
}

/** The sentence with its target word highlighted. Text content equals the sentence. */
function Sentence({ sentence, word }: { sentence: string; word: string }) {
  const parts = sentence.split(/(\s+)/);
  const wordIndex = findWordIndex(sentenceWords(sentence), word);
  let seen = -1;
  return (
    <p className="sentence" data-testid="prompt-sentence">
      {parts.map((part, i) => {
        // Only non-blank, non-punctuation parts count as sentence words.
        if (/^\s*$/.test(part) || normalizeWord(part) === '') return part;
        seen++;
        if (seen !== wordIndex) return part;
        const [lead, core, trail] = splitToken(part);
        return (
          <Fragment key={i}>
            {lead}
            <mark>{core}</mark>
            {trail}
          </Fragment>
        );
      })}
    </p>
  );
}

const STATUS_LABEL = {
  correct: 'Correct',
  misspelled: 'Misspelled',
  missing: 'Missing',
  unreadable: 'Unreadable',
  extra: 'Extra',
} as const;

function ComparisonList({
  result,
  sentence,
  word,
}: {
  result: SentenceResult;
  sentence: string;
  word: string;
}) {
  const targetIndex = findWordIndex(sentenceWords(sentence), word);
  return (
    <ul className="comparison" data-testid="comparison" aria-label="Word by word">
      {result.comparison.aligned.map((item) => {
        if (item.kind === 'extra') {
          const shown = item.legible
            ? item.read
            : (result.readBack[item.readIndex]?.text ?? item.read);
          return (
            <li key={`x${item.readIndex}`} className="chip chip-extra" data-status="extra">
              <Emoji>➕</Emoji> <span className="chip-word">{splitToken(shown)[1]}</span>
              <span className="chip-note">extra word</span>
            </li>
          );
        }
        const expected = splitToken(item.expected)[1];
        const seen =
          item.readIndex === undefined
            ? ''
            : splitToken(
                item.status === 'unreadable'
                  ? (result.readBack[item.readIndex]?.text ?? '')
                  : (item.read ?? ''),
              )[1];
        const isTarget = item.index === targetIndex;
        return (
          <li
            key={`e${item.index}`}
            className={`chip chip-${item.status}${isTarget ? ' chip-target' : ''}`}
            data-status={item.status}
          >
            <span className="chip-word">{expected}</span>
            {item.status === 'correct' && <span className="chip-note">✓</span>}
            {item.status === 'misspelled' && <span className="chip-note">robot saw “{seen}”</span>}
            {item.status === 'unreadable' && (
              <span className="chip-note">robot guessed “{seen}”</span>
            )}
            {item.status === 'missing' && <span className="chip-note">missing</span>}
            <span className="visually-hidden">{STATUS_LABEL[item.status]}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function Game({ ctx }: { ctx: GameContext }) {
  const [sentences, setSentences] = useState<GameWord[]>([]);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>({ name: 'loading' });
  const [results, setResults] = useState<Array<SentenceResult | undefined>>([]);
  const [busy, setBusy] = useState(false);
  const spoke = useRef(false);
  const alive = useRef(true);
  const paused = useRef(false);
  /** Attempts the host couldn't save yet; sent again with the next one, and before exit. */
  const unsaved = useRef<AttemptInput[]>([]);
  const [unsavedCount, setUnsavedCount] = useState(0);

  const canSpeak = ctx.has('speech');
  const current = sentences[index];
  const sentence = current?.sentence ?? '';
  const result = results[index];
  const isLast = index >= sentences.length - 1;

  const stopSpeech = useCallback(() => {
    if (spoke.current) void ctx.speech.stop().catch(() => {});
  }, [ctx]);

  const speak = useCallback(
    (text: string, rate = 0.9) => {
      // A reading that finishes while the app is in the background stays quiet.
      if (!canSpeak || paused.current || !text.trim()) return;
      spoke.current = true;
      // Don't wait: the robot talks while the learner looks at the result.
      void ctx.speech.speak(text.slice(0, MAX_SPEECH), { rate }).catch(() => {});
    },
    [ctx, canSpeak],
  );

  useEffect(() => {
    alive.current = true;
    ctx.words
      .next({ count: SENTENCES_PER_SESSION, tags: [SILLY_TAG] })
      .then((words) => {
        if (!alive.current) return;
        const usable = words.filter((w) => w.sentence?.trim());
        setSentences(usable);
        setPhase(usable.length ? { name: 'intro' } : { name: 'empty' });
      })
      .catch((e: unknown) => {
        if (!alive.current) return;
        setPhase({ name: 'load-error', message: e instanceof Error ? e.message : String(e) });
      });
    const offPause = ctx.on('pause', () => {
      paused.current = true;
      stopSpeech();
    });
    const offResume = ctx.on('resume', () => {
      paused.current = false;
    });
    return () => {
      alive.current = false;
      offPause();
      offResume();
      stopSpeech();
    };
  }, [ctx, stopSpeech]);

  async function readPhoto(photo: CapturedImage) {
    if (!current) return;
    setPhase({ name: 'reading', photo });
    let reading: HandwritingReading;
    try {
      reading = await ctx.handwriting.read(photo);
    } catch (e) {
      if (alive.current) setPhase({ name: 'reading', photo, error: readErrorMessage(e) });
      return;
    }
    if (!alive.current) return;
    const avoid = sentenceWords(sentence).map(normalizeWord);
    const readBack = buildReadBack(reading.words, index, avoid);
    const comparison = compareWords(sentence, reading.words);
    const next: SentenceResult = {
      photo,
      readBack,
      comparison,
      verdict: verdict(comparison, readBack.length),
    };
    setResults((all) => {
      const copy = [...all];
      copy[index] = next;
      return copy;
    });
    setPhase({ name: 'result' });
    speak(readBack.length ? readBackText(readBack) : next.verdict.message);
  }

  async function snap() {
    if (busy) return;
    setBusy(true);
    stopSpeech();
    let photo: CapturedImage | null;
    try {
      photo = await ctx.camera.capture({ prompt: CAPTURE_PROMPT });
    } catch (e) {
      if (alive.current) setPhase({ name: 'prompt', notice: cameraErrorMessage(e) });
      return;
    } finally {
      if (alive.current) setBusy(false);
    }
    if (!alive.current) return;
    if (!photo) {
      // Cancelled: go back to where the learner was.
      setPhase(result ? { name: 'result' } : { name: 'prompt' });
      return;
    }
    await readPhoto(photo);
  }

  async function next() {
    if (busy || !current || !result) return;
    setBusy(true);
    stopSpeech();
    const attempt = targetAttempt(current.word, sentence, result.comparison);
    if (attempt) unsaved.current = [...unsaved.current, attempt];
    await saveProgress();
    if (!alive.current) return;
    setBusy(false);
    if (isLast) setPhase({ name: 'done' });
    else {
      setIndex((i) => i + 1);
      setPhase({ name: 'prompt' });
    }
  }

  /** Send any unsaved attempts. A failure never traps the learner; they're kept for a retry. */
  async function saveProgress() {
    const batch = unsaved.current;
    if (batch.length === 0) return;
    try {
      await ctx.progress.record(batch);
      unsaved.current = unsaved.current.slice(batch.length);
    } catch {
      // Kept in `unsaved`: tried again with the next sentence and before exit.
    }
    if (alive.current) setUnsavedCount(unsaved.current.length);
  }

  async function finish(finalScore?: number) {
    await saveProgress();
    await ctx.exit(finalScore === undefined ? {} : { score: finalScore });
  }

  const finished = results.filter((r): r is SentenceResult => r !== undefined);
  const score = finished.reduce((sum, r) => sum + r.comparison.counts.correct, 0);
  const totalWords = finished.reduce((sum, r) => sum + r.comparison.counts.total, 0);

  const finishButton = (finalScore?: number) => (
    <button type="button" className="btn btn-go" onClick={() => void finish(finalScore)}>
      Finish
    </button>
  );

  const progress = sentences.length > 0 && (
    <p className="progress" data-testid="sentence-progress">
      Sentence {index + 1} of {sentences.length}
    </p>
  );

  return (
    <main className="robot-reader">
      {phase.name === 'loading' && (
        <section className="screen">
          <div className="robot robot-bob" aria-hidden="true">
            🤖
          </div>
          <p>Warming up the robot…</p>
        </section>
      )}

      {phase.name === 'load-error' && (
        <section className="screen">
          <div className="robot" aria-hidden="true">
            🤖
          </div>
          <p role="alert">Could not load sentences: {phase.message}</p>
          {finishButton()}
        </section>
      )}

      {phase.name === 'empty' && (
        <section className="screen" data-testid="no-sentences">
          <div className="robot" aria-hidden="true">
            🤖
          </div>
          <h1>No silly sentences today</h1>
          <p className="bubble">
            Beep boop! I couldn't find any silly sentences to read. Ask a grown-up to add some, then
            come back!
          </p>
          {finishButton()}
        </section>
      )}

      {phase.name === 'intro' && (
        <section className="screen" data-testid="intro">
          <div className="robot robot-bob" aria-hidden="true">
            🤖
          </div>
          <h1>Robot Reader</h1>
          <p className="bubble">
            Hi! I'm learning to read handwriting. Grab a pencil and paper! Copy my silly sentence,
            then show me your writing.
          </p>
          <button type="button" className="btn btn-go" onClick={() => setPhase({ name: 'prompt' })}>
            Start
          </button>
        </section>
      )}

      {phase.name === 'prompt' && current && (
        <section className="screen">
          {progress}
          <p className="instruction">
            <Emoji>✏️</Emoji> Copy this sentence on paper:
          </p>
          <div className="paper">
            <Sentence sentence={sentence} word={current.word} />
          </div>
          {phase.notice && (
            <p className="notice" role="alert">
              {phase.notice}
            </p>
          )}
          <div className="actions">
            {canSpeak && (
              <button type="button" className="btn" onClick={() => speak(sentence, 0.8)}>
                <Emoji>🔊</Emoji> Hear it
              </button>
            )}
            <button
              type="button"
              className="btn btn-go"
              disabled={busy}
              onClick={() => void snap()}
            >
              <Emoji>📸</Emoji> Snap my writing
            </button>
          </div>
        </section>
      )}

      {phase.name === 'reading' && (
        <section className="screen">
          {progress}
          <div className="photo-wrap">
            <img className="photo" src={phase.photo.image} alt="Your writing" />
            {!phase.error && <div className="scan-line" aria-hidden="true" />}
          </div>
          {phase.error ? (
            <>
              <p className="notice" role="alert" data-testid="read-error">
                {phase.error}
              </p>
              <div className="actions">
                <button
                  type="button"
                  className="btn btn-go"
                  disabled={busy}
                  onClick={() => void readPhoto(phase.photo)}
                >
                  Try again
                </button>
                <button type="button" className="btn" disabled={busy} onClick={() => void snap()}>
                  <Emoji>📸</Emoji> Retake
                </button>
              </div>
            </>
          ) : (
            <div className="thinking" data-testid="robot-thinking" role="status">
              <span className="robot robot-small robot-think" aria-hidden="true">
                🤖
              </span>
              <span>
                Robot is reading
                <span className="dots" aria-hidden="true">
                  <span>.</span>
                  <span>.</span>
                  <span>.</span>
                </span>
              </span>
            </div>
          )}
        </section>
      )}

      {phase.name === 'result' && current && result && (
        <section className="screen">
          {progress}
          <div className="robot-says">
            <span className="robot robot-small" aria-hidden="true">
              🤖
            </span>
            <div className="bubble bubble-left">
              <p className="bubble-label">The robot read:</p>
              <p className="reading" data-testid="robot-reading">
                {result.readBack.length === 0
                  ? '…'
                  : result.readBack.map((w, i) => (
                      <Fragment key={i}>
                        {i > 0 && ' '}
                        {w.gibberish ? <span className="gibberish">{w.text}</span> : w.text}
                      </Fragment>
                    ))}
              </p>
            </div>
          </div>
          <p className={`verdict verdict-${result.verdict.kind}`} data-testid="verdict">
            {result.verdict.message}
          </p>
          <ComparisonList result={result} sentence={sentence} word={current.word} />
          <img className="photo photo-small" src={result.photo.image} alt="Your writing" />
          <div className="actions">
            {canSpeak && (
              <button
                type="button"
                className="btn"
                onClick={() =>
                  speak(
                    result.readBack.length ? readBackText(result.readBack) : result.verdict.message,
                  )
                }
              >
                <Emoji>🔊</Emoji> Hear the robot
              </button>
            )}
            <button type="button" className="btn" disabled={busy} onClick={() => void snap()}>
              <Emoji>📸</Emoji> Retake
            </button>
            <button
              type="button"
              className="btn btn-go"
              disabled={busy}
              onClick={() => void next()}
            >
              {isLast ? 'See my score' : 'Next sentence'}
            </button>
          </div>
        </section>
      )}

      {phase.name === 'done' && (
        <section className="screen">
          <div className="robot robot-bob" aria-hidden="true">
            🤖
          </div>
          <h1>Great writing!</h1>
          <p className="bubble" data-testid="score-summary">
            You copied {finished.length} {finished.length === 1 ? 'sentence' : 'sentences'}. The
            robot read {score} of {totalWords} words correctly!
          </p>
          {unsavedCount > 0 && (
            <p className="notice" role="alert" data-testid="unsaved-progress">
              Some answers couldn't be saved yet. The robot will try again when you finish.
            </p>
          )}
          {finishButton(score)}
        </section>
      )}
    </main>
  );
}
