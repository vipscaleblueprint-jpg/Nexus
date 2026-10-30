/**
 * Serialized domain models as they travel over the API (dates are ISO strings).
 * Shared verbatim between server and client - keep both copies in sync.
 */

import type {
  ChannelRole,
  ChannelType,
  EmploymentType,
  EntityType,
  InvitationStatus,
  NotificationType,
  Priority,
  SystemRole,
} from './enums';

export interface Invitation {
  id: string;
  email: string;
  role: SystemRole;
  employmentType: EmploymentType;
  token: string;
  status: InvitationStatus;
  invitedById: string;
  invitedBy?: {
    id: string;
    name: string;
    email: string;
  };
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export type SoundChoice = 'inherit' | 'ting' | 'chime' | 'pop' | 'bell' | 'glass' | 'custom' | 'mute';

export interface CategorySoundConfig {
  preset?: SoundChoice;
  soundUrl?: string | null;
}

export type SoundCategory = 'mention' | 'reaction' | 'comment' | 'status';

export interface UploadedSoundItem {
  id: string;
  name: string;
  url: string;
  createdAt?: string;
}

export interface UserNotificationPreferences {
  status?: boolean;
  checklists?: boolean;
  audits?: boolean;
  assigned?: boolean;
  comments?: boolean;
  mentions?: boolean;
  defaultView?: 'for_me' | 'show_all';
  confettiEnabled?: boolean;
  receiveConfetti?: boolean;
  soundEnabled?: boolean;
  soundPreset?: 'ting' | 'chime' | 'pop' | 'bell' | 'glass' | 'custom';
  soundVolume?: number;
  soundUrl?: string | null;
  uploadedSoundUrl?: string | null;
  uploadedSounds?: UploadedSoundItem[];
  typeSounds?: Partial<Record<SoundCategory, CategorySoundConfig>>;
}

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  imageUrl?: string;
  confettiUrl?: string | null;
  googleId?: string;
  dailySheetUrl?: string;
  starRating: number; // 1 - 3
  employmentType: EmploymentType;
  isActive: boolean;
  systemRole: SystemRole;
  roles: string[];
  teamId?: string;
  teamName?: string;
  notificationPreferences?: UserNotificationPreferences;
}

export interface TeamRole {
  id: string;
  name: string;
  teamId: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Team {
  id: string;
  name: string;
  description?: string;
  color?: string;
  members?: User[];
  teamRoles?: TeamRole[];
}

export interface Space {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  order?: number;
  folders?: Folder[];
  lists?: List[];
  docs?: Doc[];
}

export interface Folder {
  id: string;
  name: string;
  color?: string | null;
  spaceId?: string;
  parentFolderId?: string;
  order?: number;
  subfolders?: Folder[];
  lists?: List[];
  docs?: Doc[];
}

export interface List {
  id: string;
  name: string;
  spaceId?: string;
  folderId?: string;
  order?: number;
  columns?: any[];
  tasks?: Task[];
  createdAt?: string;
  updatedAt?: string;
}

export interface Doc {
  id: string;
  title: string;
  docDate?: string;
  spaceId?: string;
  folderId?: string;
  order?: number;
  pages?: Page[];
  isDailyRollover?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Page {
  id: string;
  title: string;
  content?: string;
  docId: string;
  parentPageId?: string;
  position?: number;
  subpages?: Page[];
  createdAt?: string;
  updatedAt?: string;
}

export interface Favorite {
  id: string;
  userId: string;
  entityType: EntityType;
  entityId: string;
  createdAt: string;
}

export interface RecurringConfig {
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  time: string; // "HH:mm" e.g. "21:00", "21:30"
  daysOfWeek?: number[]; // [1, 2, 3, 4, 5] for Mon-Fri
  dayOfMonth?: number; // 1 to 31
  lastRunAt?: string;
  timezone?: string;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: Priority;
  dueDate?: string | null;
  startDate?: string | null;
  recurringConfig?: RecurringConfig | null;
  listId: string;
  assigneeId?: string | null;
  assignee?: User | null;
  assignees?: User[];
  assigneeIds?: string[];
  assigneeRoleRestrictions?: string[];
  teamAssignAccessRole?: string | null;
  teamId?: string | null;
  team?: Team | null;
  /** Manual board order; null falls back to createdAt */
  position?: number | null;
  creatorId: string;
  creator?: User;
  subtasks: Subtask[];
  checklists: Checklist[];
  attachments: Attachment[];
  comments: TaskComment[];
  list?: {
    id: string;
    name: string;
    space?: { id: string; name: string };
    folder?: { id: string; name: string };
  };
  createdAt: string;
  updatedAt?: string;
}

export interface Subtask {
  id: string;
  title: string;
  description?: string | null;
  status?: string;
  completed: boolean;
  taskId: string;
  assignees?: User[];
  assigneeIds?: string[];
  teamId?: string | null;
  team?: Team | null;
  priority: Priority;
  dueDate?: string | null;
  assigneeRoleRestrictions?: string[];
  teamAssignAccessRole?: string | null;
  createdAt: string;
  /** Loaded on demand; task payloads carry only `_count.comments`. */
  comments?: TaskComment[];
  _count?: { comments?: number };
  checklists?: Checklist[];
}

export interface Checklist {
  id: string;
  name: string;
  taskId: string;
  subtaskId?: string;
  /** Linked ClickUp checklist ID, when the checklist came from or was sent to ClickUp. */
  externalId?: string | null;
  items: ChecklistItem[];
  createdAt: string;
}

export interface TaskChecklistItem {
  id: string;
  checklistId: string;
  content: string;
  isCompleted: boolean;
  position: number;
}

export interface WorkspaceRole {
  id: string;
  name: string;
  color?: string | null;
  createdAt: string;
}

export interface ChecklistItem {
  id: string;
  text: string;
  completed: boolean;
  checklistId: string;
  checkedById?: string;
  // Every assignee's user id (several auditors can share an audit item)
  assigneeId?: string[];
  createdAt: string;
}

export interface TaskComment {
  id: string;
  content: string;
  taskId: string;
  subtaskId?: string;
  userId: string;
  user?: User;
  createdAt: string;
}

export interface Attachment {
  id: string;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  mimeType: string;
  createdAt: string;
}

export interface Channel {
  id: string;
  name?: string;
  topic?: string;
  description?: string;
  type: ChannelType;
  isPrivate: boolean;
  isArchived: boolean;
  spaceId?: string;
  createdById?: string;
  members?: ChannelMember[];
  createdAt: string;
  updatedAt: string;
}

export interface ChannelMember {
  id: string;
  channelId: string;
  userId: string;
  role: ChannelRole;
  notificationsEnabled: boolean;
  lastReadAt: string;
  joinedAt: string;
  user?: User;
}

export interface Message {
  id: string;
  content: string;
  channelId: string;
  senderId: string;
  sender?: User;
  parentMessageId?: string;
  replyCount: number;
  isEdited: boolean;
  editedAt?: string;
  isDeleted: boolean;
  deletedAt?: string;
  isPinned: boolean;
  pinnedAt?: string;
  pinnedById?: string;
  attachments?: MessageAttachment[];
  reactions?: MessageReaction[];
  mentions?: MessageMention[];
  createdAt: string;
  updatedAt: string;
}

export interface MessageAttachment {
  id: string;
  messageId: string;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  mimeType: string;
  createdAt: string;
}

export interface MessageReaction {
  id: string;
  messageId: string;
  userId: string;
  emoji: string;
  createdAt: string;
}

export interface MessageMention {
  id: string;
  messageId: string;
  mentionedUserId: string;
  mentionedUser?: User;
  createdAt: string;
}

export interface MessageNotification {
  id: string;
  userId: string;
  messageId: string;
  type: NotificationType;
  isRead: boolean;
  createdAt: string;
}
