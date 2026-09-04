import fs from "node:fs";
import path from "node:path";

const inboxScreenPath = path.resolve(
  __dirname,
  "../../../app/(app)/(tabs)/inbox.tsx",
);

const inboxScreen = fs.readFileSync(inboxScreenPath, "utf8");

describe("mobile Inbox list rendering", () => {
  it("virtualizes Inbox items instead of eagerly mounting the full result set", () => {
    expect(inboxScreen).toMatch(/\bFlatList\b/);
    expect(inboxScreen).toMatch(/data=\{items\}/);
    expect(inboxScreen).toMatch(/renderItem=/);
    expect(inboxScreen).not.toMatch(/<ScrollView\b/);
    expect(inboxScreen).not.toMatch(/items\.map\(/);
  });
});
