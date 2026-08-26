import fs from 'node:fs';
import path from 'node:path';

const MOBILE_ROOT = path.resolve(__dirname, '..');
const APP_CONFIG_PATH = path.join(MOBILE_ROOT, 'app.json');

function readPngHeader(relativePath: string) {
  const absolutePath = path.join(MOBILE_ROOT, relativePath.replace(/^\.\//, ''));
  const buffer = fs.readFileSync(absolutePath);
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  expect(buffer.subarray(0, 8)).toEqual(pngSignature);
  expect(buffer.toString('ascii', 12, 16)).toBe('IHDR');

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer[24],
  };
}

describe('mobile branding assets', () => {
  const appConfig = JSON.parse(fs.readFileSync(APP_CONFIG_PATH, 'utf8')).expo;

  test('uses the production EGA icon and modern splash-screen plugin', () => {
    expect(appConfig.icon).toBe('./assets/images/icon.png');
    expect(appConfig.splash).toBeUndefined();

    const splashPlugin = appConfig.plugins.find(
      (plugin: unknown) => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen',
    );

    expect(splashPlugin).toEqual([
      'expo-splash-screen',
      {
        backgroundColor: '#F8EDE2',
        image: './assets/images/splash-icon.png',
        imageWidth: 240,
        resizeMode: 'contain',
      },
    ]);
  });

  test('configures Android adaptive and themed icons from dedicated layers', () => {
    expect(appConfig.android.adaptiveIcon).toEqual({
      foregroundImage: './assets/images/adaptive-icon.png',
      monochromeImage: './assets/images/adaptive-monochrome-icon.png',
      backgroundColor: '#F8EDE2',
    });
  });

  const assetCases = [
    { name: 'icon', file: './assets/images/icon.png', width: 1024, height: 1024 },
    { name: 'adaptive foreground', file: './assets/images/adaptive-icon.png', width: 1024, height: 1024 },
    { name: 'adaptive monochrome', file: './assets/images/adaptive-monochrome-icon.png', width: 1024, height: 1024 },
    { name: 'splash icon', file: './assets/images/splash-icon.png', width: 1024, height: 1024 },
    { name: 'favicon', file: './assets/images/favicon.png', width: 196, height: 196 },
  ] as const;

  for (const asset of assetCases) {
    test(`${asset.name} has the expected PNG dimensions`, () => {
      expect(readPngHeader(asset.file)).toEqual({
        width: asset.width,
        height: asset.height,
        bitDepth: 8,
      });
    });
  }
});
