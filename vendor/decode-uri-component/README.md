# Pinned CommonJS adaptation of decode-uri-component 0.5.1

Source: https://github.com/SamVerschueren/decode-uri-component/releases/tag/v0.5.1

Security fix: https://github.com/advisories/GHSA-qr28-fpjm-wq7f

This directory contains the upstream 0.5.1 decoder implementation with the sole code transformation `export default function decodeUriComponent` → `function decodeUriComponent`, followed by `module.exports = decodeUriComponent`. The upstream MIT license is retained.

**Reason:** `expo-router@6` and `@react-navigation/core@7` depend on `query-string@7`, whose CommonJS implementation requires `decode-uri-component` as a function. Replacing it with the published ESM-only 0.5.1 package or upgrading query-string to 9 breaks the consumer contract.

Root npm `overrides` maps all transitive imports to this local copy. The workspace security test verifies CommonJS integration and the advisory's CPU-exhaustion regression. Do not drop or weaken that test. Replace this vendored copy when these consumers migrate to a safe supported upstream dependency chain.
