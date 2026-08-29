import { useQuery } from "@tanstack/react-query";

import { fetchMobileHealthSnapshot } from "@/lib/api/health";

export const healthQueryKeys = {
  all: ["health"] as const,
  snapshot: () => ["health", "snapshot"] as const,
};

export function useHealthSnapshotQuery() {
  return useQuery({
    queryKey: healthQueryKeys.snapshot(),
    queryFn: () => fetchMobileHealthSnapshot(),
    placeholderData: (prev) => prev,
  });
}
