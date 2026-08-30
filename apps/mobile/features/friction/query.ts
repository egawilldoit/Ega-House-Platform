import { useQuery } from "@tanstack/react-query";

import { fetchMobileFrictionRadar } from "@/lib/api/friction";

export const frictionQueryKeys = {
  all: ["friction"] as const,
  radar: () => ["friction", "radar"] as const,
};

export function useFrictionRadarQuery() {
  return useQuery({
    queryKey: frictionQueryKeys.radar(),
    queryFn: () => fetchMobileFrictionRadar(),
  });
}
