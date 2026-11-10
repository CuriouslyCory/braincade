import { games } from 'virtual:braincade/games';
import { launcherEntries, platformCapabilities } from '@braincade/game-host';
import { Link } from 'react-router';
import { platform } from '../host/platform';
import { useProfile } from './use-learner';

export function Launcher() {
  const { profile } = useProfile();
  if (!profile) return null;

  const showDrafts = import.meta.env.DEV || profile.showDrafts;
  const entries = launcherEntries(games, {
    showDrafts,
    capabilities: platformCapabilities(platform),
  });

  return (
    <section>
      <h1 className="greeting">{profile.name ? `Hey ${profile.name}!` : 'Pick a game'}</h1>
      {entries.length === 0 ? (
        <div className="empty" data-testid="no-games">
          <p>No games yet.</p>
          <p className="hint">
            Create one with <code>pnpm new:game</code>, then refresh.
          </p>
        </div>
      ) : (
        <ul className="game-grid">
          {entries.map(({ manifest, missing }) => (
            <li key={manifest.id}>
              {missing.length === 0 ? (
                <Link to={`/play/${manifest.id}`} className="game-card" data-game-id={manifest.id}>
                  <GameCardBody manifest={manifest} />
                </Link>
              ) : (
                <div className="game-card disabled" data-game-id={manifest.id} aria-disabled="true">
                  <GameCardBody manifest={manifest} />
                  <span className="needs">Needs {missing.join(', ')}</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function GameCardBody({ manifest }: { manifest: (typeof games)[number]['manifest'] }) {
  return (
    <>
      <span className="icon" aria-hidden="true">
        {manifest.icon}
      </span>
      <span className="title">{manifest.title}</span>
      <span className="description">{manifest.description}</span>
      <span className="tags">
        {manifest.status === 'draft' && <span className="tag draft">draft</span>}
        {manifest.skills.map((skill) => (
          <span key={skill} className="tag">
            {skill}
          </span>
        ))}
      </span>
    </>
  );
}
