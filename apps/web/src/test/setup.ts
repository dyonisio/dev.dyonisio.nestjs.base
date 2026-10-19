import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { session } from '../auth/session';

afterEach(() => {
  cleanup();
  session.clear();
  localStorage.clear();
});
