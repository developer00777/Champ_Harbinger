import { describe, it, expect } from 'vitest';
import { StubEmailProvider } from './stub';

describe('StubEmailProvider', () => {
  it('reports disabled', () => {
    const p = new StubEmailProvider();
    expect(p.enabled).toBe(false);
    expect(p.name).toBe('stub');
  });

  it('returns failed status with explanatory error', async () => {
    const p = new StubEmailProvider();
    const res = await p.send({ to: 'a@b.com', from: 'c@d.com', subject: 's', text: 't' });
    expect(res.status).toBe('failed');
    expect(res.error).toContain('disabled');
  });
});
