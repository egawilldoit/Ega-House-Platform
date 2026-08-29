import type { FrictionRadarResponse } from "@ega/contracts/friction";

import type { ApiResult } from "./errors";
import type { HttpClient } from "./http";

export type FrictionApi = {
  radar(): Promise<ApiResult<FrictionRadarResponse>>;
};

export function createFrictionApi(http: HttpClient): FrictionApi {
  return {
    radar() {
      return http.request<FrictionRadarResponse>({ path: "/api/friction/radar" });
    },
  };
}
