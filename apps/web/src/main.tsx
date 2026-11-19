import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createHashRouter, RouterProvider } from 'react-router';
import { routes } from './app/routes';
import './app/styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');

// Hash routing keeps the app working on any static host without rewrite rules.
createRoot(root).render(
  <StrictMode>
    <RouterProvider router={createHashRouter(routes)} />
  </StrictMode>,
);
