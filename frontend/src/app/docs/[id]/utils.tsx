import type { DocBlock } from './page';

// Convert Markdown text content into flat block list
export function markdownToBlocks(md: string): DocBlock[] {
  if (!md || !md.trim()) {
    return [{ id: `blk-1`, type: 'text', content: '' }];
  }

  // Gracefully support legacy JSON strings
  if (md.trim().startsWith('[') || md.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(md);
      if (Array.isArray(parsed) && parsed.length > 0) {
        if ('type' in parsed[0] || 'content' in parsed[0]) return parsed;
        const converted: DocBlock[] = [];
        parsed.forEach((sec: any) => {
          if (sec.title) converted.push({ id: `h-${Math.random()}`, type: 'heading', content: sec.title.replace(/\[(CLOSED|WAITING|DAILY|IN_PROGRESS)\]/g, '').trim() });
          if (Array.isArray(sec.items)) {
            sec.items.forEach((item: any) => {
              converted.push({
                id: `t-${Math.random()}`,
                type: 'task',
                content: (item.title || '').replace(/\[(CLOSED|WAITING|DAILY|IN_PROGRESS)\]/g, '').trim(),
                status: item.status === 'CLOSED' ? 'CLOSED' : 'DAILY',
              });
            });
          }
        });
        return converted.length > 0 ? converted : [{ id: `blk-1`, type: 'text', content: '' }];
      }
    } catch {}
  }

  const lines = md.split('\n');
  const blocks: DocBlock[] = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    const id = `blk-${index}-${Math.random().toString(36).substr(2, 4)}`;

    if (trimmed.startsWith('# ')) {
      let text = trimmed.replace(/^#+\s*/, '').replace(/\[(CLOSED|WAITING|DAILY|IN_PROGRESS)\]/g, '').trim();
      blocks.push({ id, type: 'heading', content: text });
    } else if (trimmed.startsWith('- [ ]') || trimmed.startsWith('- [x]')) {
      const isChecked = trimmed.startsWith('- [x]');
      let text = trimmed.replace(/^- \[(?:x| )\]\s*/, '').replace(/\[(CLOSED|WAITING|DAILY|IN_PROGRESS)\]/g, '').trim();

      blocks.push({
        id,
        type: 'task',
        content: text,
        status: isChecked ? 'CLOSED' : 'DAILY',
      });
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      let text = trimmed.replace(/^[-*]\s*/, '').replace(/\[(CLOSED|WAITING|DAILY|IN_PROGRESS)\]/g, '').trim();
      blocks.push({ id, type: 'text', content: text });
    } else {
      let text = trimmed.replace(/\[(CLOSED|WAITING|DAILY|IN_PROGRESS)\]/g, '').trim();
      blocks.push({ id, type: 'text', content: text });
    }
  });

  return blocks.length > 0 ? blocks : [{ id: `blk-1`, type: 'text', content: '' }];
}

export function blocksToMarkdown(blocks: DocBlock[]): string {
  // We now serialize to JSON to support block metadata like lockedBy, type='callout', etc.
  return JSON.stringify(blocks);
}

export function FormattedRichText() {
  return null;
}
