import { EditorView } from '@tiptap/pm/view';
import { TextSelection } from '@tiptap/pm/state';
import { Slice, Fragment, Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';
import { parseNexusTaskLink, NexusTaskLinkInfo } from '@/lib/links';
import { useAppStore } from '@/lib/store';
import { getStatusColor } from '@/components/editor/nodes/TaskMentionNode';

export function getTaskSnapshot(taskId: string) {
  const store = useAppStore.getState();
  const globalTask = store.tasksIndex?.[taskId];
  if (globalTask) {
    return {
      title: globalTask.title || (globalTask as any).name || 'Task',
      status: globalTask.status
        ? JSON.stringify({ name: globalTask.status, color: getStatusColor(globalTask.status) })
        : null,
      assignees: globalTask.assignees ? JSON.stringify(globalTask.assignees) : null,
      priority: globalTask.priority || null,
      dueDate: globalTask.dueDate || '',
      listName: globalTask.list?.name || '',
      taskData: globalTask,
    };
  }
  return {
    title: 'Loading task...',
    status: null,
    assignees: null,
    priority: null,
    dueDate: '',
    listName: '',
    taskData: null,
  };
}

/**
 * Inserts a TaskMention node into a ProseMirror view at the current selection.
 */
export function insertNexusTaskMention(view: EditorView, nexusLink: NexusTaskLinkInfo): boolean {
  const { state, dispatch } = view;
  const mentionType = state.schema.nodes.mention;
  if (!mentionType) return false;

  const snapshot = getTaskSnapshot(nexusLink.taskId);

  const mentionNode = mentionType.create({
    id: nexusLink.taskId,
    label: snapshot.title,
    mentionType: nexusLink.isSubtask ? 'subtask' : 'task',
    taskStatus: snapshot.status,
    taskAssignees: snapshot.assignees,
    taskPriority: snapshot.priority,
    taskDueDate: snapshot.dueDate,
    taskListName: snapshot.listName,
    frozenTaskData: snapshot.taskData ? JSON.stringify(snapshot.taskData) : null,
  });

  const tr = state.tr.replaceSelectionWith(mentionNode);
  const afterPos = tr.selection.to;
  const spaceNode = state.schema.text(' ');
  tr.insert(afterPos, spaceNode);
  tr.setSelection(TextSelection.create(tr.doc, afterPos + spaceNode.nodeSize));
  dispatch(tr.scrollIntoView());
  return true;
}

/**
 * Converts any Nexus task links found inside pasted HTML (both <a> links and bare text URLs)
 * into <span data-type="mention"> tags that TipTap parses into TaskMention nodes.
 */
export function transformNexusLinksInHtml(html: string): string {
  if (!html) return html;

  // 1. Convert <a href="...nexus...task=...">...</a>
  let transformed = html.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi, (match, href, innerText) => {
    const nexus = parseNexusTaskLink(href);
    if (!nexus) return match;
    const snapshot = getTaskSnapshot(nexus.taskId);
    const label = snapshot.title && snapshot.title !== 'Loading task...' ? snapshot.title : innerText || 'Task';
    return `<span data-type="mention" class="task-mention" data-id="${nexus.taskId}" data-label="${label.replace(
      /"/g,
      '&quot;'
    )}" data-mention-type="${nexus.isSubtask ? 'subtask' : 'task'}" data-task-status="${(
      snapshot.status || ''
    ).replace(/"/g, '&quot;')}" data-task-assignees="${(snapshot.assignees || '').replace(
      /"/g,
      '&quot;'
    )}" data-task-priority="${(snapshot.priority || '').replace(/"/g, '&quot;')}" data-task-due-date="${(
      snapshot.dueDate || ''
    ).replace(/"/g, '&quot;')}" data-task-list-name="${(snapshot.listName || '').replace(
      /"/g,
      '&quot;'
    )}">${label}</span>`;
  });

  // 2. Also convert bare Nexus URLs in text nodes (not inside tags)
  const BARE_NEXUS_RE =
    /https?:\/\/(?:nexus\.vipscaleph\.com|[a-zA-Z0-9.-]+(?::\d+)?)\/(?:lists\/[a-zA-Z0-9_-]+\?task=[a-zA-Z0-9_-]+|tasks\/[a-zA-Z0-9_-]+)[^\s<>"']*/gi;
  transformed = transformed.replace(BARE_NEXUS_RE, (url) => {
    const nexus = parseNexusTaskLink(url);
    if (!nexus) return url;
    const snapshot = getTaskSnapshot(nexus.taskId);
    const label = snapshot.title || 'Task';
    return `<span data-type="mention" class="task-mention" data-id="${nexus.taskId}" data-label="${label.replace(
      /"/g,
      '&quot;'
    )}" data-mention-type="${nexus.isSubtask ? 'subtask' : 'task'}" data-task-status="${(
      snapshot.status || ''
    ).replace(/"/g, '&quot;')}" data-task-assignees="${(snapshot.assignees || '').replace(
      /"/g,
      '&quot;'
    )}" data-task-priority="${(snapshot.priority || '').replace(/"/g, '&quot;')}" data-task-due-date="${(
      snapshot.dueDate || ''
    ).replace(/"/g, '&quot;')}" data-task-list-name="${(snapshot.listName || '').replace(
      /"/g,
      '&quot;'
    )}">${label}</span>`;
  });

  return transformed;
}

/**
 * Strips foreign formatting, colors, backgrounds, font styles (bold, italic, underline, strike),
 * and fonts from pasted HTML, while preserving paragraphs, line breaks, images, links, and Nexus task chips.
 */
export function cleanPastedHtml(html: string): string {
  if (typeof DOMParser === 'undefined' || !html) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // 1. Remove dangerous or non-web images (blob:, file:, etc.)
  doc.querySelectorAll('img').forEach((img) => {
    if (!/^(https?:|data:image\/)/i.test(img.getAttribute('src') || '')) {
      img.remove();
    }
  });

  // 2. Remove all <font> tags while unwrapping their children
  doc.querySelectorAll('font').forEach((font) => {
    font.replaceWith(...Array.from(font.childNodes));
  });

  // 3. Remove style, class, color, bgcolor from all elements (except mention spans)
  doc.querySelectorAll('*').forEach((el) => {
    if (el.tagName.toLowerCase() === 'span' && el.getAttribute('data-type') === 'mention') {
      return;
    }
    el.removeAttribute('style');
    el.removeAttribute('class');
    el.removeAttribute('color');
    el.removeAttribute('bgcolor');
  });

  // 4. Unwrap inline styling elements to strip external formatting (bold, italic, strike, underline)
  doc.querySelectorAll('b, strong, i, em, u, s, strike, del, mark, sub, sup').forEach((el) => {
    el.replaceWith(...Array.from(el.childNodes));
  });

  // 5. Unwrap any generic <span> that doesn't have data-type="mention"
  doc.querySelectorAll('span:not([data-type="mention"])').forEach((span) => {
    span.replaceWith(...Array.from(span.childNodes));
  });

  // 6. Clean empty paragraphs/divs (keep one blank line, drop consecutive empties)
  const isEmpty = (el: Element) => !el.textContent?.trim() && !el.querySelector('img, video');
  doc.body.querySelectorAll('p, div').forEach((el) => {
    if (!el.isConnected || !isEmpty(el)) return;
    const prev = el.previousElementSibling;
    if (!prev || (prev.matches('p, div, br') && isEmpty(prev))) {
      el.remove();
    }
  });

  const cleaned = doc.body.innerHTML.replace(/(<br\s*\/?>\s*){3,}/gi, '<br><br>');

  // 7. Transform Nexus task links into rich TaskMention chips
  return transformNexusLinksInHtml(cleaned);
}

/**
 * Recursively strips non-link marks (such as bold, italic, underline, strike, textStyle/color, highlight)
 * from text nodes inside a pasted ProseMirror Slice, guaranteeing clean theme styling on paste.
 */
export function stripMarksFromSlice(slice: Slice, schema: Schema): Slice {
  const cleanFragment = (fragment: Fragment): Fragment => {
    const newNodes: ProseMirrorNode[] = [];
    fragment.forEach((node) => {
      if (node.isText) {
        // Keep only 'link' marks; strip textStyle, color, italic, bold, underline, strike, highlight, etc.
        const cleanMarks = node.marks.filter((m) => m.type.name === 'link');
        newNodes.push(schema.text(node.text || '', cleanMarks));
      } else if (node.content && node.content.size > 0) {
        const cleanedChildren = cleanFragment(node.content);
        newNodes.push(node.copy(cleanedChildren));
      } else {
        newNodes.push(node);
      }
    });
    return Fragment.from(newNodes);
  };

  return new Slice(cleanFragment(slice.content), slice.openStart, slice.openEnd);
}
