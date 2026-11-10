import { games } from 'virtual:braincade/games';
import {
  type MasteryState,
  missedWords,
  poolWords,
  type SessionRecord,
  summarizeMastery,
  wordStatus,
} from '@braincade/learning';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { platform } from '../host/platform';
import { useProfile } from './use-learner';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function Grownups() {
  const { profile, save } = useProfile();
  const [mastery, setMastery] = useState<MasteryState | null>(null);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [saved, setSaved] = useState(false);
  const pool = useMemo(() => poolWords(platform.wordLists), []);

  useEffect(() => {
    void platform.learner.getMastery().then(setMastery);
    void platform.learner.getSessions().then((s) => setSessions(s.slice(-10).reverse()));
  }, []);

  if (!profile || !mastery) return null;

  const summary = summarizeMastery(pool, mastery);
  const missed = missedWords(mastery, Date.now() - WEEK_MS);
  const titles = new Map(games.map((g) => [g.manifest.id, g.manifest.title]));

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await save({
      name: String(data.get('name') ?? '').trim(),
      interests: String(data.get('interests') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      showDrafts: data.get('showDrafts') === 'on',
    });
    setSaved(true);
  }

  function printRematch() {
    void platform.printer?.print({
      title: 'Rematch sheet',
      paper: 'letter',
      orientation: 'portrait',
      pages: [
        {
          blocks: [
            { type: 'heading', text: 'Rematch sheet', level: 1 },
            { type: 'text', text: 'Copy each word three times in your neatest writing.' },
            { type: 'word-practice', words: missed.slice(0, 15), repeats: 3 },
          ],
        },
      ],
    });
  }

  return (
    <section className="grownups">
      <h1>Grown-ups</h1>

      <form className="card" onSubmit={onSubmit} onChange={() => setSaved(false)}>
        <h2>Learner</h2>
        <label>
          Name
          <input name="name" defaultValue={profile.name} maxLength={60} />
        </label>
        <label>
          Interests <span className="hint">(comma separated; games use these for themes)</span>
          <input
            name="interests"
            defaultValue={profile.interests.join(', ')}
            placeholder="minecraft, soccer, dinosaurs"
          />
        </label>
        <label className="checkbox">
          <input type="checkbox" name="showDrafts" defaultChecked={profile.showDrafts} />
          Show draft games on the launcher
        </label>
        <button type="submit">Save</button>
        {saved && <span className="saved">Saved</span>}
      </form>

      <div className="card">
        <h2>Words</h2>
        <p data-testid="mastery-summary">
          {summary.mastered} mastered · {summary.learning} learning · {summary.new} not started ·{' '}
          {summary.total} total
        </p>
        <p className="hint">
          Word lists live in <code>packages/content/word-lists</code>. Edit them and publish to
          update every device.
        </p>
        <button type="button" onClick={printRematch} disabled={missed.length === 0}>
          Print rematch sheet ({missed.length} missed this week)
        </button>
        <table>
          <thead>
            <tr>
              <th>Word</th>
              <th>Status</th>
              <th>Right</th>
              <th>Wrong</th>
              <th>Last answer</th>
            </tr>
          </thead>
          <tbody>
            {pool.map((word) => {
              const stats = mastery.words[word.key];
              return (
                <tr key={word.key}>
                  <td>{word.word}</td>
                  <td className={`status ${wordStatus(stats)}`}>{wordStatus(stats)}</td>
                  <td>{stats?.correct ?? 0}</td>
                  <td>{stats?.incorrect ?? 0}</td>
                  <td>{stats?.lastResponse ?? ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Recent sessions</h2>
        {sessions.length === 0 ? (
          <p className="hint">No games played yet.</p>
        ) : (
          <ul className="sessions">
            {sessions.map((s) => (
              <li key={s.id}>
                {titles.get(s.gameId) ?? s.gameId} · {new Date(s.startedAt).toLocaleString()} ·{' '}
                {s.correct}/{s.attempts} correct · {Math.round((s.endedAt - s.startedAt) / 60000)}{' '}
                min
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
