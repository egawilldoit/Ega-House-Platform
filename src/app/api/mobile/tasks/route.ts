import { NextResponse } from "next/server";

import type {
  MobileApiErrorResponse,
  MobileTaskListResponse,
  MobileTaskMutationResponse,
} from "@/lib/contracts/mobile";
import { createTasks, getTaskById, getTasksWorkspaceData } from "@/lib/services/task-service";
import {
  parseJsonRequestBody,
  validateCreateTaskInput,
  validateMobileTaskListQuery,
} from "@/lib/validation/mobile";
import { resolveMobileRequestAuth } from "@/app/api/mobile/_lib/auth";
import {
  getMobileTaskCounters,
  mapTaskRecordToMobileTaskItem,
  mobileErrorResponse,
} from "@/app/api/mobile/_lib/helpers";

export async function GET(request: Request) {
  const authResult = await resolveMobileRequestAuth(request);
  if (!authResult.ok) {
    return mobileErrorResponse(authResult.code, authResult.message, authResult.status);
  }

  const url = new URL(request.url);
  const queryResult = validateMobileTaskListQuery(url.searchParams);
  if (!queryResult.ok) {
    return NextResponse.json(queryResult.error as MobileApiErrorResponse, {
      status: queryResult.status,
    });
  }

  try {
    const workspace = await getTasksWorkspaceData(
      {
        activeStatus: queryResult.data.status,
        requestedProjectId: queryResult.data.projectId,
        requestedGoalId: queryResult.data.goalId,
        activeDueFilter: queryResult.data.due,
        activeSort: queryResult.data.sort,
      },
      { supabase: authResult.supabase },
    );

    const limitedTasks = queryResult.data.limit
      ? workspace.tasks.slice(0, queryResult.data.limit)
      : workspace.tasks;
    const items = limitedTasks.map((task) =>
      mapTaskRecordToMobileTaskItem(task, workspace.taskTotalDurations[task.id] ?? 0),
    );

    return NextResponse.json(
      {
        ok: true,
        tasks: items,
        counters: getMobileTaskCounters(items),
        filters: {
          status: queryResult.data.status,
          projectId: workspace.activeProjectId,
          goalId: workspace.activeGoalId,
          due: queryResult.data.due,
          sort: queryResult.data.sort,
          limit: queryResult.data.limit,
        },
        projects: workspace.projects.map((project) => ({
          id: project.id,
          name: project.name,
        })),
        goals: workspace.goals.map((goal) => ({
          id: goal.id,
          title: goal.title,
        })),
      } satisfies MobileTaskListResponse,
      { status: 200 },
    );
  } catch {
    return mobileErrorResponse("INTERNAL_ERROR", "Unable to load tasks right now.", 500);
  }
}

export async function POST(request: Request) {
  const authResult = await resolveMobileRequestAuth(request);
  if (!authResult.ok) {
    return mobileErrorResponse(authResult.code, authResult.message, authResult.status);
  }

  const body = await parseJsonRequestBody(request);
  const validationResult = validateCreateTaskInput(body);
  if (!validationResult.ok) {
    return NextResponse.json(validationResult.error as MobileApiErrorResponse, {
      status: validationResult.status,
    });
  }

  const creationResult = await createTasks(
    [
      {
        title: validationResult.data.title,
        project_id: validationResult.data.projectId,
        goal_id: validationResult.data.goalId,
        description: validationResult.data.description,
        status: validationResult.data.status,
        priority: validationResult.data.priority,
        due_date: validationResult.data.dueDate,
        estimate_minutes: validationResult.data.estimateMinutes,
      },
    ],
    { supabase: authResult.supabase },
  );

  if (creationResult.errorMessage) {
    return mobileErrorResponse("VALIDATION_ERROR", creationResult.errorMessage, 400);
  }

  const createdTaskId = creationResult.createdTaskIds?.[0];
  if (!createdTaskId) {
    return mobileErrorResponse("INTERNAL_ERROR", "Task was created but could not be loaded.", 500);
  }

  const createdTaskResult = await getTaskById(createdTaskId, {
    supabase: authResult.supabase,
  });
  if (createdTaskResult.errorMessage || !createdTaskResult.data) {
    return mobileErrorResponse("INTERNAL_ERROR", "Unable to load created task.", 500);
  }

  const task = mapTaskRecordToMobileTaskItem(createdTaskResult.data, 0);
  return NextResponse.json(
    {
      ok: true,
      task,
    } satisfies MobileTaskMutationResponse,
    { status: 201 },
  );
}
