export type MobileAuthUser = {
  id: string;
  email: string;
};

export type MobileAuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

export type MobileApiError = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export type MobileApiErrorResponse = {
  ok: false;
  error: MobileApiError;
};

export type MobileAuthSessionResponse = {
  ok: true;
  session: MobileAuthSession;
  user: MobileAuthUser;
};

export type MobileAuthRefreshResponse = {
  ok: true;
  session: MobileAuthSession;
  user?: MobileAuthUser;
};

export type StoredMobileSession = {
  session: MobileAuthSession;
  user: MobileAuthUser;
};
