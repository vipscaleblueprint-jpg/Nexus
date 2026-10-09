// Single source of truth for priority styling (matches the My Tasks design:
// filled Flag icon + colored label). Use everywhere priority is displayed.

export const PRIORITY_OPTIONS = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'] as const;

export interface PriorityConfig {
  label: string;
  color: string;
  iconColor: string;
  // Tinted background + text for the colored pill badge
  pill: string;
}

export const PRIORITY_CONFIG: Record<string, PriorityConfig> = {
  URGENT: {
    label: 'Urgent',
    color: 'text-rose-400',
    iconColor: 'text-rose-500 fill-rose-500',
    pill: 'bg-rose-500/20 text-rose-400',
  },
  HIGH: {
    label: 'High',
    color: 'text-amber-400',
    iconColor: 'text-amber-500 fill-amber-500',
    pill: 'bg-amber-500/20 text-amber-400',
  },
  MEDIUM: {
    label: 'Normal',
    color: 'text-blue-400',
    iconColor: 'text-blue-500 fill-blue-500',
    pill: 'bg-blue-500/20 text-blue-400',
  },
  LOW: {
    label: 'Low',
    color: 'text-zinc-400',
    iconColor: 'text-zinc-400 fill-zinc-400',
    pill: 'bg-zinc-700/60 text-zinc-300',
  },
};

export const EMPTY_PRIORITY: PriorityConfig = {
  label: 'No Priority',
  color: 'text-zinc-500',
  iconColor: 'text-zinc-500',
  pill: 'bg-zinc-800/80 text-zinc-500',
};

export function getPriorityConfig(priority?: string | null): PriorityConfig {
  if (!priority) return EMPTY_PRIORITY;
  return PRIORITY_CONFIG[priority.toUpperCase()] ?? { ...EMPTY_PRIORITY, label: priority };
}
