/**
 * Attachment rules (EGA-802).
 *
 * Files live in one private Supabase Storage bucket. The database owns the
 * authoritative quota and parent-ownership check (see migration 0068); this
 * module owns the user-facing validation used before an upload ticket is
 * issued and when the uploaded object is verified.
 *
 * This is content validation, not malware scanning: an antivirus scanner is
 * not configured anywhere in this repository, so no code here may claim that
 * an attachment was scanned or is safe.
 */

export const ATTACHMENT_BUCKET = "task-attachments";

/** 10 MiB per file, 20 files per task, 200 MiB per owner. */
export const ATTACHMENT_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_MAX_FILES_PER_TASK = 20;
export const ATTACHMENT_MAX_OWNER_BYTES = 200 * 1024 * 1024;

/** An unfinished upload ticket expires after this long (matches the signed upload URL lifetime). */
export const ATTACHMENT_PENDING_TTL_MINUTES = 120;

/**
 * Preview/download links are short-lived. A link already handed to a browser
 * stays valid until it expires; changing ownership or deleting the row does not
 * revoke it instantly.
 */
export const ATTACHMENT_PREVIEW_URL_TTL_SECONDS = 60;

/** Bounded cleanup pass: never scan more than this many abandoned rows. */
export const ATTACHMENT_RECONCILE_BATCH_SIZE = 5;

export const ATTACHMENT_FILE_NAME_MAX_LENGTH = 180;
export const ATTACHMENT_SEARCH_MAX_LENGTH = 80;
export const ATTACHMENT_PROJECT_PAGE_SIZE = 120;

export type AttachmentKind = "image" | "pdf" | "document";

export type AllowedAttachmentType = {
  mimeType: string;
  kind: AttachmentKind;
  extensions: readonly string[];
};

/**
 * The allowlist is deliberately small and excludes active content (SVG, HTML,
 * JavaScript). Extension and client MIME are hints only; finalization verifies
 * the stored bytes.
 */
export const ATTACHMENT_ALLOWED_TYPES: readonly AllowedAttachmentType[] = [
  { mimeType: "image/png", kind: "image", extensions: ["png"] },
  { mimeType: "image/jpeg", kind: "image", extensions: ["jpg", "jpeg"] },
  { mimeType: "image/gif", kind: "image", extensions: ["gif"] },
  { mimeType: "image/webp", kind: "image", extensions: ["webp"] },
  { mimeType: "application/pdf", kind: "pdf", extensions: ["pdf"] },
  { mimeType: "text/plain", kind: "document", extensions: ["txt", "log"] },
  { mimeType: "text/markdown", kind: "document", extensions: ["md"] },
  { mimeType: "text/csv", kind: "document", extensions: ["csv"] },
];

/** `accept` hint for the file picker; the server still validates every file. */
export const ATTACHMENT_ACCEPT_ATTRIBUTE = ATTACHMENT_ALLOWED_TYPES.flatMap((entry) =>
  entry.extensions.map((extension) => `.${extension}`),
).join(",");

/** Human list of accepted extensions for the upload hint. */
export const ATTACHMENT_ALLOWED_LABEL = "PNG, JPG, GIF, WebP, PDF, TXT, MD, CSV";

export const ATTACHMENT_TYPE_FILTER_VALUES = ["all", "image", "pdf", "document"] as const;export type AttachmentTypeFilter = (typeof ATTACHMENT_TYPE_FILTER_VALUES)[number];

export const ATTACHMENT_SORT_VALUES = ["newest", "oldest", "name", "largest"] as const;
export type AttachmentSort = (typeof ATTACHMENT_SORT_VALUES)[number];

export const DEFAULT_ATTACHMENT_TYPE_FILTER: AttachmentTypeFilter = "all";
export const DEFAULT_ATTACHMENT_SORT: AttachmentSort = "newest";

export function isAttachmentTypeFilter(value: unknown): value is AttachmentTypeFilter {
  return (
    typeof value === "string" &&
    (ATTACHMENT_TYPE_FILTER_VALUES as readonly string[]).includes(value)
  );
}

export function isAttachmentSort(value: unknown): value is AttachmentSort {
  return (
    typeof value === "string" && (ATTACHMENT_SORT_VALUES as readonly string[]).includes(value)
  );
}

export function getAttachmentKind(mimeType: string): AttachmentKind {
  const type = ATTACHMENT_ALLOWED_TYPES.find((entry) => entry.mimeType === mimeType);
  return type?.kind ?? "document";
}

export function isPreviewableKind(kind: AttachmentKind): boolean {
  return kind === "image" || kind === "pdf";
}

export type AttachmentFileNameResult =
  | { ok: true; fileName: string }
  | { ok: false; errorMessage: string };

/**
 * Strips any directory component and characters that would make a download name
 * misleading. The storage path never uses this value; it is display metadata.
 */
export function normalizeAttachmentFileName(value: unknown): AttachmentFileNameResult {
  const raw = String(value ?? "");
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>:"|?*]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");

  if (!cleaned) return { ok: false, errorMessage: "Choose a file with a name." };
  if (cleaned.length > ATTACHMENT_FILE_NAME_MAX_LENGTH) {
    return {
      ok: false,
      errorMessage: `File names must be ${ATTACHMENT_FILE_NAME_MAX_LENGTH} characters or fewer.`,
    };
  }
  return { ok: true, fileName: cleaned };
}

export type AttachmentCandidate = {
  fileName: string;
  mimeType: string;
  extension: string;
  kind: AttachmentKind;
  sizeBytes: number;
};

export type AttachmentCandidateResult =
  | { ok: true; candidate: AttachmentCandidate }
  | { ok: false; errorMessage: string };

function normalizeMime(value: unknown): string {
  return String(value ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
}

/**
 * Validates the client-provided name, MIME hint and size before an upload
 * ticket exists. The client MIME cannot widen the allowlist: it must either be
 * the canonical type for the extension or an explicit octet-stream hint.
 */
export function validateAttachmentCandidate(input: {
  fileName: unknown;
  mimeType: unknown;
  sizeBytes: unknown;
}): AttachmentCandidateResult {
  const nameResult = normalizeAttachmentFileName(input.fileName);
  if (!nameResult.ok) return nameResult;

  const { fileName } = nameResult;
  const dot = fileName.lastIndexOf(".");
  const extension = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : "";
  if (!extension || !/^[a-z0-9]{1,10}$/.test(extension)) {
    return { ok: false, errorMessage: "That file type is not supported." };
  }

  const allowed = ATTACHMENT_ALLOWED_TYPES.find((entry) =>
    entry.extensions.includes(extension),
  );
  if (!allowed) {
    return { ok: false, errorMessage: "That file type is not supported." };
  }

  const declaredMime = normalizeMime(input.mimeType);
  if (
    declaredMime &&
    declaredMime !== allowed.mimeType &&
    declaredMime !== "application/octet-stream"
  ) {
    return {
      ok: false,
      errorMessage: "The file type does not match its name.",
    };
  }

  const sizeBytes = Number(input.sizeBytes);
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    return { ok: false, errorMessage: "The file is empty." };
  }
  if (sizeBytes > ATTACHMENT_MAX_FILE_BYTES) {
    return {
      ok: false,
      errorMessage: `Files must be ${ATTACHMENT_MAX_FILE_BYTES / (1024 * 1024)} MB or smaller.`,
    };
  }

  return {
    ok: true,
    candidate: {
      fileName,
      mimeType: allowed.mimeType,
      extension,
      kind: allowed.kind,
      sizeBytes,
    },
  };
}

function startsWithBytes(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((value, index) => bytes[index] === value);
}

function isPlainText(bytes: Uint8Array): boolean {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    // Control characters (other than whitespace) make a file binary or
    // actively hostile to a text preview.
    return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text);
  } catch {
    return false;
  }
}

/**
 * Sniffs the stored bytes. `null` means no supported, inert signature matched.
 * A text result covers every allowed `text/*` subtype, because the bytes cannot
 * distinguish Markdown from CSV.
 */
export function detectAttachmentMime(bytes: Uint8Array): string | null {
  if (startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWithBytes(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (
    startsWithBytes(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes.length >= 12 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (startsWithBytes(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  if (bytes.length > 0 && isPlainText(bytes)) return "text/plain";
  return null;
}

export type AttachmentContentResult = { ok: true } | { ok: false; errorMessage: string };

/** Final gate: the stored object must match the type recorded for it. */
export function validateAttachmentContent(
  bytes: Uint8Array,
  declaredMimeType: string,
): AttachmentContentResult {
  const detected = detectAttachmentMime(bytes);
  if (!detected) {
    return {
      ok: false,
      errorMessage: "The uploaded file is not a supported image, PDF or text file.",
    };
  }
  const declared = normalizeMime(declaredMimeType);
  const matches =
    detected === declared || (detected === "text/plain" && declared.startsWith("text/"));
  if (!matches) {
    return {
      ok: false,
      errorMessage: "The uploaded file does not match the type its name declares.",
    };
  }
  return { ok: true };
}

/** Normalizes the Files-tab search box; returns null when there is no query. */
export function normalizeAttachmentSearch(value: unknown): string | null {
  const query = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, ATTACHMENT_SEARCH_MAX_LENGTH);
  return query.length > 0 ? query : null;
}

/**
 * Escapes `%`, `_` and `\` for a PostgREST `ilike` pattern. User input is never
 * concatenated into SQL text, but an unescaped wildcard would silently widen
 * the search.
 */
export function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export function formatAttachmentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
