import type {
  MobileApiErrorResponse as ContractMobileApiErrorResponse,
  MobileAuthenticatedUser,
  MobileAuthRefreshResponse as ContractMobileAuthRefreshResponse,
  MobileAuthSessionResponse as ContractMobileAuthSessionResponse,
  MobileSessionPayload,
} from "@ega/contracts/mobile";

export type MobileAuthUser = MobileAuthenticatedUser;
export type MobileAuthSession = MobileSessionPayload;
export type MobileApiErrorResponse = ContractMobileApiErrorResponse;
export type MobileApiError = ContractMobileApiErrorResponse["error"];
export type MobileAuthSessionResponse = ContractMobileAuthSessionResponse;
export type MobileAuthRefreshResponse = ContractMobileAuthRefreshResponse;

export type StoredMobileSession = {
  session: MobileAuthSession;
  user: MobileAuthUser;
};
