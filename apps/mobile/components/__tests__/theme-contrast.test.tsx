// @ts-nocheck
import { contrastRatio, luminance } from '@/components/mobile/theme';

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

function parseRgba(input) {
  const rgba = input.match(/rgba?\(([^)]+)\)/);
  if (!rgba) {
    const [r, g, b] = hexToRgb(input);
    return [r, g, b, 1];
  }
  const parts = rgba[1].split(',').map((p) => p.trim());
  return [parseInt(parts[0], 10), parseInt(parts[1], 10), parseInt(parts[2], 10), parseFloat(parts[3] ?? '1')];
}

function compositeRgbaOverHex(fg, bgHex) {
  const [fr, fgG, fb, fa] = parseRgba(fg);
  const [br, bgG, bb] = hexToRgb(bgHex);
  const r = Math.round(fr * fa + br * (1 - fa));
  const g = Math.round(fgG * fa + bgG * (1 - fa));
  const b = Math.round(fb * fa + bb * (1 - fa));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function compositeTwoLayers(fgRgba, midRgba, baseHex) {
  const midEffective = compositeRgbaOverHex(midRgba, baseHex);
  return compositeRgbaOverHex(fgRgba, midEffective);
}

describe('theme contrast — WCAG AA >=4.5 for small text', () => {
  it('textSubtle on surfaceLow meets AA (dateFieldLabel)', () => {
    expect(contrastRatio('#666b71', '#F3F6FB')).toBeGreaterThanOrEqual(4.5);
  });

  it('auth placeholder authTextMuted composited over authSurfaceMuted on authSurface meets AA', () => {
    const authSurface = '#161c28';
    const authSurfaceMuted = 'rgba(255,255,255,0.07)';
    const authTextMuted = 'rgba(255,255,255,0.55)';
    const effectiveBackground = compositeRgbaOverHex(authSurfaceMuted, authSurface);
    const effectiveForeground = compositeRgbaOverHex(authTextMuted, effectiveBackground);
    expect(contrastRatio(effectiveForeground, effectiveBackground)).toBeGreaterThanOrEqual(4.5);
  });

  it('luminance helper is correct for white and black', () => {
    expect(luminance('#ffffff')).toBeCloseTo(1, 2);
    expect(luminance('#000000')).toBeCloseTo(0, 2);
  });

  it('composite helper correctly blends 0.55 white over #161c28 via 0.07 mid', () => {
    const mid = compositeRgbaOverHex('rgba(255,255,255,0.07)', '#161c28');
    const fg = compositeTwoLayers('rgba(255,255,255,0.55)', 'rgba(255,255,255,0.07)', '#161c28');
    expect(mid).toMatch(/^#[0-9a-f]{6}$/);
    expect(fg).toMatch(/^#[0-9a-f]{6}$/);
    expect(mid).not.toBe('#161c28');
    expect(fg).not.toBe('#ffffff');
  });
});
