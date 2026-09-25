"use client";

type BulkArchiveCompletedTasksFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  taskIds: string[];
  returnTo: string;
};

export function BulkArchiveCompletedTasksForm({
  action,
  taskIds,
  returnTo,
}: BulkArchiveCompletedTasksFormProps) {
  if (taskIds.length === 0) {
    return null;
  }

  return (
    <form
      action={action}
      onSubmit={(event) => {
        const confirmed = window.confirm(
          `Archive ${taskIds.length} completed task${taskIds.length === 1 ? "" : "s"}? These tasks will move to Archived and can be restored later.`,
        );

        if (!confirmed) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="returnTo" value={returnTo} />
      <input type="hidden" name="confirmArchiveCompleted" value="true" />
      {taskIds.map((taskId) => (
        <input key={taskId} type="hidden" name="taskIds" value={taskId} />
      ))}
      <button
        type="submit"
        className="btn-instrument btn-instrument-muted h-8 gap-1.5 px-3 text-sm"
        data-testid="tasks-archive-completed"
      >
        Archive completed ({taskIds.length})
      </button>
    </form>
  );
}
