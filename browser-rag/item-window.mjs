const ITEM_WINDOW_SIZE = 100;

// A presentation range only: extraction records and their identities stay intact.
export function getItemWindow(total, requestedWindow = 0) {
  if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(requestedWindow)) {
    throw new TypeError('Item totals must be nonnegative safe integers; window requests must be safe integers.');
  }
  const windowCount = Math.ceil(total / ITEM_WINDOW_SIZE);
  const windowIndex = Math.min(Math.max(requestedWindow, 0), Math.max(windowCount - 1, 0));
  const start = windowIndex * ITEM_WINDOW_SIZE;
  const end = start + Math.min(ITEM_WINDOW_SIZE, total - start);
  return Object.freeze({start, end, total, windowIndex, windowCount,
    hasPrevious: windowIndex > 0, hasNext: windowIndex + 1 < windowCount});
}
