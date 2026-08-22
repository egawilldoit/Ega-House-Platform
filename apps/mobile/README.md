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

## Verification

Run the mobile verification ladder from the repository root:

```bash
npm run verify:mobile            # all levels
npm run verify:mobile -- --levels 1-5
```

Every level is independent evidence; levels whose infrastructure is absent are
reported `NOT PROVEN`, never PASS. The final line names the highest level the
run actually proved. Level definitions and the current known ceiling live in
[`docs/mobile-verification-ladder.md`](../../docs/mobile-verification-ladder.md).
