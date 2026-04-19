export type MobileAuthUser = {
  id: string;
  email: string;
};

export type MobileAuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

export type MobileAuthSessionResponse = {
  session: MobileAuthSession;
  user: MobileAuthUser;
};

export type MobileAuthRefreshResponse = {
  session: MobileAuthSession;
  user?: MobileAuthUser;
};
