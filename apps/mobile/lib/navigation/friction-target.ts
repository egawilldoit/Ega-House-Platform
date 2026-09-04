export type FrictionTarget = Readonly<{
  type: 'task' | 'goal';
  id: string;
}>;

export type FrictionTargetRoute =
  | {
      type: 'task';
      pathname: '/(app)/tasks/[id]';
      params: { id: string };
    }
  | {
      type: 'goal';
      pathname: '/(app)/goals/[id]';
      params: { id: string };
    };

/**
 * Maps a Friction signal's semantic owner to an existing detail route.
 * Invalid or unknown targets stay inert instead of producing a malformed path.
 */
export function frictionTargetToRoute(
  target: FrictionTarget | null | undefined,
): FrictionTargetRoute | null {
  if (!target || !target.id.trim()) {
    return null;
  }

  if (target.type === 'task') {
    return {
      type: 'task',
      pathname: '/(app)/tasks/[id]',
      params: { id: target.id },
    };
  }

  if (target.type === 'goal') {
    return {
      type: 'goal',
      pathname: '/(app)/goals/[id]',
      params: { id: target.id },
    };
  }

  return null;
}
