import { deriveSecret } from './derive-secret';

describe('deriveSecret', () => {
  it('é determinístico e diferente para cada finalidade e contexto', () => {
    const a = deriveSecret('mestre', 'verify-email');
    expect(deriveSecret('mestre', 'verify-email')).toBe(a);
    expect(deriveSecret('mestre', 'reset-password')).not.toBe(a);
    expect(deriveSecret('mestre', 'verify-email', 'x')).not.toBe(a);
    expect(deriveSecret('outro', 'verify-email')).not.toBe(a);
    expect(a).not.toContain('mestre');
  });
});
