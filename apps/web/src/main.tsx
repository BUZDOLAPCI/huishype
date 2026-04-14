import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/src/bootstrap/styles';
import { AppRouter } from './runtime/router';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Missing #root element');
}

createRoot(rootElement).render(
  <StrictMode>
    <AppRouter />
  </StrictMode>,
);
