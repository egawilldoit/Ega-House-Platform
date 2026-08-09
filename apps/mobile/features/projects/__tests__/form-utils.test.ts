import { normalizeMobileProjectSlug } from '../form-utils';

describe('normalizeMobileProjectSlug', () => {
  it('derives a canonical slug from a display name', () => {
    expect(normalizeMobileProjectSlug('Launch the Platform')).toBe('launch-the-platform');
  });

  it('collapses runs of non-alphanumeric characters into a single hyphen', () => {
    expect(normalizeMobileProjectSlug('  Ship   v2!!!  ')).toBe('ship-v2');
  });

  it('strips leading and trailing hyphens', () => {
    expect(normalizeMobileProjectSlug('-hello-')).toBe('hello');
  });

  it('returns an empty string for a blank name', () => {
    expect(normalizeMobileProjectSlug('   ')).toBe('');
    expect(normalizeMobileProjectSlug('')).toBe('');
  });

  it('matches the server-side normalization for mixed input', () => {
    expect(normalizeMobileProjectSlug('Q3 Roadmap — Mobile & Web')).toBe(
      'q3-roadmap-mobile-web',
    );
  });
});
