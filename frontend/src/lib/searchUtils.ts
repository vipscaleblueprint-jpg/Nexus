/**
 * Search and fuzzy matching utilities for Kanban tasks.
 */

export function getDiceSimilarity(a: string, b: string): number {
  const strA = a.toLowerCase().trim();
  const strB = b.toLowerCase().trim();
  if (strA === strB) return 1;
  if (strA.length < 2 || strB.length < 2) {
    return strA.includes(strB) || strB.includes(strA) ? 0.6 : 0;
  }
  const bigramsA = new Map<string, number>();
  for (let i = 0; i < strA.length - 1; i++) {
    const bg = strA.substring(i, i + 2);
    bigramsA.set(bg, (bigramsA.get(bg) || 0) + 1);
  }
  let intersection = 0;
  for (let i = 0; i < strB.length - 1; i++) {
    const bg = strB.substring(i, i + 2);
    const count = bigramsA.get(bg) || 0;
    if (count > 0) {
      bigramsA.set(bg, count - 1);
      intersection++;
    }
  }
  return (2 * intersection) / (strA.length - 1 + strB.length - 1);
}

export interface TaskMatchResult {
  task: any;
  subtaskId?: string;
  score: number;
}

/**
 * Searches a collection of tasks and ranks them by match relevance:
 * 1. Exact title match (score: 10000)
 * 2. Title starts with query (score: 8000+)
 * 3. Title contains query (score: 6000+)
 * 4. Word in title starts with query (score: 5000+)
 * 5. Subtask title match (score: 3500-4500)
 * 6. Assignee name match (score: 2400-3200)
 * 7. Fuzzy typo similarity (score: up to 2000)
 */
export function findMatchingTasksSorted(query: string, tasks: any[]): TaskMatchResult[] {
  const q = query.trim().toLowerCase();
  if (!q || !tasks || tasks.length === 0) return [];

  const results: TaskMatchResult[] = [];

  for (const task of tasks) {
    const title = (task.title || '').trim().toLowerCase();
    let score = 0;
    let matchingSubtaskId: string | undefined;

    // 1. Exact match on title
    if (title === q) {
      score = 10000;
    }
    // 2. Title starts with query
    else if (title.startsWith(q)) {
      score = 8000 - Math.min(2000, (title.length - q.length) * 2);
    }
    // 3. Title contains query as substring
    else if (title.includes(q)) {
      const idx = title.indexOf(q);
      score = 6000 - idx * 10 - Math.min(1000, title.length - q.length);
    }
    // 4. Any word in the title starts with query
    else {
      const words = title.split(/[\s\-_\/:]+/);
      const matchingWordIdx = words.findIndex((w: string) => w.startsWith(q));
      if (matchingWordIdx !== -1) {
        score = 5000 - matchingWordIdx * 20;
      }
    }

    // 5. Check subtasks
    if (Array.isArray(task.subtasks) && task.subtasks.length > 0) {
      for (const sub of task.subtasks) {
        const subTitle = (sub.title || '').trim().toLowerCase();
        let subScore = 0;
        if (subTitle === q) subScore = 4500;
        else if (subTitle.startsWith(q)) subScore = 4000;
        else if (subTitle.includes(q)) subScore = 3500;

        if (subScore > score) {
          score = subScore;
          matchingSubtaskId = sub.id;
        }
      }
    }

    // 6. Check assignees
    if (score < 3000) {
      const assignees: string[] = [
        task.assignee?.name,
        ...(task.assignees || []).map((a: any) => a.name),
      ].filter(Boolean);
      for (const name of assignees) {
        const n = name.trim().toLowerCase();
        if (n === q) score = Math.max(score, 3200);
        else if (n.startsWith(q)) score = Math.max(score, 2800);
        else if (n.includes(q)) score = Math.max(score, 2400);
      }
    }

    // 7. Fuzzy similarity for typos
    if (score === 0) {
      const sim = getDiceSimilarity(title, q);
      if (sim >= 0.4) {
        score = Math.round(sim * 2000);
      } else {
        const words = title.split(/[\s\-_\/:]+/);
        for (const w of words) {
          const wSim = getDiceSimilarity(w, q);
          if (wSim >= 0.6) {
            score = Math.max(score, Math.round(wSim * 1800));
          }
        }
      }
    }

    if (score > 0) {
      results.push({ task, subtaskId: matchingSubtaskId, score });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}
