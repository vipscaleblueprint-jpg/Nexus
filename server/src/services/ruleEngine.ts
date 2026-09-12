import { prisma } from '../config/prisma';

export interface ValidationResult {
  allowed: boolean;
  reason?: string;
}

export async function validateTaskStatusTransition(
  taskId: string,
  targetStatus: string,
  userRoles: string[]
): Promise<ValidationResult> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      subtasks: true,
      checklists: {
        include: { items: true },
      },
    },
  });

  if (!task) {
    return { allowed: false, reason: 'Task not found' };
  }

  // Check subtasks completion if moving to DONE
  if (targetStatus === 'DONE') {
    const hasUnfinishedSubtask = task.subtasks.some((st: any) => !st.completed);
    if (hasUnfinishedSubtask) {
      return {
        allowed: false,
        reason: 'Cannot transition status: All subtasks must be completed first.',
      };
    }

    const allItems = task.checklists.flatMap((c: any) => c.items);
    const hasUncheckedItem = allItems.some((item: any) => !item.completed);
    if (hasUncheckedItem) {
      return {
        allowed: false,
        reason: 'Cannot transition status: All checklist items must be checked first.',
      };
    }
  }

  return { allowed: true };
}
