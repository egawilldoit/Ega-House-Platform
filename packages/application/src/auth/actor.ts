export type AuthenticatedActor = Readonly<{
  userId: string;
}>;

export function createAuthenticatedActor(userId: string): AuthenticatedActor {
  const normalizedUserId = userId.trim();

  if (!normalizedUserId) {
    throw new Error("Authenticated actor userId is required.");
  }

  return { userId: normalizedUserId };
}
