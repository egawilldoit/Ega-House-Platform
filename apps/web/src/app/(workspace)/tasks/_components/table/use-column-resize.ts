"use client";

import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import {
  TASK_TABLE_COLUMN_MAX_WIDTH,
  TASK_TABLE_COLUMN_MIN_WIDTH,
} from "@ega/contracts/common/task-list";

type ResizePreview = { id: string; width: number } | null;
type ResizeState = { id: string; startX: number; startWidth: number; width: number };

const KEYBOARD_STEP = 16;
const KEYBOARD_LARGE_STEP = 64;

function clampWidth(width: number): number {
  return Math.min(
    TASK_TABLE_COLUMN_MAX_WIDTH,
    Math.max(TASK_TABLE_COLUMN_MIN_WIDTH, Math.round(width)),
  );
}

/**
 * Pointer and keyboard column resizing.
 *
 * Pointer moves update a local preview only; the committed width is published
 * once on pointer-up (or on keyboard key-up/blur), so a drag does not spam the
 * URL or the server. `clearPreview` is called by the table once the committed
 * props arrive.
 */
export function useColumnResize(onCommit: (id: string, width: number) => void) {
  const [preview, setPreview] = useState<ResizePreview>(null);
  const [resizingId, setResizingId] = useState<string | null>(null);
  const pointerRef = useRef<ResizeState | null>(null);
  const keyboardRef = useRef<ResizeState | null>(null);

  const beginPointer = useCallback(
    (id: string, startWidth: number, event: PointerEvent<HTMLElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      pointerRef.current = { id, startX: event.clientX, startWidth, width: startWidth };
      setResizingId(id);
      setPreview({ id, width: startWidth });
    },
    [],
  );

  const movePointer = useCallback((event: PointerEvent<HTMLElement>) => {
    const state = pointerRef.current;
    if (!state) return;
    const width = clampWidth(state.startWidth + (event.clientX - state.startX));
    state.width = width;
    setPreview({ id: state.id, width });
  }, []);

  const endPointer = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const state = pointerRef.current;
      if (!state) return;
      pointerRef.current = null;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      onCommit(state.id, state.width);
      setResizingId(null);
    },
    [onCommit],
  );

  const cancelPointer = useCallback(() => {
    pointerRef.current = null;
    setResizingId(null);
    setPreview(null);
  }, []);

  const handleKeyboard = useCallback(
    (event: KeyboardEvent<HTMLElement>, id: string, currentWidth: number) => {
      const key = event.key;
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(key)) return false;
      event.preventDefault();

      const state =
        keyboardRef.current?.id === id
          ? keyboardRef.current
          : { id, startX: 0, startWidth: currentWidth, width: currentWidth };

      if (key === "Home") state.width = TASK_TABLE_COLUMN_MIN_WIDTH;
      else if (key === "End") state.width = TASK_TABLE_COLUMN_MAX_WIDTH;
      else {
        const step = event.shiftKey ? KEYBOARD_LARGE_STEP : KEYBOARD_STEP;
        state.width = clampWidth(state.width + (key === "ArrowRight" ? step : -step));
      }

      keyboardRef.current = state;
      setResizingId(id);
      setPreview({ id, width: state.width });
      return true;
    },
    [],
  );

  const commitKeyboard = useCallback(() => {
    const state = keyboardRef.current;
    if (!state) return;
    keyboardRef.current = null;
    onCommit(state.id, state.width);
    setResizingId(null);
  }, [onCommit]);

  const clearPreview = useCallback(() => {
    setPreview(null);
    setResizingId(null);
  }, []);

  return {
    preview,
    resizingId,
    beginPointer,
    movePointer,
    endPointer,
    cancelPointer,
    handleKeyboard,
    commitKeyboard,
    clearPreview,
  };
}
