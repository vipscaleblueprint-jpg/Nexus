const fs = require('fs');
const path = 'c:/Codes/Nexus/server/src/controllers/task.controller.ts';
let content = fs.readFileSync(path, 'utf8');

const newMethods = `
// -----------------------------------------------------------------------------
// CHECKLISTS
// -----------------------------------------------------------------------------

export async function createChecklist(req: Request, res: Response) {
  try {
    const taskId = req.params.id;
    const { name, subtaskId } = req.body;

    const checklist = await prisma.checklist.create({
      data: {
        name: name || 'New Checklist',
        taskId,
        subtaskId: subtaskId || null,
      },
      include: { items: true },
    });

    return res.json({ checklist });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function updateChecklist(req: Request, res: Response) {
  try {
    const { checklistId } = req.params;
    const { name } = req.body;

    const checklist = await prisma.checklist.update({
      where: { id: checklistId },
      data: { name },
      include: { items: true },
    });

    return res.json({ checklist });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function deleteChecklist(req: Request, res: Response) {
  try {
    const { checklistId } = req.params;
    await prisma.checklist.delete({
      where: { id: checklistId },
    });
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function createChecklistItem(req: Request, res: Response) {
  try {
    const { checklistId } = req.params;
    const { text } = req.body;

    const item = await prisma.checklistItem.create({
      data: {
        text: text || '',
        checklistId,
      },
    });

    return res.json({ item });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function updateChecklistItem(req: Request, res: Response) {
  try {
    const { itemId } = req.params;
    const { text, completed, assigneeId } = req.body;
    
    // We get user making request for checkedBy mapping 
    const userId = (req as any).user?.userId;

    const data: any = {};
    if (text !== undefined) data.text = text;
    if (completed !== undefined) {
      data.completed = completed;
      if (completed && userId) {
        data.checkedById = userId;
      } else if (!completed) {
        data.checkedById = null;
      }
    }
    if (assigneeId !== undefined) {
      data.assigneeId = assigneeId === '' ? null : assigneeId;
    }

    const item = await prisma.checklistItem.update({
      where: { id: itemId },
      data,
    });

    return res.json({ item });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function deleteChecklistItem(req: Request, res: Response) {
  try {
    const { itemId } = req.params;
    await prisma.checklistItem.delete({
      where: { id: itemId },
    });
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
`;

if (!content.includes('export async function createChecklist')) {
  fs.writeFileSync(path, content + '\\n' + newMethods, 'utf8');
  console.log('Added checklist methods');
} else {
  console.log('Methods already exist');
}
