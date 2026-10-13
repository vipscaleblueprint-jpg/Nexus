/**
 * An editor saves its whole copy of the page, so blocks added to the stored page after it loaded (tasks the
 * server appends to the journal, blocks from other users) would be wiped by its next save. Keep every stored
 * block the save neither contains nor lists as deleted, after its nearest stored predecessor.
 */
export function keepUnseenBlocks(storedContent: string | undefined, incomingContent: string, deletedBlockIds: string[]) {
  let stored: any[];
  let incoming: any[];
  try {
    stored = JSON.parse(storedContent || '');
    incoming = JSON.parse(incomingContent);
  } catch {
    return incomingContent; // not block JSON (legacy markdown page)
  }
  if (!Array.isArray(stored) || !Array.isArray(incoming)) return incomingContent;

  const incomingIds = new Set(incoming.map((b) => b?.id));
  const deleted = new Set(deletedBlockIds);
  const isKept = (b: any) => b?.id && !incomingIds.has(b.id) && !deleted.has(b.id);
  if (!stored.some(isKept)) return incomingContent;

  const result = [...incoming];
  stored.forEach((block, i) => {
    if (!isKept(block)) return;
    let insertAt = 0;
    for (let j = i - 1; j >= 0; j--) {
      const idx = result.findIndex((b) => b?.id === stored[j]?.id);
      if (idx !== -1) {
        insertAt = idx + 1;
        break;
      }
    }
    result.splice(insertAt, 0, block);
  });
  return JSON.stringify(result);
}
