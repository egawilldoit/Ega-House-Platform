import assert from "node:assert/strict";
import test from "node:test";

import {
  ATTACHMENT_MAX_FILE_BYTES,
  escapeLikePattern,
  formatAttachmentSize,
  isAttachmentSort,
  isAttachmentTypeFilter,
  normalizeAttachmentFileName,
  normalizeAttachmentSearch,
  validateAttachmentCandidate,
  validateAttachmentContent,
  detectAttachmentMime,
} from "../src/index";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n");
const TEXT_BYTES = new TextEncoder().encode("hello, world\n");

function candidate(fileName: string, mimeType: string, sizeBytes: number) {
  return validateAttachmentCandidate({ fileName, mimeType, sizeBytes });
}

test("attachment candidates accept the inert allowlist and canonicalize MIME", () => {
  const png = candidate("Screenshot.PNG", "image/png", 1024);
  assert.equal(png.ok, true);
  if (png.ok) {
    assert.equal(png.candidate.mimeType, "image/png");
    assert.equal(png.candidate.extension, "png");
    assert.equal(png.candidate.kind, "image");
  }

  const pdf = candidate("brief.pdf", "application/octet-stream", 2048);
  assert.equal(pdf.ok, true);
  if (pdf.ok) assert.equal(pdf.candidate.mimeType, "application/pdf");

  const text = candidate("notes.md", "", 12);
  assert.equal(text.ok, true);
  if (text.ok) assert.equal(text.candidate.kind, "document");
});

test("attachment candidates reject active content, unknown types and mismatches", () => {
  for (const [name, mime] of [
    ["payload.svg", "image/svg+xml"],
    ["page.html", "text/html"],
    ["script.js", "text/javascript"],
    ["archive.zip", "application/zip"],
    ["no-extension", "image/png"],
  ] as const) {
    const result = candidate(name, mime, 100);
    assert.equal(result.ok, false, `${name} must be rejected`);
  }

  const mismatch = candidate("photo.png", "application/pdf", 100);
  assert.equal(mismatch.ok, false);
});

test("attachment candidates reject empty, oversized and non-integer sizes", () => {
  assert.equal(candidate("a.png", "image/png", 0).ok, false);
  assert.equal(candidate("a.png", "image/png", ATTACHMENT_MAX_FILE_BYTES + 1).ok, false);
  assert.equal(candidate("a.png", "image/png", 1.5).ok, false);
});

test("file names lose directory components and unsafe characters", () => {
  const result = normalizeAttachmentFileName("../../etc/pass<word>.pdf");
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.fileName, "pass_word_.pdf");
  }

  assert.equal(normalizeAttachmentFileName("...").ok, false);
  assert.equal(normalizeAttachmentFileName("").ok, false);
});

test("content sniffing matches inert signatures and rejects a declared mismatch", () => {
  assert.equal(detectAttachmentMime(PNG_BYTES), "image/png");
  assert.equal(detectAttachmentMime(PDF_BYTES), "application/pdf");
  assert.equal(detectAttachmentMime(TEXT_BYTES), "text/plain");
  assert.equal(detectAttachmentMime(new Uint8Array([0x4d, 0x5a, 0x90])), null);

  assert.equal(validateAttachmentContent(PNG_BYTES, "image/png").ok, true);
  assert.equal(validateAttachmentContent(TEXT_BYTES, "text/markdown").ok, true);
  assert.equal(validateAttachmentContent(TEXT_BYTES, "image/png").ok, false);
  assert.equal(validateAttachmentContent(new Uint8Array([0, 1, 2, 3]), "image/png").ok, false);
});

test("search escaping and filter parsers are bounded", () => {
  assert.equal(escapeLikePattern("100%_done\\"), "100\\%\\_done\\\\");
  assert.equal(normalizeAttachmentSearch("  report  "), "report");
  assert.equal(normalizeAttachmentSearch("   "), null);
  assert.equal(normalizeAttachmentSearch("a".repeat(200))?.length, 80);

  assert.equal(isAttachmentTypeFilter("image"), true);
  assert.equal(isAttachmentTypeFilter("video"), false);
  assert.equal(isAttachmentSort("largest"), true);
  assert.equal(isAttachmentSort("recent"), false);
});

test("attachment sizes are formatted without inventing precision", () => {
  assert.equal(formatAttachmentSize(512), "512 B");
  assert.equal(formatAttachmentSize(2048), "2.0 KB");
  assert.equal(formatAttachmentSize(5 * 1024 * 1024), "5.0 MB");
  assert.equal(formatAttachmentSize(0), "0 B");
});
