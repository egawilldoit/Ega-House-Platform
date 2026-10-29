/**
 * Task dependency (`blocked by`) rules.
 *
 * A dependency edge is directed: `taskId` is blocked by `blockedByTaskId`.
 * Edges are informational only. They never change status, move dates, schedule
 * successors or start agents; the canonical `blocked` status + reason policy is
 * owned elsewhere.
 *
 * The functions here are the fast precheck used by callers. The durable
 * invariant is enforced by the database trigger with an owner-scoped advisory
 * lock, because two concurrent reverse inserts cannot be prevented by a
 * read-then-write precheck alone.
 */

export type TaskDependencyEdge = Readonly<{
  taskId: string;
  blockedByTaskId: string;
}>;

export function isSelfTaskDependency(edge: TaskDependencyEdge) {
  return edge.taskId.trim() !== "" && edge.taskId === edge.blockedByTaskId;
}

export function isSameTaskDependency(
  left: TaskDependencyEdge,
  right: TaskDependencyEdge,
) {
  return left.taskId === right.taskId && left.blockedByTaskId === right.blockedByTaskId;
}

/**
 * True when adding `candidate` would close a dependency cycle.
 *
 * Walks predecessor links from the proposed predecessor. If the walk reaches
 * the proposed dependent, the new edge would form a cycle. Existing duplicate
 * edges are not cycles: they are rejected separately as duplicates.
 */
export function wouldCreateTaskDependencyCycle(
  existingEdges: ReadonlyArray<TaskDependencyEdge>,
  candidate: TaskDependencyEdge,
) {
  if (isSelfTaskDependency(candidate)) return true;

  const predecessorsByTaskId = new Map<string, string[]>();
  for (const edge of existingEdges) {
    const predecessors = predecessorsByTaskId.get(edge.taskId) ?? [];
    predecessors.push(edge.blockedByTaskId);
    predecessorsByTaskId.set(edge.taskId, predecessors);
  }

  const visited = new Set<string>();
  const stack = [candidate.blockedByTaskId];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    if (current === candidate.taskId) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    for (const predecessor of predecessorsByTaskId.get(current) ?? []) {
      stack.push(predecessor);
    }
  }

  return false;
}
