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

// Default columns/statuses for client boards
const DEFAULT_CLIENT_STATUSES = [
  { name: 'Pending', color: 'orange' },
  { name: 'KYC', color: 'zinc' },
  { name: 'Pin Board', color: 'green' },
  { name: 'Daily', color: 'blue' },
  { name: 'Weekly', color: 'indigo' },
  { name: 'Monthly', color: 'cyan' },
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
          where: { name: client.name, folderId: folder.id }
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
        title: title || 'New Task',
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
      // Optionally emit the comment to clients
      io.emit('task_comment_created', comment);

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
      io.emit('task_comment_created', subtaskComment);
    }

    io.emit('task_created', newTask);
    io.emit('subtask_created', subtask);

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
        }
      });
      // io.emit('task_comment_created', comment);
    }

    // io.emit('subtask_created', subtask);
    return res.status(200).json({ success: true, subtask });
  } catch (error: any) {
    console.error('Failed to handle galaxy subtask:', error);
    return res.status(500).json({ error: error.message });
  }
};
