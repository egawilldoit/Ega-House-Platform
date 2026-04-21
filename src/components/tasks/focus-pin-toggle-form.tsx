import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type FocusPinToggleFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  taskId: string;
  returnTo: string;
  isPinned: boolean;
  compact?: boolean;
  className?: string;
  fullWidth?: boolean;
};

export function FocusPinToggleForm({
  action,
  taskId,
  returnTo,
  isPinned,
  compact = false,
  className,
  fullWidth = false,
}: FocusPinToggleFormProps) {
  return (
    <form action={action} className={className ?? "inline-flex"}>
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <Button
        type="submit"
        size="sm"
        variant={isPinned ? "muted" : "ghost"}
        className={cn(
          compact ? "h-7 px-2 text-[10px] uppercase tracking-[0.14em]" : undefined,
          fullWidth ? "w-full justify-center" : undefined,
        )}
      >
        {isPinned ? "Unpin" : "Pin"}
      </Button>
    </form>
  );
}
