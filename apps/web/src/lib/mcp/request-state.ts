import { createHmac, timingSafeEqual } from "node:crypto";

type CodecOptions = {
  key: string | Uint8Array;
  ttlSeconds?: number;
};

function getKeyBytes(key: string | Uint8Array): Buffer {
  if (typeof key !== "string") return Buffer.from(key);
  // Try base64url/base64, fallback utf8
  try {
    const normalized = key.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "===".slice((normalized.length + 3) % 4);
    const buf = Buffer.from(padded, "base64");
    if (buf.length >= 32) return buf;
  } catch {}
  return Buffer.from(key, "utf8");
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  return Buffer.from(padded, "base64");
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

export function createRequestStateCodec<T extends Record<string, unknown>>(options: CodecOptions) {
  const keyBytes = getKeyBytes(options.key);
  if (keyBytes.length < 32) {
    throw new Error("MCP_REQUEST_STATE_SECRET must be at least 32 bytes.");
  }
  const ttlSeconds = options.ttlSeconds ?? 300;

  function sign(payloadB64: string): string {
    const h = createHmac("sha256", keyBytes);
    h.update(payloadB64);
    return base64UrlEncode(h.digest());
  }

  return {
    async mint(payload: T): Promise<string> {
      const envelope = {
        p: payload,
        exp: Math.floor(Date.now() / 1000) + ttlSeconds,
      };
      const payloadJson = canonicalJson(envelope);
      const payloadB64 = base64UrlEncode(Buffer.from(payloadJson, "utf8"));
      const sig = sign(payloadB64);
      return `${payloadB64}.${sig}`;
    },

    async verify(token: string): Promise<T> {
      if (typeof token !== "string" || token.trim() === "") throw new Error("Missing requestState.");
      const parts = token.split(".");
      if (parts.length !== 2) throw new Error("Invalid requestState format.");
      const [payloadB64, sig] = parts;
      const expectedSig = sign(payloadB64);
      const sigBuf = Buffer.from(sig);
      const expBuf = Buffer.from(expectedSig);
      if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
        throw new Error("Invalid requestState signature.");
      }
      let envelope: { p: T; exp: number };
      try {
        const json = base64UrlDecode(payloadB64).toString("utf8");
        envelope = JSON.parse(json);
      } catch {
        throw new Error("Invalid requestState payload.");
      }
      if (typeof envelope.exp !== "number" || envelope.exp < Math.floor(Date.now() / 1000)) {
        throw new Error("requestState has expired.");
      }
      if (typeof envelope.p !== "object" || envelope.p === null) throw new Error("Invalid requestState payload.");
      return envelope.p;
    },
  };
}

export type RequestStateCodec<T extends Record<string, unknown>> = ReturnType<typeof createRequestStateCodec<T>>;
