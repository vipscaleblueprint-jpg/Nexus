/**
 * Domain enums, mirrored from prisma/schema.prisma as string unions so they can
 * be shared with the client (which has no Prisma runtime).
 */

export const SYSTEM_ROLES = ['ADMIN', 'MEMBER'] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

export const INVITATION_STATUSES = ['PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];



export const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'INTERN', 'CONTRACTOR'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const ENTITY_TYPES = ['SPACE', 'FOLDER', 'LIST', 'DOC', 'PAGE'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const CHANNEL_TYPES = ['PUBLIC', 'PRIVATE', 'DM', 'GROUP_DM'] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export const CHANNEL_ROLES = ['OWNER', 'ADMIN', 'MEMBER', 'GUEST'] as const;
export type ChannelRole = (typeof CHANNEL_ROLES)[number];

export const NOTIFICATION_TYPES = [
  'MENTION',
  'REPLY',
  'REACTION',
  'DIRECT_MESSAGE',
  'CHANNEL_MESSAGE',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
