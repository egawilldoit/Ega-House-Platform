import type { AuthInfo } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";

import {
  applyMcpCorsHeaders,
  createWebMcpHandler,
} from "@/lib/mcp/web-transport-handler";

const AUTH_INFO: AuthInfo = {
  token: "signed-token",
  clientId: "hermes-client",
  scopes: ["ega.mcp.authorized"],
};

const RESOURCE_URL = "https://ega.example.com/api/mcp";
const RESOURCE_ORIGIN = "https://ega.example.com";
const RESOURCE_HOST = "ega.example.com";

const MCP_HEADERS = {
  "content-type": "application/json",
  host: RESOURCE_HOST,
  "mcp-protocol-version": "2026-07-28",
};

function createHandler(resourceUrl = RESOURCE_URL) {
  // One option. `basePath`/`maxDuration`/`verboseLogs` were removed because
  // nothing read them; passing them here would not compile.
  return createWebMcpHandler(() => {}, { resourceUrl });
}

function createRequest(body: unknown, headers: HeadersInit = MCP_HEADERS) {
  const request = new Request(RESOURCE_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  Object.defineProperty(request, "auth", { value: AUTH_INFO });
  return request;
}

function preflight(init: { host?: string; origin?: string } = {}): Request {
  const headers = new Headers();
  headers.set("host", init.host ?? RESOURCE_HOST);
  if (init.origin !== undefined) headers.set("origin", init.origin);
  return new Request(RESOURCE_URL, { method: "OPTIONS", headers });
}

describe("createWebMcpHandler", () => {
  it("rejects GET because this deployment is modern stateless JSON-only", async () => {
    const response = await createHandler()(
      new Request(RESOURCE_URL, {
        method: "GET",
        headers: { host: RESOURCE_HOST },
      }),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST, OPTIONS");
  });

  it("makes the 405 uncacheable and origin-dependent, because 405 is heuristically cacheable", async () => {
    // RFC 9110 15.1 lists 405 as heuristically cacheable. A bare 405 with no
    // Cache-Control and no Vary could therefore be stored by a shared cache and
    // replayed - including after the route's method set changed.
    const response = await createHandler()(
      new Request(RESOURCE_URL, {
        method: "GET",
        headers: { host: RESOURCE_HOST, origin: RESOURCE_ORIGIN },
      }),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("vary")).toContain("Origin");
    expect(response.headers.get("access-control-allow-origin")).toBe(RESOURCE_ORIGIN);
  });

  it.each(["2025-06-18", "2025-11-25"])(
    "rejects the unsupported MCP protocol version %s",
    async (version) => {
      const headers = new Headers(MCP_HEADERS);
      headers.set("mcp-protocol-version", version);

      const response = await createHandler()(createRequest(
        { jsonrpc: "2.0", id: 1, method: "ping" },
        headers,
      ));

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: "invalid_request" });
    },
  );

  it("rejects a POST without MCP-Protocol-Version", async () => {
    const headers = new Headers(MCP_HEADERS);
    headers.delete("mcp-protocol-version");

    const response = await createHandler()(createRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      headers,
    ));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_request" });
  });

  it("accepts a modern protocol request", async () => {
    const response = await createHandler()(createRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "ping",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }, new Headers({ ...MCP_HEADERS, "mcp-method": "ping" })));

    expect(response.status).not.toBe(400);
  });

  it("rejects an unsupported subscription request without holding the function open", async () => {
    const response = await createHandler()(createRequest({
      jsonrpc: "2.0",
      id: 7,
      method: "subscriptions/listen",
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      jsonrpc: "2.0",
      id: 7,
      error: {
        code: -32601,
        message: "Method not found: subscriptions/listen",
      },
    });
  });

  it("applies the origin contract to the subscription refusal too", async () => {
    // This response short-circuits before the SDK, so it used to be produced
    // with no allow-origin header at all: a cross-origin browser client that
    // preflighted successfully received an opaque CORS failure instead of the
    // -32601 the server had actually produced.
    const headers = new Headers(MCP_HEADERS);
    headers.set("origin", RESOURCE_ORIGIN);
    const response = await createHandler()(createRequest({
      jsonrpc: "2.0",
      id: 7,
      method: "subscriptions/listen",
    }, headers));

    expect(response.headers.get("access-control-allow-origin")).toBe(RESOURCE_ORIGIN);
    expect(response.headers.get("vary")).toContain("Origin");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("rejects an oversized streamed body without Content-Length", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(4 * 1024 * 1024));
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    });

    const request = new Request(RESOURCE_URL, {
      method: "POST",
      headers: MCP_HEADERS,
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    Object.defineProperty(request, "auth", { value: AUTH_INFO });

    const response = await createHandler()(request);

    expect(response.status).toBe(413);
  });

  it("accepts a body of exactly the 4 MiB bound", async () => {
    // The bound is `> MAX`, not `>=`. Proving the boundary is admitted means a
    // future change to `>` / `>=` cannot silently halve or double the limit
    // without this test moving.
    const size = 4 * 1024 * 1024;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(size));
        controller.close();
      },
    });
    const request = new Request(RESOURCE_URL, {
      method: "POST",
      headers: MCP_HEADERS,
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    Object.defineProperty(request, "auth", { value: AUTH_INFO });

    const response = await createHandler()(request);

    expect(response.status).not.toBe(413);
  });

  it("rejects a declared Content-Length over the bound without reading the body", async () => {
    const headers = new Headers(MCP_HEADERS);
    headers.set("content-length", String(4 * 1024 * 1024 + 1));
    const response = await createHandler()(createRequest(
      { jsonrpc: "2.0", id: 1, method: "ping" },
      headers,
    ));

    expect(response.status).toBe(413);
  });

  it("refuses an over-limit body with this route's own error shape, not the SDK's", async () => {
    // The SDK enforces a POST body bound too (2.3.0 `maxRequestBodySize`, default
    // 4 MiB). Left at its default, the two bounds were independent constants that
    // happened to be equal, and the proof that ours is the one that fired is the
    // BODY: ours is `{error: "invalid_request"}`, the SDK's is a JSON-RPC error
    // with code -32e3. A test asserting only the 413 status would pass either way,
    // which is exactly the failure this pins shut.
    const headers = new Headers(MCP_HEADERS);
    headers.set("content-length", String(4 * 1024 * 1024 + 1));

    const response = await createHandler()(createRequest(
      { jsonrpc: "2.0", id: 1, method: "ping" },
      headers,
    ));

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      error: "invalid_request",
      error_description: "Request body too large.",
    });
    // And the SDK agrees with our bound rather than holding a private one, so
    // raising `MAX_REQUEST_BODY_BYTES` cannot leave a stale 4 MiB behind. The SDK
    // throwing a RangeError at construction for a bad value is the mechanism; this
    // asserts the handler is constructible with the value wired, i.e. no
    // non-positive or non-finite bound reached it.
    expect(() => createHandler()).not.toThrow();
  });

  it("answers every over-limit length itself, so the SDK's own bound can never answer instead", async () => {
    // The assertion above pins ONE length, at the bound. This pins the RANGE a
    // bound raised above ours would admit, because that is the only place the two
    // bounds can be told apart: `readRequestBody` in 2.3.0 refuses on DECLARED
    // Content-Length without reading anything, so a length between the two
    // bounds is answered by whichever bound is lower - ours as
    // `{error: "invalid_request"}`, the SDK's as a JSON-RPC body whose message
    // contains "Payload Too Large". Probed and confirmed:
    //   413 {"jsonrpc":"2.0","error":{"code":-32000,"message":"Payload Too
    //   Large: Request body must not exceed 4194304 bytes"},"id":null}
    //
    // So if `maxRequestBodySize` were left at the SDK's own default, raising
    // `MAX_REQUEST_BODY_BYTES` would silently leave a stale 4 MiB behind and every
    // one of these would come back in the SDK's shape - the symptom being "the
    // limit did not change", with an error body that is not this route's.
    for (const declaredLength of [5 * 1024 * 1024, 8 * 1024 * 1024]) {
      const headers = new Headers(MCP_HEADERS);
      headers.set("content-length", String(declaredLength));

      const response = await createHandler()(createRequest(
        { jsonrpc: "2.0", id: 1, method: "ping" },
        headers,
      ));

      expect(response.status, String(declaredLength)).toBe(413);
      const body = await response.text();
      expect(body, String(declaredLength)).not.toContain("Payload Too Large");
      expect(JSON.parse(body), String(declaredLength)).toMatchObject({
        error: "invalid_request",
        error_description: "Request body too large.",
      });
    }
  });

  it("rejects a non-numeric Content-Length rather than trusting it", async () => {
    const headers = new Headers(MCP_HEADERS);
    // undici recomputes Content-Length for a string body, so the header is set
    // through a stream whose declared length cannot be derived.
    const request = new Request(RESOURCE_URL, {
      method: "POST",
      headers,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("{}"));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    Object.defineProperty(request, "auth", { value: AUTH_INFO });
    Object.defineProperty(request, "headers", {
      value: new Headers({ ...MCP_HEADERS, "content-length": "not-a-number" }),
    });

    const response = await createHandler()(request);

    expect(response.status).toBe(400);
  });

  describe("preflight and POST share one origin policy", () => {
    /**
     * The regression this pins: preflight used to answer
     * `Access-Control-Allow-Origin: *` and skip Host/Origin validation entirely,
     * while POST validated the exact resource origin. A browser on any other
     * origin was told it was allowed and then received 403.
     *
     * Each case asserts the same decision is reached on both paths, so the two
     * cannot drift apart again without failing here.
     */
    it.each([
      // A refused origin need not share one status: an unparseable Origin is a
      // malformed request (400) while a parseable mismatch is forbidden (403).
      // The invariant under test is that preflight and POST agree, and that a
      // refused origin is never advertised as allowed.
      ["matching browser origin", RESOURCE_ORIGIN, true],
      ["foreign browser origin", "https://evil.example", false],
      ["no origin (server to server)", undefined, true],
      ["opaque origin", "null", false],
    ])("%s", async (_label, origin, allowed) => {
      const preflightResponse = await createHandler()(preflight({ origin }));

      const postHeaders = new Headers(MCP_HEADERS);
      if (origin !== undefined) postHeaders.set("origin", origin);
      const postResponse = await createHandler()(createRequest(
        { jsonrpc: "2.0", id: 1, method: "ping" },
        postHeaders,
      ));

      // The POST may still be refused further downstream (a bare ping is not a
      // complete MCP session), so the assertion is about the ORIGIN decision
      // specifically: both paths must reach the same verdict, and a refused
      // origin must never be advertised as allowed.
      const postBody = await postResponse.clone().text();

      if (allowed) {
        expect(preflightResponse.status).toBe(204);
        expect(postBody).not.toContain("Origin");
        expect(postResponse.headers.get("access-control-allow-origin")).not.toBe("*");
      } else {
        expect(preflightResponse.status).toBe(postResponse.status);
        expect(preflightResponse.status).toBeGreaterThanOrEqual(400);
        expect(postBody).toContain("Origin");
        expect(preflightResponse.headers.get("access-control-allow-origin")).toBeNull();
      }
    });

    it("never returns a wildcard allow-origin on the matching-origin preflight", async () => {
      const response = await createHandler()(preflight({ origin: RESOURCE_ORIGIN }));

      expect(response.headers.get("access-control-allow-origin")).toBe(RESOURCE_ORIGIN);
      expect(response.headers.get("access-control-allow-origin")).not.toBe("*");
      expect(response.headers.get("vary")).toBe("Origin");
    });

    it("echoes no allow-origin for a server-to-server preflight that sent no Origin", async () => {
      // Deliberate: there is no origin to echo, and inventing one (or a wildcard)
      // would advertise the authenticated path to callers that never asked.
      const response = await createHandler()(preflight());

      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      expect(response.headers.get("vary")).toBe("Origin");
    });

    it("treats an opaque `null` Origin as refused on both paths", async () => {
      // `Origin: null` is what a sandboxed iframe, a data: document and a
      // redirected request send. It is an origin the browser cannot attribute,
      // so allowing it would let ANY page that can run a sandboxed iframe reach
      // the authenticated endpoint. Refused on the grounds that the value names
      // no origin this policy knows, not because it is malformed per se - it
      // parses as the string "null", which is not a URL, so it lands on the
      // malformed-request branch and is refused as a non-origin.
      const response = await createHandler()(preflight({ origin: "null" }));

      expect(response.status).toBe(400);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    });

    it("applies Host validation to preflight, which previously skipped it entirely", async () => {
      const response = await createHandler()(preflight({
        origin: RESOURCE_ORIGIN,
        host: `${RESOURCE_HOST}.evil`,
      }));

      expect(response.status).toBe(421);
    });

    it.each([
      ["a wrong host", { origin: RESOURCE_ORIGIN, host: `${RESOURCE_HOST}.evil` }, 421],
      ["a foreign origin", { origin: "https://evil.example", host: RESOURCE_HOST }, 403],
      ["an opaque origin", { origin: "null", host: RESOURCE_HOST }, 400],
      ["an explicit :80", { origin: RESOURCE_ORIGIN, host: `${RESOURCE_HOST}:80` }, 421],
    ])(
      "Vary: Origin on the %s refusal, because every response here is decided per origin",
      async (_label, init, status) => {
        // The 204 carries `Vary: Origin` and so do the 401/403 in http-auth.ts and
        // the 404 in endpoint.ts, but these Host/Origin refusals were produced by
        // `invalidRequest`, which set only `Cache-Control: no-store` - so they were
        // the one origin-dependent response on this route with no Vary at all. They
        // emit no allow-origin either (correct: the origin was not accepted), so Vary
        // was the only thing marking them as origin-scoped. A shared cache that
        // stored one origin's refusal could otherwise replay it for another.
        const response = await createHandler()(preflight(init));

        expect(response.status).toBe(status);
        expect(response.headers.get("vary")).toContain("Origin");
        expect(response.headers.get("cache-control")).toContain("no-store");
        expect(response.headers.get("access-control-allow-origin")).toBeNull();
      },
    );

    it("Vary: Origin on the POST-path refusals too, not just the preflight's", async () => {
      // The same `invalidRequest` produces these, so proving it once on the
      // preflight would leave the POST path unpinned. The two paths share the
      // function; a change that only fixed the preflight would keep this green
      // otherwise.
      const headers = new Headers(MCP_HEADERS);
      headers.set("origin", "https://evil.example");

      const response = await createHandler()(createRequest(
        { jsonrpc: "2.0", id: 1, method: "ping" },
        headers,
      ));

      expect(response.status).toBe(403);
      expect(response.headers.get("vary")).toContain("Origin");
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    });

    it("gives preflight and POST the same verdict for every Host it rejects", async () => {
      // The single-policy invariant stated over Host rather than Origin. Asserted
      // on the status only because the status is the observable decision; the
      // allow-origin assertion above already covers the header half.
      const badHosts = [
        `${RESOURCE_HOST}.evil`,
        `${RESOURCE_HOST}:80`,
        `${RESOURCE_HOST}:8443`,
        `${RESOURCE_HOST}#evil`,
        `${RESOURCE_HOST}/evil`,
      ];

      for (const host of badHosts) {
        const preflightResponse = await createHandler()(preflight({
          origin: RESOURCE_ORIGIN,
          host,
        }));
        const postHeaders = new Headers(MCP_HEADERS);
        postHeaders.set("host", host);
        postHeaders.set("origin", RESOURCE_ORIGIN);
        const postResponse = await createHandler()(createRequest(
          { jsonrpc: "2.0", id: 1, method: "ping" },
          postHeaders,
        ));

        expect(preflightResponse.status, `preflight host ${host}`).toBe(postResponse.status);
        expect(preflightResponse.status, `preflight host ${host}`).toBeGreaterThanOrEqual(400);
        expect(preflightResponse.headers.get("access-control-allow-origin"), host).toBeNull();
      }
    });

    /**
     * The single-policy invariant stated as a matrix rather than as a list of
     * individual cases: for every (Host, Origin) pair, preflight and POST must
     * reach the SAME verdict, and a refusal must carry no allow-origin on either.
     *
     * The pairs below are chosen so each axis is exercised independently (Host
     * wrong with Origin right, and the reverse) and then jointly, plus the
     * server-to-server no-Origin case. A per-axis test could pass while the pair
     * behaved differently from each of its parts; a matrix cannot.
     */
    it.each([
      ["both correct", { host: RESOURCE_HOST, origin: RESOURCE_ORIGIN }, true],
      ["both absent", { host: RESOURCE_HOST, origin: undefined }, true],
      ["host wrong only", { host: `${RESOURCE_HOST}.evil`, origin: RESOURCE_ORIGIN }, false],
      ["origin wrong only", { host: RESOURCE_HOST, origin: "https://evil.example" }, false],
      ["both wrong", { host: `${RESOURCE_HOST}.evil`, origin: "https://evil.example" }, false],
      ["host port wrong only", { host: `${RESOURCE_HOST}:8443`, origin: RESOURCE_ORIGIN }, false],
      ["host :80 only", { host: `${RESOURCE_HOST}:80`, origin: RESOURCE_ORIGIN }, false],
      ["host :443 only", { host: `${RESOURCE_HOST}:443`, origin: RESOURCE_ORIGIN }, true],
      ["origin opaque only", { host: RESOURCE_HOST, origin: "null" }, false],
      ["origin path only", { host: RESOURCE_HOST, origin: `${RESOURCE_ORIGIN}/path` }, false],
      ["host backslash only", { host: `${RESOURCE_HOST}\\evil.com`, origin: RESOURCE_ORIGIN }, false],
      ["both malformed", { host: `${RESOURCE_HOST}\\evil.com`, origin: "null" }, false],
    ])("agrees on both paths: %s", async (_label, init, allowed) => {
      const preflightHeaders = new Headers({ host: init.host });
      if (init.origin !== undefined) preflightHeaders.set("origin", init.origin);

      const preflightResponse = await createHandler()(
        new Request(RESOURCE_URL, { method: "OPTIONS", headers: preflightHeaders }),
      );

      const postHeaders = new Headers(MCP_HEADERS);
      postHeaders.set("host", init.host);
      if (init.origin !== undefined) postHeaders.set("origin", init.origin);
      const postResponse = await createHandler()(createRequest(
        { jsonrpc: "2.0", id: 1, method: "ping" },
        postHeaders,
      ));

      if (allowed) {
        expect(preflightResponse.status, _label).toBe(204);
        // The POST echoes the SAME allow-origin the preflight advertised. This is
        // the half of "one policy" that a status comparison cannot reach: two
        // paths could agree on the verdict while echoing different allow-origins,
        // and the browser would still discard the POST as opaque.
        expect(postResponse.headers.get("access-control-allow-origin"), _label)
          .toBe(preflightResponse.headers.get("access-control-allow-origin"));
        // With no Origin sent there is nothing to echo, so "equal" means equal to
        // each other AND absent on both. Asserted explicitly because the general
        // rule (echo the resource origin) would otherwise be read as applying here.
        const expected = init.origin === undefined ? null : RESOURCE_ORIGIN;
        expect(preflightResponse.headers.get("access-control-allow-origin"), _label)
          .toBe(expected);
      } else {
        // Same status, which is the whole point: two independent policies would
        // pick different statuses for at least one of these rows.
        expect(preflightResponse.status, _label).toBe(postResponse.status);
        expect(preflightResponse.status, _label).toBeGreaterThanOrEqual(400);
        expect(preflightResponse.headers.get("access-control-allow-origin"), _label).toBeNull();
        expect(postResponse.headers.get("access-control-allow-origin"), _label).toBeNull();
      }
    });

    it("refuses everything a wildcard would have allowed, so no wildcard is reachable", async () => {
      // Enumerated rather than sampled: a wildcard implementation returns 204 and
      // `*` for every refused row below, so each row independently discriminates.
      const refused = [
        "https://evil.example",
        "http://ega.example.com",
        "https://ega.example.com.evil",
        "https://sub.ega.example.com",
        "null",
        "https://ega.example.com:8443",
        "https://EGA.example.com",
      ];

      for (const origin of refused) {
        const response = await createHandler()(preflight({ origin }));

        expect(response.status, origin).toBeGreaterThanOrEqual(400);
        expect(response.headers.get("access-control-allow-origin"), origin).toBeNull();
        expect(response.headers.get("access-control-allow-origin"), origin).not.toBe("*");
      }
    });
  });

  describe("Host is compared to the value that was sent, not to a re-parse of it", () => {
    /**
     * WHATWG URL is more forgiving than the intermediaries in front of this
     * route. These cases are all ACCEPTED by the pre-fix implementation, and
     * each is a Host check decided by a parser difference rather than by the
     * value: `new URL("https://a\\b").host` is `a`, and `new URL` percent-decodes
     * hostnames, so both concluded "this is our resource" about an authority an
     * intermediary may read differently.
     */
    it.each([
      ["a backslash, which URL treats as a path separator", `${RESOURCE_HOST}\\evil.com`],
      ["a percent-encoded first label, which URL decodes", `%65ga.example.com`],
      ["a non-ASCII label, which URL punycodes", `${RESOURCE_HOST}é`],
    ])("refuses %s", async (_label, host) => {
      const response = await createHandler()(preflight({ origin: RESOURCE_ORIGIN, host }));

      expect(response.status).toBe(400);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    });

    it("refuses such a Host on the POST path too, so the guard is not preflight-only", async () => {
      const headers = new Headers(MCP_HEADERS);
      headers.set("host", `${RESOURCE_HOST}\\evil.com`);
      const response = await createHandler()(createRequest(
        { jsonrpc: "2.0", id: 1, method: "ping" },
        headers,
      ));

      expect(response.status).toBe(400);
    });

    it("accepts an explicit default https port, which IS this resource", async () => {
      const response = await createHandler()(preflight({
        origin: RESOURCE_ORIGIN,
        host: `${RESOURCE_HOST}:443`,
      }));

      expect(response.status).toBe(204);
    });

    it("refuses an explicit :80 rather than normalising it onto an https resource", async () => {
      // `new URL("http://host:80").host` strips the default 80 and yields the
      // bare host, so an http scheme would have accepted a plain-HTTP authority
      // against an https-only resource. The `https://` scheme plus the explicit
      // `:80` surviving the round-trip are both load-bearing here.
      const response = await createHandler()(preflight({
        origin: RESOURCE_ORIGIN,
        host: `${RESOURCE_HOST}:80`,
      }));

      expect(response.status).toBe(421);
    });

    it("refuses a missing Host header rather than defaulting it", async () => {
      // undici supplies a Host for a Request built from a URL, so the header is
      // removed after construction to reach the missing branch.
      const request = preflight({ origin: RESOURCE_ORIGIN });
      Object.defineProperty(request, "headers", { value: new Headers({ origin: RESOURCE_ORIGIN }) });

      const response = await createHandler()(request);

      expect(response.status).toBe(400);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    });
  });

  it("refuses a resource whose host never matches the request", async () => {
    // Ties the Host policy to the CONFIGURED resource: a handler built for one
    // origin must not validate a request for another. Without this, a deployment
    // that misconfigured MCP_RESOURCE_URL would 421 every real request and, in
    // the preflight-only variant, still answer 204.
    const handler = createHandler("https://other.example.com/api/mcp");
    const response = await handler(preflight({ origin: RESOURCE_ORIGIN, host: RESOURCE_HOST }));

    expect(response.status).toBe(421);
  });

  describe("the origin policy merges into headers instead of overwriting them", () => {
    // These assert `applyMcpCorsHeaders` directly rather than through the
    // handler. The handler route is NOT discriminating here: the installed SDK
    // 2.3.0's stateless JSON path emits no `Vary` and no `Cache-Control` (its
    // `no-cache, no-transform` lives only on its SSE constructors), so a `set`
    // and a merge are indistinguishable there. The merge is what protects the
    // response if that changes, and only a direct assertion can tell the two
    // implementations apart today.

    it("keeps a pre-existing Vary and adds Origin to it", () => {
      // Streamable HTTP negotiates on Accept. Overwriting Vary would tell a
      // shared cache the response depends on Origin alone.
      const headers = new Headers({ vary: "Accept" });

      applyMcpCorsHeaders(
        new Request(RESOURCE_URL, { headers: { origin: RESOURCE_ORIGIN } }),
        headers,
        RESOURCE_ORIGIN,
      );

      expect(headers.get("vary")).toBe("Accept, Origin");
    });

    it("does not add Origin twice when Vary already names it", () => {
      const headers = new Headers({ vary: "Accept, origin" });

      applyMcpCorsHeaders(
        new Request(RESOURCE_URL, { headers: { origin: RESOURCE_ORIGIN } }),
        headers,
        RESOURCE_ORIGIN,
      );

      expect(headers.get("vary")).toBe("Accept, origin");
    });

    it("leaves `Vary: *` alone, which already forbids any reuse", () => {
      const headers = new Headers({ vary: "*" });

      applyMcpCorsHeaders(
        new Request(RESOURCE_URL, { headers: { origin: RESOURCE_ORIGIN } }),
        headers,
        RESOURCE_ORIGIN,
      );

      expect(headers.get("vary")).toBe("*");
    });

    it("appends no-store to an existing directive list instead of replacing it", () => {
      const headers = new Headers({ "cache-control": "no-cache, no-transform" });

      applyMcpCorsHeaders(
        new Request(RESOURCE_URL, { headers: { origin: RESOURCE_ORIGIN } }),
        headers,
        RESOURCE_ORIGIN,
      );

      expect(headers.get("cache-control")).toBe("no-cache, no-transform, no-store");
    });

    it("does not duplicate no-store the policy has already applied", () => {
      const headers = new Headers();
      const request = new Request(RESOURCE_URL, { headers: { origin: RESOURCE_ORIGIN } });

      applyMcpCorsHeaders(request, headers, RESOURCE_ORIGIN);
      applyMcpCorsHeaders(request, headers, RESOURCE_ORIGIN);

      const directives = (headers.get("cache-control") ?? "").split(",");
      expect(directives.filter((d) => d.trim() === "no-store")).toHaveLength(1);
    });

    it("does not duplicate no-store when the response was built with it", async () => {
      // `invalidRequest` sets no-store and the origin policy then adds it again.
      const headers = new Headers(MCP_HEADERS);
      headers.set("origin", RESOURCE_ORIGIN);
      headers.set("mcp-protocol-version", "2025-06-18");
      const response = await createHandler()(createRequest(
        { jsonrpc: "2.0", id: 1, method: "ping" },
        headers,
      ));

      expect(response.status).toBe(400);
      const directives = (response.headers.get("cache-control") ?? "").split(",");
      expect(directives.filter((d) => d.trim() === "no-store")).toHaveLength(1);
    });

    it("emits no allow-origin for an Origin the policy did not accept", () => {
      // The echo is conditioned on the accepted origin, not merely on the header
      // being present. Without that condition this helper would advertise the
      // authenticated path to any origin, which is the wildcard failure in
      // another shape.
      const headers = new Headers();

      applyMcpCorsHeaders(
        new Request(RESOURCE_URL, { headers: { origin: "https://evil.example" } }),
        headers,
        RESOURCE_ORIGIN,
      );

      expect(headers.get("access-control-allow-origin")).toBeNull();
    });
  });

  it("never emits Access-Control-Allow-Credentials", async () => {
    // Auth is a Bearer header, not a cookie. Credentials mode is what would make
    // a wildcard dangerous, so its absence is the decision that lets the rest of
    // this file use exact-origin echo safely.
    const headers = new Headers(MCP_HEADERS);
    headers.set("origin", RESOURCE_ORIGIN);

    const post = await createHandler()(createRequest(
      { jsonrpc: "2.0", id: 1, method: "ping" },
      headers,
    ));
    const options = await createHandler()(preflight({ origin: RESOURCE_ORIGIN }));

    expect(post.headers.get("access-control-allow-credentials")).toBeNull();
    expect(options.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it.each([
    ["ega.example.com.evil", undefined, 421],
    ["ega.example.com/path", undefined, 400],
    ["ega.example.com", "https://ega.example.com/path", 400],
    ["ega.example.com", "null", 400],
  ])("strictly rejects malformed or mismatched Host/Origin values", async (host, origin, status) => {
    const headers = new Headers(MCP_HEADERS);
    headers.set("host", host);
    if (origin) headers.set("origin", origin);

    const response = await createHandler()(createRequest(
      { jsonrpc: "2.0", id: 1, method: "ping" },
      headers,
    ));

    expect(response.status).toBe(status);
  });
});