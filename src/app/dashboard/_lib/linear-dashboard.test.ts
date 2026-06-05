import assert from "node:assert/strict";
import test from "node:test";

import { readLinearProjectName } from "./linear-dashboard";

function setEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete (process.env as unknown as Record<string, string | undefined>)[name];
  } else {
    (process.env as unknown as Record<string, string>)[name] = value;
  }
}

test("readLinearProjectName returns trimmed env value when set", () => {
  const original = process.env.LINEAR_PROJECT_NAME;
  try {
    setEnv("LINEAR_PROJECT_NAME", "  Acme  ");
    assert.equal(readLinearProjectName(), "Acme");
  } finally {
    setEnv("LINEAR_PROJECT_NAME", original);
  }
});

test("readLinearProjectName returns fallback in non-production when unset", () => {
  const original = process.env.LINEAR_PROJECT_NAME;
  const originalNodeEnv = process.env.NODE_ENV;
  try {
    setEnv("LINEAR_PROJECT_NAME", undefined);
    setEnv("NODE_ENV", "development");
    assert.equal(readLinearProjectName(), "EGA House Platform");
  } finally {
    setEnv("LINEAR_PROJECT_NAME", original);
    setEnv("NODE_ENV", originalNodeEnv);
  }
});

test("readLinearProjectName returns fallback in test env when unset", () => {
  const original = process.env.LINEAR_PROJECT_NAME;
  const originalNodeEnv = process.env.NODE_ENV;
  try {
    setEnv("LINEAR_PROJECT_NAME", undefined);
    setEnv("NODE_ENV", "test");
    assert.equal(readLinearProjectName(), "EGA House Platform");
  } finally {
    setEnv("LINEAR_PROJECT_NAME", original);
    setEnv("NODE_ENV", originalNodeEnv);
  }
});

test("readLinearProjectName throws in production when unset", () => {
  const original = process.env.LINEAR_PROJECT_NAME;
  const originalNodeEnv = process.env.NODE_ENV;
  try {
    setEnv("LINEAR_PROJECT_NAME", undefined);
    setEnv("NODE_ENV", "production");
    assert.throws(
      () => readLinearProjectName(),
      /LINEAR_PROJECT_NAME env var is required in production/,
    );
  } finally {
    setEnv("LINEAR_PROJECT_NAME", original);
    setEnv("NODE_ENV", originalNodeEnv);
  }
});

test("readLinearProjectName returns the value verbatim when no trimming needed", () => {
  const original = process.env.LINEAR_PROJECT_NAME;
  try {
    setEnv("LINEAR_PROJECT_NAME", "Production Project");
    assert.equal(readLinearProjectName(), "Production Project");
  } finally {
    setEnv("LINEAR_PROJECT_NAME", original);
  }
});

test("readLinearProjectName falls through to env when value is whitespace-only", () => {
  const original = process.env.LINEAR_PROJECT_NAME;
  const originalNodeEnv = process.env.NODE_ENV;
  try {
    setEnv("LINEAR_PROJECT_NAME", "   ");
    setEnv("NODE_ENV", "development");
    assert.equal(readLinearProjectName(), "EGA House Platform");
  } finally {
    setEnv("LINEAR_PROJECT_NAME", original);
    setEnv("NODE_ENV", originalNodeEnv);
  }
});
