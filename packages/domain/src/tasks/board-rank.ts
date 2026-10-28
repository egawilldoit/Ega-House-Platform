/**
 * Fractional board ranks (EGA-785).
 *
 * A Task's position inside its current status column is a short lexicographic
 * string. Inserting between two cards only needs a key strictly between the
 * neighbours, so a move never renumbers the rest of the column. The alphabet is
 * deliberately digits + uppercase only: that ordering is identical under the
 * database's `C` collation and in JavaScript, and it cannot collide with the
 * timestamp-shaped keys the insert/status-change trigger appends.
 *
 * This module is pure: no clock, no randomness, no persistence. The caller owns
 * the neighbours and the optimistic-concurrency checks.
 */

export const BOARD_RANK_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const MAX_RANK_DIGIT = BOARD_RANK_ALPHABET.length - 1;
const MID_RANK_DIGIT = BOARD_RANK_ALPHABET[Math.floor(MAX_RANK_DIGIT / 2)] ?? "I";

export type BoardRankedItem = {
  id: string;
  board_rank?: string | null;
};

export class BoardRankError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoardRankError";
  }
}

export function isBoardRank(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    /^[0-9A-Z]+$/.test(value)
  );
}

function assertBoardRank(value: string, label: string) {
  if (!isBoardRank(value)) {
    throw new BoardRankError(`${label} is not a valid board rank.`);
  }
}

function digitIndex(value: string) {
  return BOARD_RANK_ALPHABET.indexOf(value);
}

/**
 * The one rank comparator. `(rank, id)` is a total order: rows without a rank
 * (only possible before the migration backfill) sort after ranked rows and are
 * then ordered by their stable id.
 */
export function compareBoardRanks(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  const leftRank = left ?? null;
  const rightRank = right ?? null;
  if (leftRank === rightRank) return 0;
  if (leftRank === null) return 1;
  if (rightRank === null) return -1;
  return leftRank < rightRank ? -1 : leftRank > rightRank ? 1 : 0;
}

export function compareBoardRankedItems(
  left: BoardRankedItem,
  right: BoardRankedItem,
): number {
  const rankResult = compareBoardRanks(left.board_rank, right.board_rank);
  if (rankResult !== 0) return rankResult;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export function sortByBoardRank<T extends BoardRankedItem>(items: readonly T[]): T[] {
  return [...items].sort(compareBoardRankedItems);
}

/** A key strictly lower than `next`, used when inserting at the top. */
export function generateBoardRankBefore(next: string): string {
  assertBoardRank(next, "Next rank");
  const firstIndex = digitIndex(next[0]);
  if (firstIndex > 0) {
    const digit = BOARD_RANK_ALPHABET[Math.floor(firstIndex / 2)];
    // Never hand out an all-zero key: there is no representable key below it.
    return digit === "0" ? `0${MID_RANK_DIGIT}` : digit;
  }
  if (next.length === 1) {
    throw new BoardRankError("There is no room before the first board rank.");
  }
  return `0${generateBoardRankBefore(next.slice(1))}`;
}

/**
 * A key strictly greater than `prev` when there is no upper neighbour.
 *
 * The last digit is bumped in place, so repeated appends do not grow the key.
 * Only valid when the caller knows no later key exists in the column.
 */
export function generateBoardRankAfter(prev: string | null): string {
  if (prev === null) return MID_RANK_DIGIT;
  assertBoardRank(prev, "Previous rank");
  for (let index = prev.length - 1; index >= 0; index -= 1) {
    const digitIndexValue = digitIndex(prev[index]);
    if (digitIndexValue >= 0 && digitIndexValue < MAX_RANK_DIGIT) {
      return `${prev.slice(0, index)}${BOARD_RANK_ALPHABET[digitIndexValue + 1]}`;
    }
  }
  return `${prev}${MID_RANK_DIGIT}`;
}

/**
 * A key strictly between `prev` and `next`.
 *
 * `null` means "no neighbour on that side". Both `null` is the first card in an
 * empty column. The result is deterministic: two callers inserting into the same
 * gap receive the same key, and the `(rank, id)` tie-break keeps the order
 * stable. The move service turns that into an explicit conflict when the
 * neighbours changed underneath the caller.
 */
export function generateBoardRankBetween(
  prev: string | null,
  next: string | null,
): string {
  if (prev !== null) assertBoardRank(prev, "Previous rank");
  if (next !== null) assertBoardRank(next, "Next rank");
  if (prev === null && next === null) return MID_RANK_DIGIT;
  if (prev === null) return generateBoardRankBefore(next as string);
  if (next === null) return generateBoardRankAfter(prev);
  if (prev >= next) {
    throw new BoardRankError("Board ranks are out of order.");
  }

  let index = 0;
  while (index < prev.length && index < next.length && prev[index] === next[index]) {
    index += 1;
  }

  if (index === prev.length) {
    // `prev` is a prefix of `next` (for example "A" before "AB").
    const nextDigit = digitIndex(next[index]);
    if (nextDigit > 1) {
      return `${prev}${BOARD_RANK_ALPHABET[Math.floor(nextDigit / 2)]}`;
    }
    // `next` starts the suffix with 0 or 1. Returning `prev + "0"` here would
    // be the smallest representable key above `prev` and would exhaust the gap
    // below it, so descend one level into the suffix instead. The result is
    // always strictly greater than `prev` and strictly less than `next`, and
    // the gap below it always has room for another insert.
    const tail = next.slice(index + 1);
    if (nextDigit === 0 && tail.length === 0) {
      // `next` is exactly `prev + "0"`: no key can sit between them. This is
      // not produced by this generator or the migration backfill.
      throw new BoardRankError("There is no room between the two board ranks.");
    }
    return `${prev}${BOARD_RANK_ALPHABET[0]}${
      tail ? generateBoardRankBefore(tail) : MID_RANK_DIGIT
    }`;
  }

  const prevDigit = digitIndex(prev[index]);
  const nextDigit = digitIndex(next[index]);
  if (nextDigit - prevDigit > 1) {
    const middle = Math.floor((prevDigit + nextDigit) / 2);
    return `${prev.slice(0, index)}${BOARD_RANK_ALPHABET[middle]}`;
  }

  // The digits are adjacent: keep `prev` and append the middle digit. The
  // comparison already resolves on the differing digit, so the suffix is free.
  return `${prev}${MID_RANK_DIGIT}`;
}

/** Move one item to `targetIndex` inside an ordered column (clamped). */
export function moveBoardItem<T extends { id: string }>(
  items: readonly T[],
  itemId: string,
  targetIndex: number,
): T[] {
  const currentIndex = items.findIndex((item) => item.id === itemId);
  if (currentIndex === -1) return [...items];
  if (!Number.isFinite(targetIndex)) return [...items];
  const clampedTarget = Math.max(0, Math.min(items.length - 1, Math.trunc(targetIndex)));
  if (clampedTarget === currentIndex) return [...items];
  const next = [...items];
  const [item] = next.splice(currentIndex, 1);
  if (!item) return [...items];
  next.splice(clampedTarget, 0, item);
  return next;
}
