let itemCounter = 0;

/** Monotonic id for UI chat items. Shared so App and the session event loop
 *  draw from one counter (no id collisions across the two call sites). */
export function nextItemId(): string {
  itemCounter += 1;
  return `i-${itemCounter}`;
}
