import { prisma } from '../config/prisma';

export type SoundChoice = 'inherit' | 'ting' | 'chime' | 'pop' | 'bell' | 'glass' | 'custom' | 'mute';

export interface CategorySoundConfig {
  preset?: SoundChoice;
  soundUrl?: string | null;
}

export type SoundCategory = 'mention' | 'reaction' | 'comment' | 'status';

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
  typeSounds?: Partial<Record<SoundCategory, CategorySoundConfig>>;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: Required<UserNotificationPreferences> = {
  status: true,
  checklists: true,
  audits: true,
  assigned: true,
  comments: true,
  mentions: true,
  defaultView: 'for_me',
  confettiEnabled: false,
  receiveConfetti: false,
  soundEnabled: true,
  soundPreset: 'ting',
  soundVolume: 0.8,
  soundUrl: null as unknown as string,
  typeSounds: {},
};

/**
 * Filters a list of user IDs to only those who have enabled notifications for the given category.
 * Default is true if preferences are not set or the key is not explicitly false.
 */
export async function filterUsersByNotificationPreference(
  userIds: string[],
  category: keyof UserNotificationPreferences
): Promise<string[]> {
  if (!userIds || userIds.length === 0) return [];

  const users = await (prisma.user as any).findMany({
    where: { id: { in: userIds } },
    select: { id: true, notificationPreferences: true },
  });

  return (users || [])
    .filter((u: any) => {
      const prefs = u?.notificationPreferences as UserNotificationPreferences | null;
      if (!prefs) return true;
      return prefs[category] !== false;
    })
    .map((u: any) => u.id);
}

/**
 * Checks if a single user has enabled notifications for a given category.
 */
export async function shouldUserReceiveNotification(
  userId: string,
  category: keyof UserNotificationPreferences
): Promise<boolean> {
  const user = await (prisma.user as any).findUnique({
    where: { id: userId },
    select: { notificationPreferences: true },
  });
  if (!user) return false;
  const prefs = (user as any).notificationPreferences as UserNotificationPreferences | null;
  if (!prefs) return true;
  return prefs[category] !== false;
}
