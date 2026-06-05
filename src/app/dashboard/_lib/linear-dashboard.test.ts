import assert from "node:assert/strict";
import test from "node:test";

import { readLinearProjectName } from "./linear-dashboard";

test("readLinearProjectName returns trimmed env value when set", () => {
  const original = process.env.LINEAR_PROJECT_NAME;
  try {
    process.env.LINEAR_PROJECT_NAME = "  Acme  ";
    assert.equal(readLinearProjectName(), "Acme");
  } finally {
    if (original === undefined) delete process.env.LINEAR_PROJECT_NAME;
    else process.env.LINEAR_PROJECT_NAME = original;
  }
});

test("readLinearProjectName returns fallback in non-production when unset", () => {
  const original = process.env.LINEAR_PROJECT_NAME;
  const originalNodeEnv = process.env.NODE_ENV;
  try {
    delete process.env.LINEAR_PROJECT_NAME;
    process.env.NODE_ENV = "development";
    assert.equal(readLinearProjectName(), "EGA House Platform");
  } finally {
    if (original === undefined) delete process.env.LINEAR_PROJECT_NAME;
    else process.env.LINEAR_PROJECT_NAME = original;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }
});

test("readLinearProjectName returns fallback in test env when unset", () => {
  const original = process.env.LINEAR_PROJECT_NAME;
  const originalNodeEnv = process.env.NODE_ENV;
  try {
    delete process.env.LINEAR_PROJECT_NAME;
    process.env.NODE_ENV = "test";
    assert.equal(readLinearProjectName(), "EGA House Platform");
  } finally {
    if (original === undefined) delete process.env.LINEAR_PROJECT_NAME;
    else process.env.LINEAR_PROJECT_NAME = original;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }
});

test("readLinearProjectName throws in production when unset", () => {
  const original = process.env.LINEAR_PROJECT_NAME;
  const originalNodeEnv = process.env.NODE_ENV;
  try {
    delete process.env.LINEAR_PROJECT_NAME;
    process.env.NODE_ENV = "production";
    assert.throws(
      () => readLinearProjectName(),
      /LINEAR_PROJECT_NAME env var is required in production/,
    );
  } finally {
    if (original === undefined) delete process.env.LINEAR_PROJECT_NAME;
    else process.env.LINEAR_PROJECT_NAME = original;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }
});

test("readLinearProjectName returns the value verbatim when no trimming needed", () => {
  const original = process.env.LINEAR_PROJECT_NAME;
  try {
    process.env.LINEAR_PROJECT_NAME = "Production Project";
    assert.equal(readLinearProjectName(), "Production Project");
  } finally {
    if (original === undefined) delete process.env.LINEAR_PROJECT_NAME;
    else process.env.LINEAR_PROJECT_NAME = original;
  }
});

test("readLinearProjectName falls through to env when value is whitespace-only", () => {
  const original = process.env.LINEAR_PROJECT_NAME;
  const originalNodeEnv = process.env.NODE_ENV;
  try {
    process.env.LINEAR_PROJECT_NAME = "   ";
    process.env.NODE_ENV = "development";
    assert.equal(readLinearProjectName(), "EGA House Platform");
  } finally {
    if (original === undefined) delete process.env.LINEAR_PROJECT_NAME;
    else process.env.LINEAR_PROJECT_NAME = original;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }
});
