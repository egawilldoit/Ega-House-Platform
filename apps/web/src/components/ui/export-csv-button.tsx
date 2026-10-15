"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";

export type ExportCsvButtonProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "onClick"
> & {
  href: string;
  label?: string;
  children?: React.ReactNode;
  pendingLabel?: string;
  successMessage?: string;
  defaultFilename?: string;
  className?: string;
};

function parseFilenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;

  const filenameStarMatch = header.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (filenameStarMatch?.[1]) {
    try {
      return decodeURIComponent(filenameStarMatch[1].trim().replace(/^["']|["']$/g, ""));
    } catch {
      return filenameStarMatch[1].trim().replace(/^["']|["']$/g, "");
    }
  }

  const filenameMatch = header.match(/filename\s*=\s*"?([^";\n]+)"?/i);
  return filenameMatch?.[1]?.trim() ?? null;
}

export function ExportCsvButton({
  href,
  label,
  children,
  pendingLabel = "Preparing export…",
  successMessage,
  defaultFilename,
  className,
  disabled,
  ...props
}: ExportCsvButtonProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const anchorRef = useRef<HTMLAnchorElement | null>(null);

  async function handleExport() {
    if (isExporting) return;

    setIsExporting(true);
    setStatus("idle");
    setMessage("");

    try {
      const response = await fetch(href, { credentials: "same-origin" });

      if (!response.ok) {
        let errorMessage = "Export failed. Please try again.";
        try {
          const body = (await response.json()) as { error?: string };
          if (body?.error) errorMessage = body.error;
        } catch {
          // Response may not be JSON.
        }
        throw new Error(errorMessage);
      }

      const filename =
        parseFilenameFromContentDisposition(response.headers.get("content-disposition")) ??
        defaultFilename ??
        "export.csv";

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);

      setIsExporting(false);
      setStatus("success");
      setMessage(successMessage ? `${successMessage} ${filename}`.trim() : `Downloaded ${filename}`);
    } catch (error) {
      setIsExporting(false);
      setStatus("error");
      setMessage(
        error instanceof Error && error.message
          ? error.message
          : "Export failed. Please try again.",
      );
    }
  }

  return (
    <>
      <Button
        {...props}
        className={className}
        type="button"
        disabled={disabled || isExporting}
        aria-busy={isExporting}
        onClick={handleExport}
      >
        {isExporting ? pendingLabel : children ?? label ?? "Export CSV"}
      </Button>
      {status === "success" ? (
        <span
          role="status"
          data-testid="export-csv-status"
          className="ml-2 text-sm text-[color:var(--ega-text-secondary)]"
        >
          {message}
        </span>
      ) : null}
      {status === "error" ? (
        <span
          role="alert"
          data-testid="export-csv-status"
          className="ml-2 text-sm text-[color:var(--status-overdue)]"
        >
          {message}
        </span>
      ) : null}
      <span ref={anchorRef} hidden />
    </>
  );
}