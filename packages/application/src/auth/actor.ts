export type AuthenticatedActor = Readonly<{
  userId: string;
}>;

export type VerifiedIdentity = Readonly<{
  id: string;
}>;

export function createAuthenticatedActor(userId: string): AuthenticatedActor {
  const normalizedUserId = userId.trim();

  if (!normalizedUserId) {
    throw new Error("Authenticated actor userId is required.");
  }

  return { userId: normalizedUserId };
}

/**
 * Derive application authority from a previously verified identity object.
 * Authentication verification itself remains a transport/provider concern.
 */
export function createAuthenticatedActorFromIdentity(
  identity: VerifiedIdentity,
): AuthenticatedActor {
  return createAuthenticatedActor(identity.id);
}
