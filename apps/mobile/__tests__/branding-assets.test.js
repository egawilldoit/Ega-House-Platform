const fs = require('node:fs');
const path = require('node:path');

const MOBILE_ROOT = path.resolve(__dirname, '..');
const APP_CONFIG_PATH = path.join(MOBILE_ROOT, 'app.json');

function readPngHeader(relativePath) {
  const absolutePath = path.join(MOBILE_ROOT, relativePath.replace(/^\.\//, ''));
  const buffer = fs.readFileSync(absolutePath);
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  expect(buffer.subarray(0, 8)).toEqual(pngSignature);
  expect(buffer.toString('ascii', 12, 16)).toBe('IHDR');

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer[24],
    colorType: buffer[25],
  };
}

describe('mobile branding assets', () => {
  const appConfig = JSON.parse(fs.readFileSync(APP_CONFIG_PATH, 'utf8')).expo;

  test('uses the production EGA icon and modern splash-screen plugin', () => {
    expect(appConfig.icon).toBe('./assets/images/icon.png');
    expect(appConfig.splash).toBeUndefined();

    const splashPlugin = appConfig.plugins.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen',
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

  test.each([
    ['icon', './assets/images/icon.png', 1024, 1024, 2],
    ['adaptive foreground', './assets/images/adaptive-icon.png', 1024, 1024, 6],
    ['adaptive monochrome', './assets/images/adaptive-monochrome-icon.png', 1024, 1024, 6],
    ['splash icon', './assets/images/splash-icon.png', 1024, 1024, 6],
    ['favicon', './assets/images/favicon.png', 196, 196, 2],
  ])('%s has the expected PNG contract', (_name, relativePath, width, height, colorType) => {
    const png = readPngHeader(relativePath);
    expect(png).toEqual({
      width,
      height,
      bitDepth: 8,
      colorType,
    });
  });
});
