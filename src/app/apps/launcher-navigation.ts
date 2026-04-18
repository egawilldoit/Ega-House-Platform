type LauncherMoveInput = {
  currentIndex: number;
  key: string;
  totalItems: number;
  columns?: number;
};

const KEY_SPACE = " ";

export function isLauncherActivationKey(key: string) {
  return key === "Enter" || key === KEY_SPACE;
}

export function getNextLauncherIndex({
  currentIndex,
  key,
  totalItems,
  columns = 2,
}: LauncherMoveInput): number | null {
  if (totalItems <= 0) {
    return null;
  }

  const maxIndex = totalItems - 1;
  const normalizedIndex = Math.min(Math.max(currentIndex, 0), maxIndex);
  const safeColumns = Math.max(columns, 1);

  if (key === "ArrowRight") {
    return (normalizedIndex + 1) % totalItems;
  }
  if (key === "ArrowLeft") {
    return (normalizedIndex - 1 + totalItems) % totalItems;
  }
  if (key === "ArrowDown") {
    return (normalizedIndex + safeColumns) % totalItems;
  }
  if (key === "ArrowUp") {
    return (normalizedIndex - safeColumns + totalItems) % totalItems;
  }
  if (key === "Home") {
    return 0;
  }
  if (key === "End") {
    return maxIndex;
  }

  return null;
}
