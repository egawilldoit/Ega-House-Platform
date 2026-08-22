import type {
  MobileAuthLogoutResponse,
  MobileAuthRefreshResponse,
  MobileAuthSessionResponse,
} from "@ega/contracts/mobile";
import type { ApiResult } from "./errors";
import type { HttpClient } from "./http";

export type AuthApi = {
  login(email: string, password: string): Promise<ApiResult<MobileAuthSessionResponse>>;
  refresh(refreshToken: string): Promise<ApiResult<MobileAuthRefreshResponse>>;
  logout(): Promise<ApiResult<MobileAuthLogoutResponse>>;
};

export function createAuthApi(http: HttpClient): AuthApi {
  return {
    login(email, password) {
      return http.request<MobileAuthSessionResponse>({
        path: "/api/auth/session",
        method: "POST",
        authenticated: false,
        body: { email, password },
      });
    },
    refresh(refreshToken) {
      return http.request<MobileAuthRefreshResponse>({
        path: "/api/auth/refresh",
        method: "POST",
        authenticated: false,
        body: { refreshToken },
      });
    },
    logout() {
      return http.request<MobileAuthLogoutResponse>({
        path: "/api/auth/logout",
        method: "POST",
        body: {},
      });
    },
  };
}
