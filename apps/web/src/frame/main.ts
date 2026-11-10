import { games } from 'virtual:braincade/games';
import { bootFrame } from '@braincade/game-sdk';

// play.html: the page loaded inside the launcher's iframe (web) or WebView (mobile).
const root = document.getElementById('game');
if (root) {
  void bootFrame({
    games,
    gameId: new URLSearchParams(window.location.search).get('game'),
    root,
  });
}
