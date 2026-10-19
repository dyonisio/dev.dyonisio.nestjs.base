import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { resetLoginMethods } from '../auth/login-methods';
import { session } from '../auth/session';

afterEach(() => {
  cleanup();
  session.clear();
  resetLoginMethods();
  localStorage.clear();
});
