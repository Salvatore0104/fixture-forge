import { useCallback, useRef, useState } from 'react';

const MAX_HISTORY = 20;

interface HistoryEntry<T> {
  snapshot: T;
  description: string;
  timestamp: number;
}

/**
 * Generic undo/redo stack for any serializable state.
 *
 * Usage:
 *   const { push, undo, redo, canUndo, canRedo, lastDescription } = useUndo<MyState>();
 *
 * Call `push(snapshot, "moved 3 fixtures")` BEFORE applying the change.
 * Call `undo()` / `redo()` to get the stored snapshot — you must apply it yourself.
 */
export function useUndo<T>() {
  const stack = useRef<HistoryEntry<T>[]>([]);
  const pointer = useRef(-1); // index of current snapshot, -1 = no history
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [lastDescription, setLastDescription] = useState('');

  const push = useCallback((snapshot: T, description: string) => {
    // Discard any future entries if we are mid-stack
    const s = stack.current;
    if (pointer.current < s.length - 1) {
      s.length = pointer.current + 1;
    }
    // Add new entry
    s.push({
      snapshot: structuredClone(snapshot) as T,
      description,
      timestamp: Date.now(),
    });
    // Trim to max
    if (s.length > MAX_HISTORY) {
      s.shift();
    } else {
      pointer.current++;
    }
    setCanUndo(pointer.current > 0);
    setCanRedo(false);
    setLastDescription(description);
  }, []);

  const undo = useCallback((): T | null => {
    const s = stack.current;
    if (pointer.current <= 0) return null;
    pointer.current--;
    const entry = s[pointer.current];
    setCanUndo(pointer.current > 0);
    setCanRedo(true);
    setLastDescription(entry.description);
    return structuredClone(entry.snapshot) as T;
  }, []);

  const redo = useCallback((): T | null => {
    const s = stack.current;
    if (pointer.current >= s.length - 1) return null;
    pointer.current++;
    const entry = s[pointer.current];
    setCanUndo(true);
    setCanRedo(pointer.current < s.length - 1);
    setLastDescription(entry.description);
    return structuredClone(entry.snapshot) as T;
  }, []);

  const clear = useCallback(() => {
    stack.current = [];
    pointer.current = -1;
    setCanUndo(false);
    setCanRedo(false);
    setLastDescription('');
  }, []);

  return { push, undo, redo, clear, canUndo, canRedo, lastDescription };
}
