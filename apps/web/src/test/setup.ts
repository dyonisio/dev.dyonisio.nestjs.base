import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { resetLoginMethods } from '../auth/login-methods';
import { session } from '../auth/session';

// O jsdom não tem IntersectionObserver (o Motion usa nas entradas "ao aparecer na tela")
class NoopIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
globalThis.IntersectionObserver ??=
  NoopIntersectionObserver as unknown as typeof IntersectionObserver;

afterEach(() => {
  cleanup();
  session.clear();
  resetLoginMethods();
  localStorage.clear();
});
