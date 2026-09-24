import { describe, expect, it, vi } from "vitest";

import { createAuthenticatedActor, type RepositoryResult, type TimeContextRepository } from "@ega/application";

import { RequestMemoTimeContextRepository } from "./request-time-context";

function createCountingRepository() {
  const getTimezone = vi.fn(
    async (actor: { userId: string }): Promise<RepositoryResult<string | null>> => ({
      ok: true,
      value: `Zone/${actor.userId}`,
    }),
  );
  const setTimezone = vi.fn(
    async (): Promise<RepositoryResult<string>> => ({ ok: true, value: "UTC" }),
  );

  return {
    repository: { getTimezone, setTimezone } satisfies TimeContextRepository,
    getTimezone,
    setTimezone,
  };
}

describe("RequestMemoTimeContextRepository", () => {
  it("resolves the stored timezone once per actor per request", async () => {
    const { repository, getTimezone } = createCountingRepository();
    const memo = new RequestMemoTimeContextRepository(repository);
    const actor = createAuthenticatedActor("user-1");

    const results = await Promise.all([
      memo.getTimezone(actor),
      memo.getTimezone(actor),
      memo.getTimezone(actor),
      memo.getTimezone(actor),
    ]);

    expect(getTimezone).toHaveBeenCalledTimes(1);
    for (const result of results) {
      expect(result).toEqual({ ok: true, value: "Zone/user-1" });
    }
  });

  it("keeps distinct owners separate", async () => {
    const { repository, getTimezone } = createCountingRepository();
    const memo = new RequestMemoTimeContextRepository(repository);

    await memo.getTimezone(createAuthenticatedActor("user-1"));
    await memo.getTimezone(createAuthenticatedActor("user-2"));
    await memo.getTimezone(createAuthenticatedActor("user-1"));

    expect(getTimezone).toHaveBeenCalledTimes(2);
  });

  it("drops the memo when the timezone is written", async () => {
    const { repository, getTimezone } = createCountingRepository();
    const memo = new RequestMemoTimeContextRepository(repository);
    const actor = createAuthenticatedActor("user-1");

    await memo.getTimezone(actor);
    await memo.setTimezone(actor, "Europe/London");
    await memo.getTimezone(actor);

    expect(getTimezone).toHaveBeenCalledTimes(2);
  });
});
