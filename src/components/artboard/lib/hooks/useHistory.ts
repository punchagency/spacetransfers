import { useCallback, useEffect, useRef, useState } from "react";
import type { ArtboardItem } from "../../types";

const MAX_HISTORY = 50;
const COALESCE_MS = 600;

// Snapshot-based undo/redo for the items array.
// `commit(tag?)` captures the current items into the past stack before a user action
// runs. Pass a `tag` for continuous actions (typing, dragging) — consecutive commits
// with the same tag inside a short window are coalesced into one history entry, so
// "type 5 chars" or "drag for 200 frames" becomes a single undo step.
export const useHistory = (
  items: ArtboardItem[],
  setItems: React.Dispatch<React.SetStateAction<ArtboardItem[]>>
) => {
  const [past, setPast] = useState<ArtboardItem[][]>([]);
  const [future, setFuture] = useState<ArtboardItem[][]>([]);

  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const lastCommitRef = useRef<{ tag?: string; time: number }>({ time: 0 });

  const commit = useCallback((tag?: string) => {
    const now = Date.now();
    const last = lastCommitRef.current;
    // Coalesce consecutive same-tag commits inside the window (extends the window)
    if (tag !== undefined && last.tag === tag && now - last.time < COALESCE_MS) {
      last.time = now;
      return;
    }
    const snapshot = itemsRef.current;
    setPast((prev) => {
      const next = [...prev, snapshot];
      return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next;
    });
    setFuture([]);
    lastCommitRef.current = { tag, time: now };
  }, []);

  const undo = useCallback(() => {
    setPast((prevPast) => {
      if (prevPast.length === 0) return prevPast;
      const previous = prevPast[prevPast.length - 1];
      setFuture((f) => [itemsRef.current, ...f]);
      setItems(previous);
      lastCommitRef.current = { time: 0 };
      return prevPast.slice(0, -1);
    });
  }, [setItems]);

  const redo = useCallback(() => {
    setFuture((prevFuture) => {
      if (prevFuture.length === 0) return prevFuture;
      const next = prevFuture[0];
      setPast((p) => [...p, itemsRef.current]);
      setItems(next);
      lastCommitRef.current = { time: 0 };
      return prevFuture.slice(1);
    });
  }, [setItems]);

  const reset = useCallback(() => {
    setPast([]);
    setFuture([]);
    lastCommitRef.current = { time: 0 };
  }, []);

  return {
    commit,
    undo,
    redo,
    reset,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  };
};

export type CommitHistory = (tag?: string) => void;
