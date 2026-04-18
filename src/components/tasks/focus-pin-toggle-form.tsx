import { Button } from "@/components/ui/button";

type FocusPinToggleFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  taskId: string;
  returnTo: string;
  isPinned: boolean;
  compact?: boolean;
};

export function FocusPinToggleForm({
  action,
  taskId,
  returnTo,
  isPinned,
  compact = false,
}: FocusPinToggleFormProps) {
  return (
    <form action={action} className="inline-flex">
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <Button
        type="submit"
        size="sm"
        variant={isPinned ? "muted" : "ghost"}
        className={compact ? "h-7 px-2 text-[10px] uppercase tracking-[0.14em]" : undefined}
      >
        {isPinned ? "Unpin" : "Pin"}
      </Button>
    </form>
  );
}
