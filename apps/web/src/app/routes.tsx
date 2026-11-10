import { Link, Outlet, type RouteObject } from 'react-router';
import { Grownups } from './Grownups';
import { Launcher } from './Launcher';
import { Player } from './Player';

function Layout() {
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          <span aria-hidden="true">🧠</span> Braincade
        </Link>
        <nav>
          <Link to="/grown-ups">Grown-ups</Link>
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}

function NotFound() {
  return (
    <div className="shell">
      <main className="empty">
        <h1>Page not found</h1>
        <Link to="/">Back to games</Link>
      </main>
    </div>
  );
}

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Launcher /> },
      { path: 'grown-ups', element: <Grownups /> },
    ],
  },
  { path: '/play/:gameId', element: <Player /> },
  { path: '*', element: <NotFound /> },
];
