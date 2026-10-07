import { Request, Response } from 'express';
import { PrismaClient, Priority } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { io } from '../server';
import { invalidateCache } from '../services/redisService';

const prisma = new PrismaClient();

// Galaxy-created tasks/subtasks are authored by this system account rather than
// whichever admin happens to be oldest, so the Activity feed reads "VIP Scale created this task".
async function getOrCreateVipScaleUser() {
  let vipScaleUser = await prisma.user.findFirst({
    where: { name: { equals: 'VIP Scale', mode: 'insensitive' } }
  });

  if (!vipScaleUser) {
    const password = await bcrypt.hash(Math.random().toString(36), 10);
    vipScaleUser = await prisma.user.create({
      data: {
        name: 'VIP Scale',
        email: 'vipscale@system.local',
        password,
        systemRole: 'ADMIN',
      }
    });
  }

  return vipScaleUser;
}

const requireApiKey = (req: Request, res: Response) => {
  const apiKey = req.headers['x-api-key'];
  const expected = process.env.VIPSCALE_API_KEY;
  if (!apiKey || apiKey !== expected) {
    // Never log the actual key values — just enough shape to tell apart
    // "not set", "wrong value", and "right value with stray whitespace"
    // without a live diff between the two deployments' dashboards.
    const receivedStr = Array.isArray(apiKey) ? apiKey[0] : apiKey;
    console.warn('[requireApiKey] rejected request', {
      path: req.originalUrl,
      hasExpected: !!expected,
      expectedLength: expected?.length ?? 0,
      hasReceived: !!receivedStr,
      receivedLength: receivedStr?.length ?? 0,
      trimmedMatch: !!expected && !!receivedStr && expected.trim() === receivedStr.trim(),
    });
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
};

const DEFAULT_CLIENT_STATUSES = [
  { name: 'KYC', color: '#3A8F55', groupName: 'Client Details' },
  { name: 'PIN BOARD', color: '#1F8A6E', groupName: 'Client Details' },
  { name: 'DAILY', color: '#2F7BD0', groupName: 'Recurring' },
  { name: 'WEEKLY', color: '#2F7BD0', groupName: 'Recurring' },
  { name: 'MONTHLY', color: '#2F7BD0', groupName: 'Recurring' },
  { name: 'PENDING', color: '#D29A2A', groupName: 'Workflow & Progress' },
  { name: 'IN PROGRESS', color: '#D04A7C', groupName: 'Workflow & Progress' },
  { name: 'REVISION', color: '#5B6BD6', groupName: 'Workflow & Progress' },
  { name: 'WAITING', color: '#D9534F', groupName: 'Management' },
  { name: 'IN REVIEW', color: '#D97B3A', groupName: 'Management' },
  { name: 'CHECKING', color: '#A35DB8', groupName: 'Management' },
  { name: 'CRM', color: '#22A3AE', groupName: 'Management' },
  { name: 'CLOSED', color: '#2FA37A', groupName: 'Workflow & Progress' },
  { name: 'ON-HOLD', color: '#8A8F98', groupName: 'Workflow & Progress' },
];

async function getClientDashboardFolder() {
  // Look for existing "Client Dashboard" Folder anywhere
  let folder = await prisma.folder.findFirst({
    where: {
      name: 'Client Dashboard'
    }
  });

  if (!folder) {
    // Create at the root level if it doesn't exist
    folder = await prisma.folder.create({
      data: {
        name: 'Client Dashboard',
        spaceId: null,
      }
    });
  }

  return folder;
}

export const syncClients = async (req: Request, res: Response) => {
  if (!requireApiKey(req, res)) return;

  try {
    const isDev = process.env.NODE_ENV === 'development';
    const toolsUrl = process.env.TOOLS_VIP_URL || (isDev ? 'http://localhost:3001' : 'https://tools.vipscaleph.com');
    const response = await fetch(`${toolsUrl}/api/clients`, {
      headers: {
        'x-api-key': process.env.VIPSCALE_API_KEY || ''
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch clients from tools.vip: ${response.statusText}`);
    }

    const data = await response.json();
    if (!data.success || !data.clients) {
      throw new Error('Invalid response format from tools.vip clients API');
    }

    const folder = await getClientDashboardFolder();

    const createdLists = [];

    for (const client of data.clients) {
      // Check if List exists for this client
      let list = await prisma.list.findUnique({
        where: { externalId: client.id }
      });

      if (!list) {
        // Fallback to check if it exists by name (for existing lists before externalId was added)
        list = await prisma.list.findFirst({
          where: { name: { equals: client.name.trim(), mode: 'insensitive' }, folderId: folder.id, externalId: null }
        });

        if (list) {
          // Update the existing list with the new externalId
          list = await prisma.list.update({
            where: { id: list.id },
            data: { externalId: client.id }
          });
        }
      }

      if (!list) {
        list = await prisma.list.create({
          data: {
            name: client.name,
            externalId: client.id,
            folderId: folder.id,
            spaceId: folder.spaceId,
            customGroups: ['Client Details', 'Recurring', 'Workflow & Progress', 'Management']
          }
        });

        // Seed default statuses
        for (const status of DEFAULT_CLIENT_STATUSES) {
          await prisma.listStatus.create({
            data: {
              name: status.name,
              color: status.color,
              groupName: status.groupName,
              listId: list.id,
            }
          });
        }

        createdLists.push(list.name);
      } else if (list.name !== client.name) {
        await prisma.list.update({
          where: { id: list.id },
          data: { name: client.name }
        });
      }
    }

    // Trigger full sidebar reload for active clients
    await invalidateCache('spaces:all', 'dashboard:all', 'lists:all');
    io.emit('spaces_updated');

    return res.status(200).json({
      success: true,
      message: 'Clients synced successfully',
      syncedCount: data.clients.length,
      newListsCreated: createdLists
    });
  } catch (error: any) {
    console.error('Failed to sync clients:', error);
    return res.status(500).json({ error: error.message });
  }
};

// VIPScale's assistant.employment_type has one more value ("regular") than Nexus's
// EmploymentType enum, so it needs an explicit mapping rather than a direct cast.
const EMPLOYMENT_TYPE_MAP: Record<string, 'FULL_TIME' | 'PART_TIME' | 'INTERN' | 'CONTRACTOR'> = {
  'full-time': 'FULL_TIME',
  'part-time': 'PART_TIME',
  'intern': 'INTERN',
  'regular': 'CONTRACTOR',
};

function toBigIntOrNull(value: unknown): bigint | null {
  if (value === null || value === undefined || value === '') return null;
  try {
    return BigInt(Math.trunc(Number(value)));
  } catch {
    return null;
  }
}

export const syncUsers = async (req: Request, res: Response) => {
  if (!requireApiKey(req, res)) return;

  try {
    const isDev = process.env.NODE_ENV === 'development';
    const toolsUrl = process.env.TOOLS_VIP_URL || (isDev ? 'http://localhost:3001' : 'https://tools.vipscaleph.com');
    const response = await fetch(`${toolsUrl}/api/assistants`, {
      headers: {
        'x-api-key': process.env.VIPSCALE_API_KEY || ''
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch assistants from tools.vip: ${response.statusText}`);
    }

    const data = await response.json();
    if (!data.success || !data.assistants) {
      throw new Error('Invalid response format from tools.vip assistants API');
    }

    const createdUsers: string[] = [];
    const updatedUsers: string[] = [];

    for (const assistant of data.assistants) {
      if (!assistant.email) continue;

      const fields = {
        name: assistant.name || assistant.email,
        dailySheetUrl: assistant.daily_schedule_sheet ?? null,
        starRating: assistant.star != null ? Math.round(Number(assistant.star)) : 1,
        employmentType: EMPLOYMENT_TYPE_MAP[assistant.employment_type] || 'FULL_TIME',
        isActive: assistant.is_active ?? true,
        roles: Array.isArray(assistant.roles) ? assistant.roles : [],
        credits: toBigIntOrNull(assistant.credits),
      };

      const existing = await prisma.user.findUnique({ where: { email: assistant.email } });

      if (existing) {
        await prisma.user.update({ where: { id: existing.id }, data: fields });
        updatedUsers.push(assistant.email);
      } else {
        const password = await bcrypt.hash(Math.random().toString(36), 10);
        await prisma.user.create({ data: { ...fields, email: assistant.email, password } });
        createdUsers.push(assistant.email);
      }
    }

    await invalidateCache('users:all');

    return res.status(200).json({
      success: true,
      message: 'Users synced successfully',
      syncedCount: data.assistants.length,
      newUsersCreated: createdUsers,
      updatedUsers
    });
  } catch (error: any) {
    console.error('Failed to sync users:', error);
    return res.status(500).json({ error: error.message });
  }
};

export const handleGalaxyTask = async (req: Request, res: Response) => {
  if (!requireApiKey(req, res)) return;

  try {
    const { clients, prompt, title, priority, assignee, auditor, task_link, listed_by } = req.body;

    const clientName = clients?.name;
    if (!clientName) {
      return res.status(400).json({ error: 'Client name is required in GalaxyTaskPayload.clients.name' });
    }

    const folder = await getClientDashboardFolder();

    // Look for the client's specific List
    let list = await prisma.list.findFirst({
      where: {
        name: { equals: clientName, mode: 'insensitive' },
        folderId: folder.id
      }
    });

    // If client list doesn't exist, create it on the fly
    if (!list) {
      list = await prisma.list.create({
        data: {
          name: clientName,
          folderId: folder.id,
          spaceId: folder.spaceId,
        }
      });
      // Seed default statuses
      for (const status of DEFAULT_CLIENT_STATUSES) {
        await prisma.listStatus.create({
          data: {
            name: status.name,
            color: status.color,
            listId: list.id,
          }
        });
      }
      io.emit('spaces_updated');
    }

    let mappedPriority: Priority = Priority.MEDIUM;
    if (priority) {
      const p = priority.toUpperCase();
      if (['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(p)) {
        mappedPriority = p as Priority;
      }
    }

    // Creator should be "VIP Scale"
    const creator = await getOrCreateVipScaleUser();

    // Resolve assignee: role assignments set assigneeRoleRestrictions; named users are individual
    let resolvedTeamId: string | null = null;
    const assigneeIdsSet = new Set<string>();
    const roleNamesSet = new Set<string>();
    if (assignee && Array.isArray(assignee)) {
      for (const a of assignee) {
        if (!a.name) continue;
        const aName = a.name;

        // 0. Role assignment — store as restriction AND map the individual users
        if (a.type === 'role' || (a.id && String(a.id).startsWith('role_'))) {
          roleNamesSet.add(aName.toUpperCase());
          if (a.userIds && Array.isArray(a.userIds)) {
            a.userIds.forEach((id: string) => assigneeIdsSet.add(id));
          }
          continue;
        }

        // 0.5. TeamRole assignment — store role name as restriction + team + users
        if (a.type === 'teamrole' || (a.id && String(a.id).startsWith('teamrole_'))) {
          roleNamesSet.add(aName); // Keep original casing for TeamRole names
          if (a.teamId && !resolvedTeamId) resolvedTeamId = a.teamId;
          if (a.userIds && Array.isArray(a.userIds)) {
            a.userIds.forEach((id: string) => assigneeIdsSet.add(id));
          }
          continue;
        }

        // 1. Check if the name matches a Team directly
        const matchedTeam = await prisma.team.findFirst({
          where: { name: { equals: aName, mode: 'insensitive' } }
        });

        if (matchedTeam) {
          resolvedTeamId = matchedTeam.id;
          continue;
        }

        // 1.5. Check if the name matches a TeamRole
        const matchedTeamRole = await (prisma as any).teamRole.findFirst({
          where: { name: { equals: aName, mode: 'insensitive' } }
        });

        if (matchedTeamRole && matchedTeamRole.teamId) {
          resolvedTeamId = matchedTeamRole.teamId;
          continue;
        }

        // 2. Check if this matches an individual user by name
        const usersByName = await prisma.user.findMany({
          where: { name: { contains: aName, mode: 'insensitive' } }
        });

        if (usersByName.length > 0) {
          usersByName.forEach(u => assigneeIdsSet.add(u.id));
        }
      }
    }

    const finalAssigneeIds = Array.from(assigneeIdsSet);
    const primaryAssigneeId = finalAssigneeIds.length > 0 ? finalAssigneeIds[0] : null;
    const roleRestrictions = Array.from(roleNamesSet);

    // Since this is a newly created task from Galaxy, we'll try 'PENDING', fallback to 'DAILY', or the first available status
    const firstStatus = await prisma.listStatus.findFirst({
      where: { listId: list.id, name: { equals: 'Pending', mode: 'insensitive' } }
    }) || await prisma.listStatus.findFirst({
      where: { listId: list.id, name: { equals: 'Daily', mode: 'insensitive' } }
    }) || await prisma.listStatus.findFirst({
      where: { listId: list.id }
    });

    const newTask = await prisma.task.create({
      data: {
        title: title ? (clientName ? `${title} - ${clientName}` : title) : (clientName ? `New Task - ${clientName}` : 'New Task'),
        description: prompt || '',
        listId: list.id,
        creatorId: creator.id,
        ...(resolvedTeamId && { teamId: resolvedTeamId }),
        // If a role was specified, set it as the role restriction (shows role badge in UI)
        // Otherwise fall back to individual user assignees
        ...(roleRestrictions.length > 0 ? { assigneeRoleRestrictions: roleRestrictions } : {}),
        ...(finalAssigneeIds.length > 0 ? {
          assigneeId: primaryAssigneeId,
          assignees: { connect: finalAssigneeIds.map(id => ({ id })) }
        } : {}),
        priority: priority ? priority.toUpperCase() : 'MEDIUM',
        status: firstStatus?.name || 'Pending',
        externalId: task_link || null
      }
    });

    // Auto-create subtask for the Audit Team
    // Determine the specific auditor role requested by the AI, fallback to 'AUDITOR'
    let auditorRoleName = 'AUDITOR';
    let auditorUserIds: string[] = [];
    if (auditor && Array.isArray(auditor) && auditor.length > 0) {
      const selectedAuditor = auditor[0];
      if (selectedAuditor.name) {
        auditorRoleName = selectedAuditor.name; // Keep original casing (especially for TeamRoles like "Funnel Auditor")
      }
      if (selectedAuditor.userIds && Array.isArray(selectedAuditor.userIds)) {
        auditorUserIds = selectedAuditor.userIds;
      }
    }

    const autoSubtaskTitle = `--Audit - ${auditorRoleName} - ${title || clientName}`;

    const subtask = await prisma.subtask.create({
      data: {
        title: autoSubtaskTitle,
        taskId: newTask.id,
        priority: priority ? priority.toUpperCase() : 'MEDIUM',
        // Store auditor role as restriction so the role badge shows in UI
        assigneeRoleRestrictions: [auditorRoleName],
        // Assign the actual users to the subtask
        ...(auditorUserIds.length > 0 ? {
          assigneeId: auditorUserIds[0],
          assignees: { connect: auditorUserIds.map(id => ({ id })) }
        } : {})
      }
    });

    if (listed_by) {
      const dateOptions: Intl.DateTimeFormatOptions = { month: 'numeric', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' };
      const timeOptions: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Manila' };
      const now = new Date();
      const dateStr = now.toLocaleDateString('en-US', dateOptions);
      const timeStr = now.toLocaleTimeString('en-US', timeOptions);
      const commentContent = `📋 Listed by: ${listed_by} | ${dateStr} | ${timeStr}`;

      const comment = await prisma.taskComment.create({
        data: {
          taskId: newTask.id,
          userId: creator.id,
          content: commentContent
        },
        include: { user: true }
      });
      io.emit('task:comment_added', { taskId: newTask.id, comment });

      // Create comment for the auto-created subtask as well
      const subtaskComment = await prisma.taskComment.create({
        data: {
          taskId: newTask.id,
          subtaskId: subtask.id,
          userId: creator.id,
          content: commentContent
        },
        include: { user: true }
      });
      io.emit('task:comment_added', { taskId: newTask.id, subtaskId: subtask.id, comment: subtaskComment });
    }

    const fullyLoadedTask = await prisma.task.findUnique({
      where: { id: newTask.id },
      include: {
        creator: { select: { id: true, name: true, avatarUrl: true } },
        assignees: { select: { id: true, name: true, avatarUrl: true } },
        assignee: { select: { id: true, name: true, avatarUrl: true } },
        subtasks: {
          include: {
            User: { select: { id: true, name: true, avatarUrl: true } },
            assignees: { select: { id: true, name: true, avatarUrl: true } }
          }
        }
      }
    });

    if (fullyLoadedTask) {
      io.emit('task:created', fullyLoadedTask);
    }

    try {
      const doc = await prisma.doc.findFirst({ where: { isDailyRollover: true } });
      if (doc) {
        const tz = (doc as any).rolloverTimezone || 'Asia/Singapore';
        const dayFormatter = new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          month: 'long',
          day: 'numeric',
          year: 'numeric'
        });
        const dayTitle = dayFormatter.format(new Date());

        const todayPage = await prisma.page.findFirst({
          where: { 
            docId: doc.id, 
            title: dayTitle 
          }
        });

        if (todayPage && todayPage.content) {
          let blocks = [];
          try {
            blocks = JSON.parse(todayPage.content);
          } catch(e) {}
          
          const escapedTitle = newTask.title.replace(/"/g, '&quot;');
          const statusColor = '#3b82f6';
          const taskStatusStr = JSON.stringify({ name: fullyLoadedTask?.status || newTask.status, color: statusColor }).replace(/"/g, '&quot;');
          const assigneesStr = JSON.stringify(fullyLoadedTask?.assignees || []).replace(/"/g, '&quot;');

          const getNewTaskBlock = (suffix: string) => ({
            id: `blk-tk-${Date.now()}-${newTask.id}-${suffix}`,
            type: "text",
            content: `<p><span data-type="mention" data-id="${newTask.id}" data-label="${escapedTitle}" data-mention-type="task" data-task-status="${taskStatusStr}" data-task-assignees="${assigneesStr}" data-task-list-name="${clientName}">@${escapedTitle}</span></p>`
          });

          // 1. Insert into Client section
          let clientHeaderIndex = blocks.findIndex((b: any) => {
            if (b.type !== 'text') return false;
            const stripped = b.content.replace(/<[^>]+>/g, '').trim();
            return b.content.match(/<h[1-6]/) && stripped.toLowerCase() === clientName.toLowerCase();
          });
          if (clientHeaderIndex === -1) {
            blocks.push({
              id: `blk-h-${Date.now()}-${clientName.replace(/\s+/g, '')}`,
              type: 'text',
              content: `<h2>${clientName}</h2>`
            });
            clientHeaderIndex = blocks.length - 1;
          }

          let insertClientIndex = clientHeaderIndex + 1;
          while (insertClientIndex < blocks.length) {
            const nextBlock = blocks[insertClientIndex];
            if (nextBlock.type === 'text' && (nextBlock.content.startsWith('<h2') || nextBlock.content.startsWith('<h3'))) {
              break;
            }
            insertClientIndex++;
          }

          while (insertClientIndex > clientHeaderIndex + 1) {
            const prevBlock = blocks[insertClientIndex - 1];
            if (prevBlock.type === 'text' && (prevBlock.content === '<p></p>' || prevBlock.content === '<p><br></p>' || prevBlock.content.trim() === '')) {
              insertClientIndex--;
            } else {
              break;
            }
          }

          blocks.splice(insertClientIndex, 0, getNewTaskBlock('c'));
          
          const newSubtaskBlock = {
            id: `blk-st-${Date.now()}-${subtask.id}-c`,
            type: "text",
            content: `<p>&nbsp;&nbsp;└─ <span data-type="mention" data-id="${subtask.id}" data-label="${subtask.title}" data-mention-type="subtask">@${subtask.title}</span></p>`
          };
          blocks.splice(insertClientIndex + 1, 0, newSubtaskBlock);

          if (insertClientIndex + 2 < blocks.length) {
            const nextBlock = blocks[insertClientIndex + 2];
            if (nextBlock.type === 'text' && (nextBlock.content.startsWith('<h2') || nextBlock.content.startsWith('<h3'))) {
              blocks.splice(insertClientIndex + 2, 0, { id: `blk-space-${Date.now()}-${clientName.replace(/\s+/g, '')}`, type: 'text', content: '<p></p>' });
            }
          } else if (insertClientIndex + 1 === blocks.length - 1) {
             blocks.push({ id: `blk-space-${Date.now()}-${clientName.replace(/\s+/g, '')}`, type: 'text', content: '<p></p>' });
          }

          // 2. Insert into New Tasks section
          let newTasksHeaderIndex = blocks.findIndex((b: any) => {
            if (b.type !== 'text') return false;
            const stripped = b.content.replace(/<[^>]+>/g, '').trim();
            return b.content.match(/<h[1-6]/) && stripped.toLowerCase() === 'new tasks';
          });
          if (newTasksHeaderIndex === -1) {
            blocks.push({
              id: `blk-h-${Date.now()}-NewTasks`,
              type: 'text',
              content: '<h3>New Tasks</h3>'
            });
            newTasksHeaderIndex = blocks.length - 1;
          }

          let insertNewTasksIndex = newTasksHeaderIndex + 1;
          while (insertNewTasksIndex < blocks.length) {
            const nextBlock = blocks[insertNewTasksIndex];
            if (nextBlock.type === 'text' && (nextBlock.content.startsWith('<h2') || nextBlock.content.startsWith('<h3'))) {
              break;
            }
            insertNewTasksIndex++;
          }

          blocks.splice(insertNewTasksIndex, 0, getNewTaskBlock('n'));
          
          const newSubtaskBlockN = {
            id: `blk-st-${Date.now()}-${subtask.id}-n`,
            type: "text",
            content: `<p>&nbsp;&nbsp;└─ <span data-type="mention" data-id="${subtask.id}" data-label="${subtask.title}" data-mention-type="subtask">@${subtask.title}</span></p>`
          };
          blocks.splice(insertNewTasksIndex + 1, 0, newSubtaskBlockN);

          await prisma.page.update({
            where: { id: todayPage.id },
            data: { content: JSON.stringify(blocks) }
          });

          io.to(`doc:${doc.id}`).emit('page_updated', { docId: doc.id, pageId: todayPage.id });
        }
      }
    } catch (error) {
      console.error('Failed to inject task into Priorities Journal:', error);
    }

    // Send ASSIGNMENT notifications so the task appears in each assignee's Activity feed
    const notifyUserIds = new Set<string>(finalAssigneeIds);

    // Also notify all members of the resolved team
    if (resolvedTeamId) {
      const teamMembers = await prisma.user.findMany({
        where: { teamId: resolvedTeamId },
        select: { id: true }
      });
      teamMembers.forEach(m => notifyUserIds.add(m.id));
    }

    const notifyList = Array.from(notifyUserIds).filter(id => id !== creator.id);
    if (notifyList.length > 0) {
      await prisma.taskNotification.createMany({
        data: notifyList.map(id => ({
          userId: id,
          actorId: creator.id,
          taskId: newTask.id,
          type: 'ASSIGNMENT' as const,
          title: `VIP Scale assigned this task to you`,
        })),
        skipDuplicates: true,
      });
      notifyList.forEach(id => {
        io.to(`user:${id}`).emit('notification_received');
      });
    }


    return res.status(200).json({ success: true, task: newTask });
  } catch (error: any) {
    console.error('Failed to handle galaxy task:', error);
    return res.status(500).json({ error: error.message });
  }
};

export const handleGalaxyStatus = async (req: Request, res: Response) => {
  if (!requireApiKey(req, res)) return;
  try {
    const { task_link, status, new_status } = req.body;

    if (!task_link || !new_status) {
      return res.status(400).json({ error: 'task_link and new_status required' });
    }

    const task = await prisma.task.findUnique({ where: { externalId: task_link } });
    if (!task) return res.status(404).json({ error: 'Task not found' });

    // Validate status exists for the list
    const listStatus = await prisma.listStatus.findFirst({
      where: { listId: task.listId, name: { equals: new_status, mode: 'insensitive' } }
    });

    const updatedTask = await prisma.task.update({
      where: { id: task.id },
      data: { status: listStatus ? listStatus.name : new_status }
    });

    if (task.status !== updatedTask.status) {
      getOrCreateVipScaleUser().then((creator: any) => {
        prisma.auditLog.create({
          data: {
            action: 'STATUS_CHANGE',
            entity: 'TASK',
            entityId: task.id,
            userId: creator.id,
            details: { oldStatus: task.status, newStatus: updatedTask.status }
          }
        }).catch(console.error);
      }).catch(console.error);
    }

    // We can emit to update clients
    // io.emit('task_updated', updatedTask);

    return res.status(200).json({ success: true, task: updatedTask });
  } catch (error: any) {
    console.error('Failed to handle galaxy status:', error);
    return res.status(500).json({ error: error.message });
  }
};

export const handleGalaxySubtask = async (req: Request, res: Response) => {
  if (!requireApiKey(req, res)) return;
  try {
    const { title, task_link, listed_by, priority, assignee } = req.body;

    if (!task_link) return res.status(400).json({ error: 'task_link required' });

    const parentTask = await prisma.task.findUnique({
      where: { externalId: task_link }
    });

    if (!parentTask) {
      return res.status(404).json({ error: 'Parent task not found in Nexus' });
    }

    // Resolve assignee: role assignments set assigneeRoleRestrictions; named users are individual
    let resolvedTeamId: string | null = null;
    const assigneeIdsSet = new Set<string>();
    const roleNamesSet = new Set<string>();
    if (assignee && Array.isArray(assignee)) {
      for (const a of assignee) {
        if (!a.name) continue;
        const aName = a.name;

        // 0. Role assignment — store as restriction AND map the individual users
        if (a.type === 'role' || (a.id && String(a.id).startsWith('role_'))) {
          roleNamesSet.add(aName.toUpperCase());
          if (a.userIds && Array.isArray(a.userIds)) {
            a.userIds.forEach((id: string) => assigneeIdsSet.add(id));
          }
          continue;
        }

        // 0.5. TeamRole assignment — store role name as restriction + team + users
        if (a.type === 'teamrole' || (a.id && String(a.id).startsWith('teamrole_'))) {
          roleNamesSet.add(aName); // Keep original casing for TeamRole names
          if (a.teamId && !resolvedTeamId) resolvedTeamId = a.teamId;
          if (a.userIds && Array.isArray(a.userIds)) {
            a.userIds.forEach((id: string) => assigneeIdsSet.add(id));
          }
          continue;
        }

        // 1. Check if the name matches a Team directly
        const matchedTeam = await prisma.team.findFirst({
          where: { name: { equals: aName, mode: 'insensitive' } }
        });
        if (matchedTeam) {
          resolvedTeamId = matchedTeam.id;
          continue;
        }

        // 1.5. Check if the name matches a TeamRole
        const matchedTeamRole = await (prisma as any).teamRole.findFirst({
          where: { name: { equals: aName, mode: 'insensitive' } }
        });

        if (matchedTeamRole && matchedTeamRole.teamId) {
          resolvedTeamId = matchedTeamRole.teamId;
          continue;
        }

        // 2. Check if this matches an individual user by name
        const usersByName = await prisma.user.findMany({
          where: { name: { contains: aName, mode: 'insensitive' } }
        });

        if (usersByName.length > 0) {
          usersByName.forEach(u => assigneeIdsSet.add(u.id));
        }
      }
    }

    const finalAssigneeIds = Array.from(assigneeIdsSet);
    const primaryAssigneeId = finalAssigneeIds.length > 0 ? finalAssigneeIds[0] : null;
    const roleRestrictions = Array.from(roleNamesSet);


    const subtask = await prisma.subtask.create({
      data: {
        title: title || 'New Subtask',
        taskId: parentTask.id,
        priority: priority ? priority.toUpperCase() : 'MEDIUM',
        // Role assignments show as role badge; individual users connect directly
        ...(roleRestrictions.length > 0 ? { assigneeRoleRestrictions: roleRestrictions } : {}),
        ...(finalAssigneeIds.length > 0 ? {
          assigneeId: primaryAssigneeId,
          assignees: { connect: finalAssigneeIds.map(id => ({ id })) }
        } : {}),
        ...(resolvedTeamId ? { teamId: resolvedTeamId } : {})
      }
    });

    if (listed_by) {
      const creator = await getOrCreateVipScaleUser();

      const dateOptions: Intl.DateTimeFormatOptions = { month: 'numeric', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' };
      const timeOptions: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Manila' };
      const now = new Date();
      const dateStr = now.toLocaleDateString('en-US', dateOptions);
      const timeStr = now.toLocaleTimeString('en-US', timeOptions);
      const commentContent = `📋 Listed by: ${listed_by} | ${dateStr} | ${timeStr}`;

      const comment = await prisma.taskComment.create({
        data: {
          taskId: parentTask.id,
          subtaskId: subtask.id,
          userId: creator.id,
          content: commentContent
        },
        include: { user: true }
      });
      io.emit('task:comment_added', { taskId: parentTask.id, subtaskId: subtask.id, comment });
    }

    try {
      const doc = await prisma.doc.findFirst({ where: { isDailyRollover: true } });
      if (doc) {
        const tz = (doc as any).rolloverTimezone || 'Asia/Singapore';
        const dayFormatter = new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          month: 'long',
          day: 'numeric',
          year: 'numeric'
        });
        const dayTitle = dayFormatter.format(new Date());

        const todayPage = await prisma.page.findFirst({
          where: { 
            docId: doc.id, 
            title: dayTitle 
          }
        });

        if (todayPage && todayPage.content) {
          const blocks = JSON.parse(todayPage.content);
          
          const parentTaskMention = `data-id="${parentTask.id}"`;
          const parentTaskIndex = blocks.findIndex((b: any) => b.type === 'text' && b.content.includes(parentTaskMention));

          if (parentTaskIndex !== -1) {
            const newSubtaskBlock = {
              id: `blk-st-${Date.now()}-${subtask.id}`,
              type: "text",
              content: `<p>&nbsp;&nbsp;└─ <span data-type="mention" data-id="${subtask.id}" data-label="${subtask.title}" data-mention-type="subtask">@${subtask.title}</span></p>`
            };

            let insertIndex = parentTaskIndex + 1;
            while (insertIndex < blocks.length) {
              const nextBlock = blocks[insertIndex];
              if (nextBlock.type === 'text' && nextBlock.content.includes('└─')) {
                insertIndex++;
              } else {
                break;
              }
            }
            
            blocks.splice(insertIndex, 0, newSubtaskBlock);

            await prisma.page.update({
              where: { id: todayPage.id },
              data: { content: JSON.stringify(blocks) }
            });

            io.to(`doc:${doc.id}`).emit('page_updated', { docId: doc.id, pageId: todayPage.id });
          }
        }
      }
    } catch (error) {
      console.error('Failed to inject subtask into Priorities Journal:', error);
    }

    io.emit('subtask_created', subtask);
    
    const updatedTask = await prisma.task.findUnique({
      where: { id: parentTask.id },
      select: { 
        id: true, listId: true, 
        subtasks: { 
          include: { 
            User: { select: { id: true, name: true, avatarUrl: true } }, 
            assignees: { select: { id: true, name: true, avatarUrl: true } } 
          } 
        } 
      }
    });
    if (updatedTask) io.emit('task:updated', updatedTask);
    
    return res.status(200).json({ success: true, subtask });
  } catch (error: any) {
    console.error('Failed to handle galaxy subtask:', error);
    return res.status(500).json({ error: error.message });
  }
};
