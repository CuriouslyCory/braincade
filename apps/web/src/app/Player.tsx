import { games } from 'virtual:braincade/games';
import { createHostBridge, type HostBridge, playUrl } from '@braincade/game-host';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { iframeTransport } from '../host/iframe-transport';
import { platform } from '../host/platform';

type PlayerState = 'loading' | 'running' | 'error';

export function Player() {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const game = games.find((g) => g.manifest.id === gameId);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<HostBridge | null>(null);
  const [state, setState] = useState<PlayerState>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    const frame = frameRef.current;
    if (!game || !frame) return;
    setState('loading');
    const bridge = createHostBridge({
      ...platform,
      transport: iframeTransport(frame),
      game: game.manifest,
      onReady: () => setState('running'),
      onError: (e) => {
        setError(e.message);
        setState('error');
      },
      onGameExit: () => navigate('/'),
    });
    bridgeRef.current = bridge;
    // Load the frame only after the bridge is listening so no request is missed.
    frame.src = playUrl('.', game.manifest.id);

    const onVisibility = () => (document.hidden ? bridge.pause() : bridge.resume());
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      bridge.dispose();
      bridgeRef.current = null;
    };
  }, [game, navigate]);

  const exit = useCallback(async () => {
    await bridgeRef.current?.requestExit();
    navigate('/');
  }, [navigate]);

  if (!game) {
    return (
      <main className="empty" data-testid="game-not-found">
        <h1>Game not found</h1>
        <Link to="/">Back to games</Link>
      </main>
    );
  }

  return (
    <div className="player" data-state={state}>
      <button type="button" className="exit" onClick={exit} aria-label="Exit game">
        ✕
      </button>
      {state === 'error' && (
        <div className="player-error" role="alert">
          <p>Something went wrong: {error}</p>
          <Link to="/">Back to games</Link>
        </div>
      )}
      <iframe
        ref={frameRef}
        title={game.manifest.title}
        allow="autoplay; fullscreen; gamepad"
        data-testid="game-frame"
      />
    </div>
  );
}
