import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { TaskCommentBody } from "@/components/tasks/drawer/task-comment-body";
import {
  isAllowedCommentUrl,
  parseCommentMarkdown,
} from "@/lib/comment-markdown";

test("URL policy allows only explicit safe schemes and same-document paths", () => {
  for (const url of [
    "https://example.com/a?b=1",
    "http://example.com",
    "mailto:owner@example.com",
    "/tasks?task=1",
    "#comment-1",
  ]) {
    assert.equal(isAllowedCommentUrl(url), true, url);
  }

  for (const url of [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "//evil.example",
    "https://example.com/a b",
    "",
  ]) {
    assert.equal(isAllowedCommentUrl(url), false, url);
  }
});

test("raw HTML stays text and unsafe links never become anchors", () => {
  const html = renderToStaticMarkup(
    <TaskCommentBody
      body={'<script>alert(1)</script> [click](javascript:alert(1)) [data](data:text/html,x)'}
      mentions={[]}
    />,
  );

  assert.doesNotMatch(html, /<script>/i);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /href="javascript:/i);
  assert.doesNotMatch(html, /href="data:/i);
  assert.match(html, /click/);
});

test("safe links keep noopener and markdown renders structurally", () => {
  const html = renderToStaticMarkup(
    <TaskCommentBody
      body={"**bold** *soft* `code`\n\n- one\n- two\n\n> quote\n\n[site](https://example.com)"}
      mentions={[]}
    />,
  );

  assert.match(html, /<strong[^>]*>bold<\/strong>/);
  assert.match(html, /<em>soft<\/em>/);
  assert.match(html, /<code[^>]*>code<\/code>/);
  assert.match(html, /<ul[^>]*><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<blockquote[^>]*>quote<\/blockquote>/);
  assert.match(html, /href="https:\/\/example.com"/);
  assert.match(html, /rel="nofollow noopener noreferrer"/);
});

test("malformed links stay ordinary text", () => {
  const blocks = parseCommentMarkdown("[unfinished](https://example.com");
  assert.equal(blocks.length, 1);
  const children = blocks[0]?.type === "paragraph" ? blocks[0].children : [];
  assert.equal(children.some((node) => node.type === "link"), false);
  assert.equal(children.map((node) => ("value" in node ? node.value : "")).join(""), "[unfinished](https://example.com");
});

test("only configured mention actors are highlighted", () => {
  const html = renderToStaticMarkup(
    <TaskCommentBody
      body={"@codex @ghost and mail a@codex.test"}
      mentions={[{ kind: "agent", ref: "agent:codex", label: "Codex" }]}
    />,
  );

  assert.match(html, />@codex</);
  assert.match(html, /@ghost/);
  assert.equal((html.match(/Mentioned Codex/g) ?? []).length, 1);
  assert.match(html, /a@codex\.test/);
});

test("inline markdown cannot escape into raw markup", () => {
  const html = renderToStaticMarkup(
    <TaskCommentBody
      body={'<img src=x onerror="alert(1)"> **<b>no</b>**'}
      mentions={[]}
    />,
  );
  assert.doesNotMatch(html, /<img/i);
  assert.doesNotMatch(html, /<b>/);
  assert.match(html, /&lt;img/);
});
