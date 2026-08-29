#!/usr/bin/env node

const APP_VERSION_RE = /^\d+\.\d+\.\d+$/;
const STABLE_TAG_RE = /^refs\/tags\/mobile-v(\d+\.\d+\.\d+)$/;
const RC_TAG_RE = /^refs\/tags\/mobile-v(\d+\.\d+\.\d+)-rc\.(\d+)$/;

export function validateMobileDeliveryRef(sourceRef, appVersion) {
  if (typeof sourceRef !== 'string' || !sourceRef) {
    throw new Error('INVALID_SOURCE_REF: source ref is required');
  }
  if (typeof appVersion !== 'string' || !APP_VERSION_RE.test(appVersion)) {
    throw new Error(`INVALID_APP_VERSION: app.json expo.version must be X.Y.Z (got ${appVersion || '<empty>'})`);
  }

  if (sourceRef === 'refs/heads/main') {
    return {
      sourceRef,
      appVersion,
      isTag: false,
      isRc: false,
      tagVersion: null,
      rcNumber: null,
    };
  }

  if (!sourceRef.startsWith('refs/tags/mobile-v')) {
    return {
      sourceRef,
      appVersion,
      isTag: false,
      isRc: false,
      tagVersion: null,
      rcNumber: null,
    };
  }

  const stable = sourceRef.match(STABLE_TAG_RE);
  const rc = sourceRef.match(RC_TAG_RE);
  const match = stable ?? rc;

  if (!match) {
    throw new Error(`INVALID_MOBILE_TAG: ${sourceRef}`);
  }

  const tagVersion = match[1];
  if (tagVersion !== appVersion) {
    throw new Error(
      `TAG_APP_VERSION_MISMATCH: tag version ${tagVersion} != app.json expo.version ${appVersion}`,
    );
  }

  return {
    sourceRef,
    appVersion,
    isTag: true,
    isRc: Boolean(rc),
    tagVersion,
    rcNumber: rc ? rc[2] : null,
  };
}

function parseArgs(argv) {
  let sourceRef = null;
  let appVersion = null;
  let json = false;

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--ref' && argv[i + 1]) sourceRef = argv[++i];
    else if (argv[i] === '--app-version' && argv[i + 1]) appVersion = argv[++i];
    else if (argv[i] === '--json') json = true;
  }

  return { sourceRef, appVersion, json };
}

function main() {
  const { sourceRef, appVersion, json } = parseArgs(process.argv.slice(2));

  try {
    const result = validateMobileDeliveryRef(sourceRef, appVersion);
    if (json) console.log(JSON.stringify(result));
    else console.log(`Mobile delivery ref valid: ${sourceRef}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('validate-mobile-delivery-ref.mjs')) {
  main();
}
