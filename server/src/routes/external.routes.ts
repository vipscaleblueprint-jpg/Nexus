import { Router } from 'express';
// @ts-ignore - IDE cache issue
import { 
  getTasks, 
  getTask,
  createTask,
  updateTask,
  postActivity, 
  postComment, 
  updateComment,
  deleteComment,
  createSubtask,
  updateSubtask,
  getAssignableGroups,
  getRoles,
  createRole,
  updateRole,
  deleteRole,
  getExternalUsers,
  deleteExternalUser,
  updateExternalUserRoles,
  getExternalInvitations,
  createExternalInvitation,
  revokeExternalInvitation,
  resendExternalInvitation,
  getExternalTeams,
  createExternalTeam,
  createExternalTeamRole
} from '../controllers/external.controller';

const router = Router();

// Users Management
router.get('/users', getExternalUsers);
router.delete('/users/:id', deleteExternalUser);
router.patch('/users/:id/roles', updateExternalUserRoles);

// Invitations Management
router.get('/invitations', getExternalInvitations);
router.post('/invitations', createExternalInvitation);
router.delete('/invitations/:id', revokeExternalInvitation);
router.post('/invitations/:id/resend', resendExternalInvitation);

// Assignable Groups (Users, Roles, Teams)
router.get('/assignable-groups', getAssignableGroups);

// Task Core Operations
router.get('/tasks', getTasks);
router.post('/tasks', createTask);
router.get('/tasks/:taskId', getTask);
router.patch('/tasks/:taskId', updateTask);

// Task Activity & Comments
router.post('/activity', postActivity);
router.post('/comment', postComment);
router.put('/comment', updateComment);
router.delete('/comment/:commentId', deleteComment);

// Task Subtasks
router.post('/tasks/:taskId/subtasks', createSubtask);
router.patch('/tasks/:taskId/subtasks/:subtaskId', updateSubtask);

// Roles Management
router.get('/roles', getRoles);
router.post('/roles', createRole);
router.patch('/roles/:id', updateRole);
router.delete('/roles/:id', deleteRole);

// Teams Management
router.get('/teams', getExternalTeams);
router.post('/teams', createExternalTeam);
router.post('/teams/:teamId/roles', createExternalTeamRole);

export default router;
