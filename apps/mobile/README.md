# EGA Mobile (Expo)

Bootstrap Expo React Native app for EGA House.

## Run locally

```bash
cd apps/mobile
npm install
npm run start
```

Then press:

- `a` for Android
- `i` for iOS (macOS only)
- `w` for web

## Verification harness

Run all mobile gates and print an evidence-classified summary:

```bash
npm run mobile:verify
```

The harness (`scripts/mobile/verify.mjs`) runs four gates in order, captures
each exit code and duration, and fails with a non-zero exit code when any
executed gate fails:

1. `mobile:doctor` — Expo environment proof
2. `mobile:typecheck` — TypeScript compilation proof
3. `mobile:test` — unit + integration suites
4. `mobile:bundle` — Android export bundle proof

### Evidence labels

Each label is independent evidence; a passing run never claims more than it
proved:

| Label | Meaning |
| --- | --- |
| `UNIT TESTED` | `mobile:test` passed (unit suites) |
| `INTEGRATION TESTED` | `mobile:test` passed, including `lib/api/__tests__/integration.test.ts`, which drives the real API seam from a rendered query hook with only `global.fetch` stubbed |
| `BUNDLE PROVEN` | `mobile:bundle` produced an Android export |
| `EMULATOR PROVEN` | `NOT AVAILABLE — no emulator in environment`; never claimed by CI |
| `PRODUCTION PROVEN` | `NOT EVALUATED`; requires deployed-production evidence |
