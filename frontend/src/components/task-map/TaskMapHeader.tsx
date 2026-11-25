import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { TaskMapShift, UpworkSession, taskMapApi, getUserRoleDefinition, AuditorRoleOption, isProjectBasedUpwork, subscribeTaskMapSaving } from '@/api/taskMap';
import { Users, Building2, ChevronDown, Check, Search, ShieldCheck, Shield, Kanban, UserCheck, X, Briefcase, Plus, Loader2, ArrowUpDown, ArrowDownWideNarrow, ArrowUpNarrowWide, Table } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { isAaronUser, isProjectManagerOrAdmin } from '@/lib/permissions';
import { AutoQueueControls } from './AutoQueueControls';

export interface ClientOption {
  id: string;
  name: string;
  count: number;
}

interface Props {
  currentDate: string;
  currentShift: string;
  activeShift?: string;
  onShiftChange: (shift: string) => void;
  shifts?: TaskMapShift[];
  search: string;
  onSearchChange: (search: string) => void;
  activeUpworkSessions?: UpworkSession[];
  currentView?: 'BOARD' | 'AUDITING' | 'CRM' | 'UPWORK' | 'DAILY_TRACKER' | 'SHEETS';
  onViewChange?: (view: 'BOARD' | 'AUDITING' | 'CRM' | 'DAILY_TRACKER' | 'SHEETS') => void;
  clients?: ClientOption[];
  adminClients?: ClientOption[];
  adminCount?: number;
  showAdmin?: boolean;
  onToggleAdmin?: () => void;
  selectedClients?: string[] | 'ALL';
  onSelectClients?: (clients: string[] | 'ALL') => void;
  selectedClient?: string;
  onClientChange?: (clientId: string) => void;
  taskMapQueueCount?: number;
  auditingCount?: number;
  crmCount?: number;
  maSortMode?: 'DEFAULT' | 'QUEUE_DESC' | 'QUEUE_ASC';
  onMaSortModeChange?: (mode: 'DEFAULT' | 'QUEUE_DESC' | 'QUEUE_ASC') => void;
  availableMAs?: Array<{ id: string; name: string; avatarUrl?: string | null; roles?: string[] }>;
  selectedMAs?: string[];
  onSelectedMAsChange?: (maIds: string[]) => void;
  hasCrmAccess?: boolean;
  onTriggerDailyRollover?: () => void;
  isRollingOver?: boolean;
  isHistory?: boolean;
  auditorRoles?: AuditorRoleOption[];
  auditorTypeFilter?: string;
  onAuditorTypeFilterChange?: (filter: string) => void;
  developerRoles?: AuditorRoleOption[];
  developerTypeFilter?: string;
  onDeveloperTypeFilterChange?: (filter: string) => void;
  isFilterLoading?: boolean;
  trackFilter?: 'ALL' | 'LIVE' | 'ACTIVE';
  onTrackFilterChange?: (filter: 'ALL' | 'LIVE' | 'ACTIVE') => void;
}

function formatElapsed(startedAt: string, now: Date): string {
  const startMs = new Date(startedAt).getTime();
  const diffMs = Math.max(0, now.getTime() - startMs);
  const totalMins = Math.floor(diffMs / 60000);
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return `${hrs}h ${String(mins).padStart(2, '0')}m`;
}

function formatManilaTime(dateOrIso: string | Date | null | undefined): string {
  if (!dateOrIso) return '';
  try {
    const d = typeof dateOrIso === 'string' ? new Date(dateOrIso) : dateOrIso;
    if (isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(d);
  } catch {
    return '';
  }
}

function getCleanUpworkName(session: UpworkSession): string {
  // Prefer specific target name (e.g. HANNAH, BLESSIE, CHE, PAU, SHEMUEL)
  if (session.pmName && session.pmName !== 'Active' && session.pmName !== 'General') {
    return session.pmName.toUpperCase();
  }
  const raw = session.userName || '';
  if (raw.includes('@')) {
    return raw.split('@')[0].toUpperCase();
  }
  return (raw || 'USER').toUpperCase();
}

export const TaskMapHeader: React.FC<Props> = ({
  currentDate,
  currentShift,
  activeShift = '',
  onShiftChange,
  shifts = [],
  search,
  onSearchChange,
  activeUpworkSessions = [],
  currentView = 'BOARD',
  onViewChange,
  clients = [],
  adminClients = [],
  adminCount = 0,
  showAdmin = false,
  onToggleAdmin,
  selectedClients,
  onSelectClients,
  selectedClient = 'ALL',
  onClientChange,
  taskMapQueueCount = 0,
  auditingCount = 0,
  crmCount = 0,
  maSortMode = 'DEFAULT',
  onMaSortModeChange,
  availableMAs = [],
  selectedMAs = [],
  onSelectedMAsChange,
  hasCrmAccess = false,
  onTriggerDailyRollover,
  isRollingOver = false,
  isHistory = false,
  auditorRoles = [],
  auditorTypeFilter = 'ALL',
  onAuditorTypeFilterChange,
  developerRoles = [],
  developerTypeFilter = 'ALL',
  onDeveloperTypeFilterChange,
  isFilterLoading = false,
  trackFilter = 'ALL',
  onTrackFilterChange,
}) => {
  // Live ticking timer for elapsed duration (Reverse-engineered from Teammap.js)
  const [now, setNow] = useState<Date>(new Date());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  // Track in-flight DB saves from taskMap.ts
  const [savingCount, setSavingCount] = useState(0);
  useEffect(() => {
    return subscribeTaskMapSaving((ids) => {
      setSavingCount(ids.size);
    });
  }, []);

  // Local buffered filter states so multi-select filter changes wait before loading all on the board
  const propSelectedClients: string[] | 'ALL' =
    selectedClients !== undefined
      ? selectedClients
      : (selectedClient ? (selectedClient === 'ALL' ? 'ALL' : [selectedClient]) : 'ALL');

  const [draftShift, setDraftShift] = useState(currentShift || 'ALL');
  const [draftSelectedClients, setDraftSelectedClients] = useState<string[] | 'ALL'>(propSelectedClients);
  const [draftShowAdmin, setDraftShowAdmin] = useState(showAdmin);
  const [draftSelectedMAs, setDraftSelectedMAs] = useState<string[]>(selectedMAs);
  const [draftAuditorFilter, setDraftAuditorFilter] = useState(auditorTypeFilter || 'ALL');
  const [draftDeveloperFilter, setDraftDeveloperFilter] = useState(developerTypeFilter || 'ALL');
  const [draftSearch, setDraftSearch] = useState(search || '');
  const [isWaitingFilter, setIsWaitingFilter] = useState(false);

  useEffect(() => {
    setDraftShift(currentShift || 'ALL');
  }, [currentShift]);

  useEffect(() => {
    setDraftSelectedClients(propSelectedClients);
  }, [selectedClients, selectedClient]);

  useEffect(() => {
    setDraftShowAdmin(showAdmin);
  }, [showAdmin]);

  useEffect(() => {
    setDraftSelectedMAs(selectedMAs);
  }, [selectedMAs]);

  useEffect(() => {
    setDraftAuditorFilter(auditorTypeFilter || 'ALL');
  }, [auditorTypeFilter]);

  useEffect(() => {
    setDraftDeveloperFilter(developerTypeFilter || 'ALL');
  }, [developerTypeFilter]);

  useEffect(() => {
    setDraftSearch(search || '');
  }, [search]);

  const shiftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clientTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const auditorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const developerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleShiftCommit = (nextShift: string) => {
    setDraftShift(nextShift);
    setIsWaitingFilter(true);
    if (shiftTimerRef.current) clearTimeout(shiftTimerRef.current);
    shiftTimerRef.current = setTimeout(() => {
      onShiftChange(nextShift);
      setIsWaitingFilter(false);
    }, 550);
  };

  const scheduleClientsCommit = (nextClients: string[] | 'ALL', nextClientSingle?: string) => {
    setDraftSelectedClients(nextClients);
    setIsWaitingFilter(true);
    if (clientTimerRef.current) clearTimeout(clientTimerRef.current);
    clientTimerRef.current = setTimeout(() => {
      onSelectClients?.(nextClients);
      if (nextClientSingle !== undefined) onClientChange?.(nextClientSingle);
      setIsWaitingFilter(false);
    }, 550);
  };

  const scheduleAdminToggleCommit = (nextAdmin: boolean) => {
    setDraftShowAdmin(nextAdmin);
    setIsWaitingFilter(true);
    if (clientTimerRef.current) clearTimeout(clientTimerRef.current);
    clientTimerRef.current = setTimeout(() => {
      if (nextAdmin !== showAdmin) {
        onToggleAdmin?.();
      }
      setIsWaitingFilter(false);
    }, 550);
  };

  const scheduleMAsCommit = (nextMAs: string[]) => {
    setDraftSelectedMAs(nextMAs);
    setIsWaitingFilter(true);
    if (maTimerRef.current) clearTimeout(maTimerRef.current);
    maTimerRef.current = setTimeout(() => {
      onSelectedMAsChange?.(nextMAs);
      setIsWaitingFilter(false);
    }, 550);
  };

  const scheduleAuditorFilterCommit = (nextFilter: string) => {
    setDraftAuditorFilter(nextFilter);
    setIsWaitingFilter(true);
    if (auditorTimerRef.current) clearTimeout(auditorTimerRef.current);
    auditorTimerRef.current = setTimeout(() => {
      onAuditorTypeFilterChange?.(nextFilter);
      setIsWaitingFilter(false);
    }, 550);
  };

  const scheduleDeveloperFilterCommit = (nextFilter: string) => {
    setDraftDeveloperFilter(nextFilter);
    setIsWaitingFilter(true);
    if (developerTimerRef.current) clearTimeout(developerTimerRef.current);
    developerTimerRef.current = setTimeout(() => {
      onDeveloperTypeFilterChange?.(nextFilter);
      setIsWaitingFilter(false);
    }, 550);
  };

  const handleSearchInputChange = (val: string) => {
    setDraftSearch(val);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!val.trim()) {
      onSearchChange('');
      return;
    }
    searchTimerRef.current = setTimeout(() => {
      onSearchChange(val);
    }, 250);
  };

  // Client dropdown state
  const [clientDropdownOpen, setClientDropdownOpen] = useState(false);
  const [clientSearch, setClientSearch] = useState('');
  const clientDropdownRef = useRef<HTMLDivElement>(null);

  // Auditor Type dropdown state (Checkbox style)
  const [auditorDropdownOpen, setAuditorDropdownOpen] = useState(false);
  const [auditorSearch, setAuditorSearch] = useState('');
  const auditorDropdownRef = useRef<HTMLDivElement>(null);

  // Developer Type dropdown state (Checkbox style)
  const [developerDropdownOpen, setDeveloperDropdownOpen] = useState(false);
  const [developerSearch, setDeveloperSearch] = useState('');
  const developerDropdownRef = useRef<HTMLDivElement>(null);

  // Upwork Clients state (Restricted to Project Managers & Admins)
  const currentUser = useAppStore((s) => s.currentUser);
  const isAaron = isAaronUser(currentUser);
  const isPmOrAdmin = isProjectManagerOrAdmin(currentUser) || isAaron;
  const [upworkModalOpen, setUpworkModalOpen] = useState(false);
  const [upworkSearch, setUpworkSearch] = useState('');
  const [newUpworkClient, setNewUpworkClient] = useState('');
  const upworkClients = useAppStore((s) => s.upworkClients);
  const setUpworkClients = useAppStore((s) => s.setUpworkClients);
  const upworkProjectClients = useAppStore((s) => s.upworkProjectClients);
  const setUpworkProjectClients = useAppStore((s) => s.setUpworkProjectClients);
  const workspaceTeams = useAppStore((s) => s.workspaceTeams);
  const workspaceRoles = useAppStore((s) => s.workspaceRoles);

  const handleToggleUpworkClient = async (clientName: string) => {
    if (!isAaron) return; // Marking or removing Upwork clients is strictly limited to Aaron!
    const trimmed = clientName.trim();
    if (!trimmed) return;
    const exists = upworkClients.some((c) => c.toLowerCase() === trimmed.toLowerCase());
    const nextList = exists
      ? upworkClients.filter((c) => c.toLowerCase() !== trimmed.toLowerCase())
      : [...upworkClients, trimmed];
    setUpworkClients(nextList);
    try {
      await taskMapApi.toggleUpworkClient({ clientName: trimmed, isUpwork: !exists });
    } catch (err) {
      console.error('Failed to toggle upwork client:', err);
      setUpworkClients(upworkClients);
    }
  };

  const handleToggleProjectBased = async (clientName: string) => {
    if (!isPmOrAdmin) return;
    const trimmed = clientName.trim();
    if (!trimmed) return;
    // Project-Based or Hourly Rate mode can ONLY be toggled if the client is marked as Upwork!
    const isUpwork = upworkClients.some((c) => c.toLowerCase() === trimmed.toLowerCase());
    if (!isUpwork) return;

    const isCurrentlyProject = isProjectBasedUpwork(trimmed) ||
      upworkProjectClients.some((u) => u.toLowerCase() === trimmed.toLowerCase());
    const nextList = isCurrentlyProject
      ? upworkProjectClients.filter((u) => u.toLowerCase() !== trimmed.toLowerCase())
      : [...upworkProjectClients, trimmed];
    setUpworkProjectClients(nextList);
    try {
      await taskMapApi.toggleUpworkClient({ clientName: trimmed, isUpwork: true, isProjectBased: !isCurrentlyProject });
    } catch (err) {
      console.error('Failed to toggle project-based client:', err);
      setUpworkProjectClients(upworkProjectClients);
    }
  };

  const handleAddNewUpworkClient = async () => {
    if (!isAaron) return; // Adding new Upwork clients is strictly limited to Aaron!
    const trimmed = newUpworkClient.trim();
    if (!trimmed) return;
    if (!upworkClients.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
      const nextList = [...upworkClients, trimmed];
      setUpworkClients(nextList);
      setNewUpworkClient('');
      try {
        await taskMapApi.toggleUpworkClient({ clientName: trimmed, isUpwork: true });
      } catch (err) {
        console.error('Failed to add upwork client:', err);
        setUpworkClients(upworkClients);
      }
    } else {
      setNewUpworkClient('');
    }
  };

  // Custom MA filter dropdown state
  const [maDropdownOpen, setMaDropdownOpen] = useState(false);
  const [maSearch, setMaSearch] = useState('');
  const maDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!clientDropdownOpen) return;
    const handleClickOutside = (e: PointerEvent) => {
      if (
        clientDropdownRef.current &&
        !e.composedPath().includes(clientDropdownRef.current)
      ) {
        setClientDropdownOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleClickOutside);
    return () => document.removeEventListener('pointerdown', handleClickOutside);
  }, [clientDropdownOpen]);

  useEffect(() => {
    if (!maDropdownOpen) return;
    const handleClickOutside = (e: PointerEvent) => {
      if (
        maDropdownRef.current &&
        !e.composedPath().includes(maDropdownRef.current)
      ) {
        setMaDropdownOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleClickOutside);
    return () => document.removeEventListener('pointerdown', handleClickOutside);
  }, [maDropdownOpen]);

  useEffect(() => {
    if (!developerDropdownOpen) return;
    const handleClickOutside = (e: PointerEvent) => {
      if (
        developerDropdownRef.current &&
        !e.composedPath().includes(developerDropdownRef.current)
      ) {
        setDeveloperDropdownOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleClickOutside);
    return () => document.removeEventListener('pointerdown', handleClickOutside);
  }, [developerDropdownOpen]);

  // Developer Roles & Checkbox Filter Logic
  const nonAllDeveloperRoles = React.useMemo(() => {
    return (developerRoles || []).filter((r) => r.key !== 'ALL');
  }, [developerRoles]);

  const isDeveloperRoleChecked = (key: string) => {
    if (!draftDeveloperFilter || draftDeveloperFilter === 'ALL') return true;
    if (draftDeveloperFilter === 'NONE') return false;
    const tokens = draftDeveloperFilter.split(',').map((k) => k.trim().toLowerCase());
    return tokens.includes(key.toLowerCase());
  };

  const allDevelopersChecked =
    !draftDeveloperFilter ||
    draftDeveloperFilter === 'ALL' ||
    (nonAllDeveloperRoles.length > 0 && nonAllDeveloperRoles.every((r) => isDeveloperRoleChecked(r.key)));

  const handleToggleAllDevelopers = () => {
    if (allDevelopersChecked) {
      scheduleDeveloperFilterCommit('NONE');
    } else {
      scheduleDeveloperFilterCommit('ALL');
    }
  };

  const handleToggleDeveloperRole = (key: string) => {
    const currentChecked = nonAllDeveloperRoles.filter((r) => isDeveloperRoleChecked(r.key)).map((r) => r.key);
    let nextKeys: string[];
    if (currentChecked.some((k) => k.toLowerCase() === key.toLowerCase())) {
      nextKeys = currentChecked.filter((k) => k.toLowerCase() !== key.toLowerCase());
    } else {
      nextKeys = [...currentChecked, key];
    }

    if (nextKeys.length === 0) {
      scheduleDeveloperFilterCommit('NONE');
    } else if (nextKeys.length === nonAllDeveloperRoles.length) {
      scheduleDeveloperFilterCommit('ALL');
    } else {
      scheduleDeveloperFilterCommit(nextKeys.join(','));
    }
  };

  const handleSelectOnlyDeveloperRole = (key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    scheduleDeveloperFilterCommit(key);
  };

  const handleResetDeveloperFilter = () => {
    if (developerTimerRef.current) clearTimeout(developerTimerRef.current);
    setDraftDeveloperFilter('ALL');
    setIsWaitingFilter(false);
    onDeveloperTypeFilterChange?.('ALL');
    setDeveloperDropdownOpen(false);
  };

  const isDeveloperFiltered = Boolean(draftDeveloperFilter && draftDeveloperFilter !== 'ALL');

  const getDeveloperButtonLabel = () => {
    if (!draftDeveloperFilter || draftDeveloperFilter === 'ALL' || allDevelopersChecked) {
      return { label: 'All Developers', isHighlight: false };
    }
    if (draftDeveloperFilter === 'NONE') {
      return { label: '0 Developers', isHighlight: true };
    }
    const tokens = draftDeveloperFilter.split(',').map((t) => t.trim()).filter(Boolean);
    if (tokens.length === 1) {
      const match = (developerRoles || []).find(
        (r) => r.key.toLowerCase() === tokens[0].toLowerCase()
      );
      return { label: match?.label || tokens[0], isHighlight: true };
    }
    return { label: `${tokens.length} Dev Roles`, isHighlight: true };
  };

  const developerButtonDetails = getDeveloperButtonLabel();

  const filteredDeveloperRoles = nonAllDeveloperRoles.filter((r) =>
    r.label.toLowerCase().includes(developerSearch.toLowerCase()) ||
    r.fullRole.toLowerCase().includes(developerSearch.toLowerCase())
  );

  useEffect(() => {
    if (!auditorDropdownOpen) return;
    const handleClickOutside = (e: PointerEvent) => {
      if (
        auditorDropdownRef.current &&
        !e.composedPath().includes(auditorDropdownRef.current)
      ) {
        setAuditorDropdownOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleClickOutside);
    return () => document.removeEventListener('pointerdown', handleClickOutside);
  }, [auditorDropdownOpen]);

  // Auditor Roles & Checkbox Filter Logic
  const nonAllAuditorRoles = React.useMemo(() => {
    return (auditorRoles || []).filter((r) => r.key !== 'ALL');
  }, [auditorRoles]);

  const isAuditorRoleChecked = (key: string) => {
    if (!draftAuditorFilter || draftAuditorFilter === 'ALL') return true;
    if (draftAuditorFilter === 'NONE') return false;
    const tokens = draftAuditorFilter.split(',').map((k) => k.trim().toLowerCase());
    return tokens.includes(key.toLowerCase());
  };

  const allAuditorsChecked =
    !draftAuditorFilter ||
    draftAuditorFilter === 'ALL' ||
    (nonAllAuditorRoles.length > 0 &&
      nonAllAuditorRoles.every((r) => isAuditorRoleChecked(r.key)));

  const handleToggleAllAuditors = () => {
    if (allAuditorsChecked) {
      scheduleAuditorFilterCommit('NONE');
    } else {
      scheduleAuditorFilterCommit('ALL');
    }
  };

  const handleToggleAuditorRole = (key: string) => {
    if (allAuditorsChecked) {
      const remaining = nonAllAuditorRoles.map((r) => r.key).filter((k) => k.toLowerCase() !== key.toLowerCase());
      if (remaining.length === 0) {
        scheduleAuditorFilterCommit('NONE');
      } else {
        scheduleAuditorFilterCommit(remaining.join(','));
      }
    } else if (draftAuditorFilter === 'NONE') {
      scheduleAuditorFilterCommit(key);
    } else {
      const currentTokens = new Set(
        (draftAuditorFilter || '')
          .split(',')
          .map((k) => k.trim())
          .filter((k) => k && k.toUpperCase() !== 'ALL' && k.toUpperCase() !== 'NONE')
      );
      const existing = Array.from(currentTokens).find((t) => t.toLowerCase() === key.toLowerCase());
      if (existing) {
        currentTokens.delete(existing);
      } else {
        currentTokens.add(key);
      }
      const arr = Array.from(currentTokens);
      if (arr.length === nonAllAuditorRoles.length) {
        scheduleAuditorFilterCommit('ALL');
      } else if (arr.length === 0) {
        scheduleAuditorFilterCommit('NONE');
      } else {
        scheduleAuditorFilterCommit(arr.join(','));
      }
    }
  };

  const handleSelectOnlyAuditorRole = (key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    scheduleAuditorFilterCommit(key);
  };

  const handleResetAuditorFilter = () => {
    scheduleAuditorFilterCommit('ALL');
    setAuditorSearch('');
  };

  const isAuditorFiltered = !allAuditorsChecked;

  const getAuditorButtonLabel = () => {
    if (!isAuditorFiltered) {
      return {
        label: 'All',
        isHighlight: false,
      };
    }

    if (draftAuditorFilter === 'NONE') {
      return {
        label: 'None',
        isHighlight: true,
      };
    }

    const currentTokens = (draftAuditorFilter || '')
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k && k.toUpperCase() !== 'ALL' && k.toUpperCase() !== 'NONE');

    if (currentTokens.length === 0) {
      return {
        label: 'All',
        isHighlight: false,
      };
    }

    if (currentTokens.length === 1) {
      const match = (auditorRoles || []).find(
        (r) => r.key.toLowerCase() === currentTokens[0].toLowerCase()
      );
      return {
        label: match ? match.label : currentTokens[0],
        isHighlight: true,
      };
    }

    return {
      label: `${currentTokens.length} Types`,
      isHighlight: true,
    };
  };

  const auditorButtonDetails = getAuditorButtonLabel();

  const filteredAuditorRoles = nonAllAuditorRoles.filter((r) =>
    r.label.toLowerCase().includes(auditorSearch.toLowerCase()) ||
    r.fullRole.toLowerCase().includes(auditorSearch.toLowerCase())
  );

  // Compute total tasks and active client object
  const totalClientTasks = clients.reduce((acc, c) => acc + c.count, 0);

  // Effective multi-select client state uses buffered draftSelectedClients for instant checkbox response
  const effectiveSelectedClients: string[] | 'ALL' = draftSelectedClients;

  const allClientsChecked =
    effectiveSelectedClients === 'ALL' ||
    (Array.isArray(effectiveSelectedClients) && effectiveSelectedClients.length === clients.length);

  const isClientChecked = (id: string, name: string) => {
    if (effectiveSelectedClients === 'ALL') return true;
    return effectiveSelectedClients.includes(id) || effectiveSelectedClients.includes(name);
  };

  const handleToggleAllClients = () => {
    if (allClientsChecked) {
      scheduleClientsCommit([], 'NONE');
    } else {
      scheduleClientsCommit('ALL', 'ALL');
    }
  };

  const handleToggleClient = (clientId: string) => {
    if (effectiveSelectedClients === 'ALL') {
      const remaining = clients.map((c) => c.id).filter((id) => id !== clientId);
      scheduleClientsCommit(
        remaining,
        remaining.length === 1 ? remaining[0] : (remaining.length === 0 ? 'NONE' : 'MULTIPLE')
      );
    } else {
      const current = new Set(effectiveSelectedClients);
      if (current.has(clientId)) {
        current.delete(clientId);
      } else {
        current.add(clientId);
      }
      const arr = Array.from(current);
      if (arr.length === clients.length) {
        scheduleClientsCommit('ALL', 'ALL');
      } else {
        scheduleClientsCommit(
          arr,
          arr.length === 1 ? arr[0] : (arr.length === 0 ? 'NONE' : 'MULTIPLE')
        );
      }
    }
  };

  const handleSelectOnlyClient = (clientId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    scheduleClientsCommit([clientId], clientId);
  };

  const handleResetFilter = () => {
    scheduleClientsCommit('ALL', 'ALL');
    if (draftShowAdmin) {
      scheduleAdminToggleCommit(false);
    }
    setClientSearch('');
  };

  const isClientFiltered = draftShowAdmin || !allClientsChecked;

  // Header button label & style
  const getHeaderButtonLabel = () => {
    if (!isClientFiltered) {
      return {
        label: 'All',
        isHighlight: false,
      };
    }

    if (draftShowAdmin && Array.isArray(effectiveSelectedClients) && effectiveSelectedClients.length === 0) {
      return {
        label: 'Admin only',
        isHighlight: true,
      };
    }

    if (draftShowAdmin && allClientsChecked) {
      return {
        label: 'All + Admin',
        isHighlight: true,
      };
    }

    if (!draftShowAdmin && Array.isArray(effectiveSelectedClients) && effectiveSelectedClients.length === 1) {
      const match = clients.find((c) => isClientChecked(c.id, c.name));
      return {
        label: match ? match.name : '1 Client',
        isHighlight: true,
      };
    }

    if (draftShowAdmin && Array.isArray(effectiveSelectedClients) && effectiveSelectedClients.length === 1) {
      const match = clients.find((c) => isClientChecked(c.id, c.name));
      return {
        label: `${match ? match.name : '1 Client'} + Admin`,
        isHighlight: true,
      };
    }

    if (Array.isArray(effectiveSelectedClients)) {
      return {
        label: `${effectiveSelectedClients.length} Clients${draftShowAdmin ? ' + Admin' : ''}`,
        isHighlight: true,
      };
    }

    return {
      label: 'Filtered',
      isHighlight: true,
    };
  };

  const buttonDetails = getHeaderButtonLabel();

  const filteredClients = clients.filter((c) =>
    c.name.toLowerCase().includes(clientSearch.toLowerCase())
  );

  // Combine clients from tasks with any custom configured upwork clients
  const allCombinedClients = React.useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    clients.forEach((c) => map.set(c.name.toLowerCase(), { id: c.id, name: c.name }));
    upworkClients.forEach((u) => {
      if (!map.has(u.toLowerCase())) {
        map.set(u.toLowerCase(), { id: u, name: u });
      }
    });
    return Array.from(map.values())
      .filter((c) => c.name.toLowerCase().includes(upworkSearch.toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [clients, upworkClients, upworkSearch]);

  // For Aaron: show all clients (to mark/unmark Upwork)
  // For Project Managers: ONLY show clients that are already marked as Upwork (so PMs can toggle Project-Based vs Hourly Rate)
  const displayedClients = React.useMemo(() => {
    if (isAaron) {
      return allCombinedClients;
    }
    return allCombinedClients.filter((client) =>
      upworkClients.some((u) => u.toLowerCase() === client.name.toLowerCase())
    );
  }, [isAaron, allCombinedClients, upworkClients]);

  const filteredMAs = (availableMAs || []).filter((m) =>
    (m.name || '').toLowerCase().includes(maSearch.toLowerCase())
  );

  // Format selected date
  const dateObj = currentDate ? new Date(currentDate) : new Date();
  const formattedDate = format(dateObj, 'MMMM d, yyyy');
  const dayOfWeek = format(dateObj, 'EEEE');

  const formatShiftHours = (s: TaskMapShift) => {
    const fmt = (h: number, m: number) => {
      const hour = h % 12 || 12;
      const ampm = h >= 12 ? 'PM' : 'AM';
      return `${hour}:${String(m || 0).padStart(2, '0')} ${ampm}`;
    };
    return `${fmt(s.startHour, s.startMinute)} – ${fmt(s.endHour, s.endMinute)}`;
  };

  const shiftOptions = React.useMemo(() => {
    const baseLabel = (s: TaskMapShift) => {
      const k = (s.shiftKey || '').toUpperCase();
      if (k === 'NOON' || k === 'PM_AFTERNOON' || k === 'AFTERNOON') return 'Noon';
      const cleanName = (s.name || '').replace(/\s+shift$/i, '').trim();
      if (cleanName) {
        return /^afternoon$/i.test(cleanName) ? 'Noon' : cleanName;
      }
      if (k === 'DAY' || k === 'AM' || k === 'MORNING') return 'Morning';
      if (k === 'NIGHT' || k === 'PM_NIGHT') return 'Night';
      return s.shiftKey;
    };

    const dbActiveShifts = (shifts || []).filter((s) => s.isActive !== false);
    const dynamicShifts = dbActiveShifts.length > 0
      ? [...dbActiveShifts]
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
          .map((s) => ({
            key: (s.shiftKey || '').toUpperCase(),
            label: baseLabel(s),
            hoursLabel: `${(s.name || '').replace(/afternoon/gi, 'Noon')} (${formatShiftHours(s)} Manila)`,
          }))
      : [
          { key: 'DAY', label: 'Morning', hoursLabel: 'Morning Shift' },
          { key: 'NOON', label: 'Noon', hoursLabel: 'Noon Shift' },
          { key: 'NIGHT', label: 'Night', hoursLabel: 'Night Shift' },
        ];

    return [
      { key: 'ALL', label: 'All', hoursLabel: 'All shifts' },
      { key: 'LIVE', label: 'Live', hoursLabel: 'Only users with Live Working clocked in right now' },
      { key: 'ACTIVE', label: 'Active', hoursLabel: 'Only users who logged progress today' },
      ...dynamicShifts,
      { key: 'CUSTOM', label: 'Custom', hoursLabel: 'Custom MA selection' },
    ];
  }, [shifts]);

  const activeManilaShiftTokens = React.useMemo(() => {
    return (activeShift || '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
  }, [activeShift]);

  const activeShiftTokens = React.useMemo(() => {
    return (draftShift || 'ALL')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
  }, [draftShift]);

  const isAllActive = activeShiftTokens.includes('ALL') || activeShiftTokens.length === 0;

  return (
    <>
      <header className="px-6 pt-4 pb-2.5 flex flex-col gap-2.5 select-none">
        {/* LINE 1: Dedicated View Mode Line (Task Map | Auditor Map | CRM Map) & Search Bar on Right */}
        <div className="flex items-center justify-between gap-4">
          {/* Left: View switcher tabs */}
          {onViewChange && (
            <div className="flex items-center gap-1 bg-card border border-zinc-800/80 rounded-xl p-1 text-xs font-semibold shadow-xs">
              <button
                type="button"
                onClick={() => onViewChange('DAILY_TRACKER')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  currentView === 'DAILY_TRACKER'
                    ? 'bg-emerald-600 text-white shadow-sm font-semibold'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-emerald-500 dark:hover:text-emerald-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/50 font-medium'
                }`}
              >
                <Table className="size-3.5" />
                <span>Daily Tracker</span>
              </button>

              <button
                type="button"
                onClick={() => onViewChange('BOARD')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${currentView === 'BOARD'
                  ? 'bg-blue-600 text-white shadow-sm font-semibold'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/50 font-medium'
                  }`}
              >
                <Kanban className="size-3.5" />
                <span>Task Map</span>
                {taskMapQueueCount > 0 && (
                  <span
                    className={`inline-flex items-center justify-center whitespace-nowrap shrink-0 leading-none text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                      currentView === 'BOARD'
                        ? 'bg-white/20 text-white'
                        : 'bg-blue-500/15 text-blue-500 dark:text-blue-400 border border-blue-500/30'
                    }`}
                  >
                    {taskMapQueueCount > 99 ? '99+' : taskMapQueueCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => onViewChange('AUDITING')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${currentView === 'AUDITING'
                  ? 'bg-amber-600 text-white shadow-sm font-semibold'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-amber-600 dark:hover:text-amber-300 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/50 font-medium'
                  }`}
              >
                <ShieldCheck className="size-3.5" />
                <span>Auditor Map</span>
                {auditingCount > 0 && (
                  <span
                    className={`inline-flex items-center justify-center whitespace-nowrap shrink-0 leading-none text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                      currentView === 'AUDITING'
                        ? 'bg-white/20 text-white'
                        : 'bg-amber-500/15 text-amber-500 dark:text-amber-400 border border-amber-500/30'
                    }`}
                  >
                    {auditingCount > 99 ? '99+' : auditingCount}
                  </span>
                )}
              </button>

              {hasCrmAccess && (
                <button
                  type="button"
                  onClick={() => onViewChange('CRM')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${currentView === 'CRM'
                    ? 'bg-[#22A3AE] text-white shadow-sm font-semibold'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-[#22A3AE] hover:bg-zinc-200/60 dark:hover:bg-zinc-800/50 font-medium'
                    }`}
                >
                  <UserCheck className="size-3.5" />
                  <span>CRM Map</span>
                  {crmCount > 0 && (
                    <span
                      className={`inline-flex items-center justify-center whitespace-nowrap shrink-0 leading-none text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                        currentView === 'CRM'
                          ? 'bg-white/20 text-white'
                          : 'bg-[#22A3AE]/15 text-[#22A3AE] border border-[#22A3AE]/30'
                      }`}
                    >
                      {crmCount > 99 ? '99+' : crmCount}
                    </span>
                  )}
                </button>
              )}
            </div>
          )}

          {/* Right: Status Indicator + Manage Shifts + Clean Search Marketing Name Input */}
          <div className="flex items-center gap-2.5">
            {savingCount > 0 ? (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-500/15 border border-blue-500/30 text-blue-300 text-[11px] font-semibold animate-in fade-in duration-150">
                <Loader2 className="size-3 animate-spin text-blue-400 shrink-0" />
                <span>Saving to database...</span>
              </div>
            ) : isWaitingFilter || isFilterLoading ? (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-800/80 border border-zinc-700/80 text-zinc-300 text-[11px] font-medium animate-in fade-in duration-150">
                <Loader2 className="size-3 animate-spin text-blue-400 shrink-0" />
                <span>Loading filter...</span>
              </div>
            ) : null}

            {/* Link to Audit Shifts configuration / schedule view */}
            <Link
              href="/settings/users?tab=shifts"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-card border border-zinc-800/80 hover:border-zinc-700 rounded-xl text-xs font-medium text-zinc-300 hover:text-zinc-100 transition-colors shrink-0"
              title="Configure Shift Members & Audit Shifts"
            >
              <Users className="size-3.5 text-indigo-400" />
              <span className="hidden sm:inline">Manage Shifts</span>
            </Link>

            {/* Auto-queue: Distribute / Reset (PMs & Admins, today's board only) */}
            {isPmOrAdmin && currentView === 'BOARD' && !isHistory && <AutoQueueControls />}

            <div className="relative flex items-center">
              <Search className="size-3.5 text-zinc-500 absolute left-3 pointer-events-none" />
              <input
                type="text"
                value={draftSearch}
                onChange={(e) => handleSearchInputChange(e.target.value)}
                placeholder="Search marketing name..."
                className="w-48 sm:w-64 pl-8 pr-8 py-1.5 bg-card border border-zinc-300 dark:border-zinc-800/80 rounded-xl text-xs text-zinc-900 dark:text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-500 dark:focus:border-zinc-700 transition-colors"
              />
              {draftSearch && (
                <button
                  type="button"
                  onClick={() => handleSearchInputChange('')}
                  className="absolute right-2.5 text-zinc-500 hover:text-zinc-300 p-0.5 cursor-pointer"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* LINE 2: Date & Day on left, Multi-select Shift Switcher, Manage Shifts & Client Selector on right */}
        <div className="flex items-center justify-between gap-4">
          {/* Left: Date & Day of Week */}
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-xl sm:text-2xl font-extrabold text-zinc-100 tracking-tight">
              {formattedDate}
            </h1>
            <span className="text-xs sm:text-sm font-medium text-zinc-400">
              {dayOfWeek}
            </span>
          </div>

          {/* Right: Shift Switcher, Manage Shifts & Client Selector */}
          <div className="flex items-center gap-2.5 sm:gap-3">
            {/* Developer Type Dropdown (Checkbox Style with All Developers) */}
            {currentView === 'BOARD' && developerRoles && developerRoles.length > 0 && (
              <div className="relative" ref={developerDropdownRef}>
                <button
                  type="button"
                  onClick={() => setDeveloperDropdownOpen(!developerDropdownOpen)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer shadow-xs select-none ${developerButtonDetails.isHighlight
                    ? 'bg-indigo-100 hover:bg-indigo-200 text-indigo-800 border border-indigo-300 dark:bg-indigo-950/70 dark:hover:bg-indigo-950 dark:text-indigo-200 dark:border-indigo-700/80 shadow-sm'
                    : 'bg-card border border-zinc-800/80 hover:border-zinc-700 text-zinc-300 hover:text-zinc-100'
                    }`}
                  title={
                    developerButtonDetails.isHighlight
                      ? `Filtered: ${developerButtonDetails.label}`
                      : 'Filter: All Developer Types'
                  }
                >
                  <Users className="size-3.5 shrink-0 text-indigo-400" />
                  <span className="text-zinc-200 max-w-[120px] sm:max-w-[160px] truncate font-medium">
                    {developerButtonDetails.label}
                  </span>
                  <ChevronDown
                    className={`size-3 text-zinc-400 transition-transform duration-150 ${developerDropdownOpen ? 'rotate-180' : ''
                      }`}
                  />
                </button>

                {developerDropdownOpen && (
                  <div
                    className="absolute right-0 top-full mt-1.5 w-60 bg-popover border border-zinc-700/80 rounded-xl shadow-2xl p-1.5 z-50 flex flex-col gap-1 text-zinc-200 animate-in fade-in zoom-in-95 duration-100"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    {/* Search if > 4 developer roles */}
                    {nonAllDeveloperRoles.length > 4 && (
                      <div className="px-1.5 py-0.5 relative">
                        <Search className="size-3 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          type="text"
                          value={developerSearch}
                          onChange={(e) => setDeveloperSearch(e.target.value)}
                          placeholder="Search dev role..."
                          className="w-full bg-zinc-900 border border-zinc-700/80 rounded-lg pl-7 pr-2 py-1 text-[11px] text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                    )}

                    {/* Master Option: All Developers (Checkbox Style) */}
                    <div className="border-b border-zinc-800/80 pb-1">
                      <button
                        type="button"
                        onClick={handleToggleAllDevelopers}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${allDevelopersChecked
                          ? 'bg-indigo-500/10 text-indigo-400 font-semibold'
                          : 'hover:bg-zinc-800/70 text-zinc-300'
                          }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div
                            className={`size-3.5 rounded border flex items-center justify-center shrink-0 transition-colors ${allDevelopersChecked
                              ? 'bg-indigo-500 border-indigo-500 text-zinc-950'
                              : 'border-zinc-600 bg-zinc-900/50'
                              }`}
                          >
                            {allDevelopersChecked && <Check className="size-2.5 stroke-[3]" />}
                          </div>
                          <span className="truncate">All Developers</span>
                        </div>
                        <span className="text-[10px] text-zinc-500 font-normal shrink-0">
                          {nonAllDeveloperRoles.length}
                        </span>
                      </button>
                    </div>

                    {/* List of individual Developer Roles with Checkboxes */}
                    <div
                      className="max-h-56 overflow-y-auto flex flex-col gap-0.5 pr-0.5"
                      onWheel={(e) => e.stopPropagation()}
                    >
                      {filteredDeveloperRoles.length === 0 ? (
                        <div className="px-2 py-3 text-center text-[11px] text-zinc-500">
                          No developer roles found
                        </div>
                      ) : (
                        filteredDeveloperRoles.map((role) => {
                          const checked = isDeveloperRoleChecked(role.key);
                          return (
                            <div
                              key={role.key}
                              onClick={() => handleToggleDeveloperRole(role.key)}
                              className={`group w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${checked
                                ? 'bg-zinc-800/60 text-zinc-100 font-medium'
                                : 'hover:bg-zinc-800/40 text-zinc-400'
                                }`}
                            >
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <div
                                  className={`size-3.5 rounded border flex items-center justify-center shrink-0 transition-colors ${checked
                                    ? 'bg-indigo-500 border-indigo-500 text-zinc-950'
                                    : 'border-zinc-600 bg-zinc-900/50'
                                    }`}
                                >
                                  {checked && <Check className="size-2.5 stroke-[3]" />}
                                </div>
                                <span className="truncate" title={role.fullRole}>{role.label}</span>
                              </div>
                              <button
                                type="button"
                                onClick={(e) => handleSelectOnlyDeveloperRole(role.key, e)}
                                className="opacity-0 group-hover:opacity-100 px-1.5 py-0.5 rounded bg-zinc-700/80 hover:bg-indigo-500/20 text-[9px] font-semibold text-zinc-300 hover:text-indigo-400 transition-all shrink-0 ml-1"
                                title={`Filter only ${role.label}`}
                              >
                                Only
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>

                    {isDeveloperFiltered && (
                      <div className="pt-1 border-t border-zinc-800/80">
                        <button
                          type="button"
                          onClick={handleResetDeveloperFilter}
                          className="w-full px-2 py-1 text-[10px] font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 rounded-md transition-colors text-center cursor-pointer"
                        >
                          Reset Developer Filter
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Auditor Type Dropdown (Checkbox Style with All Auditors) */}
            {currentView === 'AUDITING' && auditorRoles && auditorRoles.length > 0 && (
              <div className="relative" ref={auditorDropdownRef}>
                <button
                  type="button"
                  onClick={() => setAuditorDropdownOpen(!auditorDropdownOpen)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer shadow-xs select-none ${auditorButtonDetails.isHighlight
                    ? 'bg-amber-100 hover:bg-amber-200 text-amber-800 border border-amber-300 dark:bg-amber-950/70 dark:hover:bg-amber-950 dark:text-amber-200 dark:border-amber-700/80 shadow-sm'
                    : 'bg-card border border-zinc-800/80 hover:border-zinc-700 text-zinc-300 hover:text-zinc-100'
                    }`}
                  title={
                    auditorButtonDetails.isHighlight
                      ? `Filtered: ${auditorButtonDetails.label}`
                      : 'Filter: All Auditor Types'
                  }
                >
                  <ShieldCheck className="size-3.5 shrink-0 text-amber-400" />
                  <span className="text-zinc-200 max-w-[120px] sm:max-w-[160px] truncate font-medium">
                    {auditorButtonDetails.label}
                  </span>
                  <ChevronDown
                    className={`size-3 text-zinc-400 transition-transform duration-150 ${auditorDropdownOpen ? 'rotate-180' : ''
                      }`}
                  />
                </button>

                {auditorDropdownOpen && (
                  <div
                    className="absolute right-0 top-full mt-1.5 w-60 bg-popover border border-zinc-700/80 rounded-xl shadow-2xl p-1.5 z-50 flex flex-col gap-1 text-zinc-200 animate-in fade-in zoom-in-95 duration-100"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    {/* Search if > 4 auditor roles */}
                    {nonAllAuditorRoles.length > 4 && (
                      <div className="px-1.5 py-0.5 relative">
                        <Search className="size-3 text-zinc-500 absolute left-3.5 top-2.5" />
                        <input
                          type="text"
                          value={auditorSearch}
                          onChange={(e) => setAuditorSearch(e.target.value)}
                          placeholder="Search specializations..."
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-7 pr-2 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-amber-500"
                          autoFocus
                        />
                      </div>
                    )}

                    {/* Master Option: All Auditors (Checkbox Style) */}
                    <div className="flex flex-col gap-0.5">
                      <button
                        type="button"
                        onClick={handleToggleAllAuditors}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${allAuditorsChecked
                          ? 'bg-amber-600/15 text-amber-800 dark:text-amber-200 font-semibold'
                          : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60'
                          }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div
                            className={`size-3.5 rounded border flex items-center justify-center shrink-0 transition-colors ${allAuditorsChecked
                              ? 'bg-amber-600 border-amber-500 text-white'
                              : 'border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-transparent'
                              }`}
                          >
                            <Check className="size-2.5" />
                          </div>
                          <ShieldCheck className="size-3 text-amber-600 dark:text-amber-400 shrink-0" />
                          <span className="truncate">All Auditors</span>
                        </div>
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-zinc-800/80 text-zinc-400 shrink-0">
                          {nonAllAuditorRoles.length}
                        </span>
                      </button>
                    </div>

                    <div className="h-px bg-zinc-800/80 my-0.5" />

                    {/* List of individual Auditor Roles with Checkboxes */}
                    <div
                      className="max-h-52 overflow-y-auto custom-scrollbar flex flex-col gap-0.5"
                      onWheel={(e) => e.stopPropagation()}
                      onTouchMove={(e) => e.stopPropagation()}
                    >
                      {filteredAuditorRoles.length === 0 ? (
                        <p className="text-[11px] text-zinc-500 italic text-center py-2">
                          No specializations found
                        </p>
                      ) : (
                        filteredAuditorRoles.map((role) => {
                          const checked = isAuditorRoleChecked(role.key);
                          return (
                            <div
                              key={role.key}
                              onClick={() => handleToggleAuditorRole(role.key)}
                              className={`group w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${checked
                                ? 'bg-amber-600/15 text-amber-800 dark:text-amber-200 font-semibold'
                                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60'
                                }`}
                            >
                              <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
                                <div
                                  className={`size-3.5 rounded border flex items-center justify-center shrink-0 transition-colors ${checked
                                    ? 'bg-amber-600 border-amber-500 text-white'
                                    : 'border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-transparent'
                                    }`}
                                >
                                  <Check className="size-2.5" />
                                </div>
                                <span className="truncate">{role.label}</span>
                              </div>
                              <button
                                type="button"
                                onClick={(e) => handleSelectOnlyAuditorRole(role.key, e)}
                                className="opacity-0 group-hover:opacity-100 text-[10px] text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 hover:underline px-1 py-0.5 rounded transition-opacity"
                                title={`Select only ${role.label}`}
                              >
                                only
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>

                    {/* Reset Button when filtered */}
                    {isAuditorFiltered && (
                      <>
                        <div className="h-px bg-zinc-800/80 my-0.5" />
                        <button
                          type="button"
                          onClick={handleResetAuditorFilter}
                          className="w-full py-1 text-center text-[11px] text-amber-400 hover:text-amber-300 hover:bg-zinc-800/50 rounded-md transition-colors cursor-pointer font-medium"
                        >
                          Reset Auditor Filter
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Shift pills [All] [Live] [Active] [Morning] [Afternoon] [Night] [Custom] */}
            <div className="flex items-center gap-1 bg-card border border-zinc-300 dark:border-zinc-800/80 rounded-xl p-1 text-xs font-medium">
              {shiftOptions.map((opt) => {
                const isCustom = opt.key === 'CUSTOM';
                const isTrackOpt = opt.key === 'LIVE' || opt.key === 'ACTIVE';
                const isActive = isTrackOpt
                  ? trackFilter === opt.key
                  : opt.key === 'ALL'
                    ? isAllActive && trackFilter === 'ALL'
                    : (!isAllActive && activeShiftTokens.includes(opt.key));

                return (
                  <div key={opt.key} className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        if (isTrackOpt) {
                          onTrackFilterChange?.(trackFilter === opt.key ? 'ALL' : (opt.key as 'LIVE' | 'ACTIVE'));
                          return;
                        }
                        if (opt.key === 'ALL') {
                          onTrackFilterChange?.('ALL');
                          scheduleShiftCommit('ALL');
                          return;
                        }
                        if (isAllActive) {
                          scheduleShiftCommit(opt.key);
                          if (isCustom) setMaDropdownOpen(true);
                          return;
                        }
                        if (isActive) {
                          const remaining = activeShiftTokens.filter((k) => k !== opt.key && k !== 'ALL');
                          if (remaining.length === 0) {
                            scheduleShiftCommit('ALL');
                          } else {
                            scheduleShiftCommit(remaining.join(','));
                          }
                        } else {
                          const next = [...activeShiftTokens.filter((k) => k !== 'ALL'), opt.key];
                          scheduleShiftCommit(next.join(','));
                          if (isCustom) setMaDropdownOpen(true);
                        }
                      }}
                      className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg transition-all cursor-pointer ${isActive
                        ? 'bg-zinc-900 text-white dark:bg-zinc-800 dark:text-zinc-100 shadow-xs font-semibold'
                        : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/50'
                        }`}
                      title={
                        isActive
                          ? isCustom
                            ? 'Configure custom MAs (or click again to deselect)'
                            : `Click to deselect • ${(opt as any).hoursLabel || opt.label}`
                          : `Filter by ${(opt as any).hoursLabel || opt.label} (multi-select supported)`
                      }
                    >
                      {activeManilaShiftTokens.includes(opt.key) && (
                        <span className="size-1.5 rounded-full bg-emerald-400 shrink-0" title="Currently active Manila shift" />
                      )}
                      <span>{opt.label}</span>
                      {isCustom && draftSelectedMAs.length > 0 && (
                        <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-blue-500/20 text-blue-700 dark:text-blue-300 font-bold ml-0.5">
                          {draftSelectedMAs.length}
                        </span>
                      )}
                      {isCustom && (
                        <ChevronDown
                          className={`size-3 text-zinc-400 transition-transform ml-0.5 ${maDropdownOpen ? 'rotate-180' : ''
                            }`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!isActive) {
                              if (isAllActive) {
                                scheduleShiftCommit('CUSTOM');
                              } else {
                                const next = [...activeShiftTokens.filter((k) => k !== 'ALL'), 'CUSTOM'];
                                scheduleShiftCommit(next.join(','));
                              }
                            }
                            setMaDropdownOpen(!maDropdownOpen);
                          }}
                        />
                      )}
                    </button>

                    {isCustom && maDropdownOpen && (
                      <div
                        ref={maDropdownRef}
                        className="absolute left-0 top-full mt-1.5 w-64 bg-popover border border-zinc-800 rounded-xl shadow-2xl p-2 z-50 flex flex-col gap-1.5 animate-in fade-in zoom-in-95 duration-100"
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        {/* Search */}
                        <div className="relative">
                          <Search className="size-3 text-zinc-500 absolute left-2 top-2" />
                          <input
                            type="text"
                            value={maSearch}
                            onChange={(e) => setMaSearch(e.target.value)}
                            placeholder="Search members..."
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-md pl-7 pr-2 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                            autoFocus
                          />
                        </div>

                        {/* MA list */}
                        <div className="max-h-56 overflow-y-auto custom-scrollbar flex flex-col gap-0.5" onWheel={(e) => e.stopPropagation()} onTouchMove={(e) => e.stopPropagation()}>
                          {filteredMAs.length === 0 ? (
                            <p className="text-[11px] text-zinc-500 italic text-center py-2">
                              No members found
                            </p>
                          ) : (
                            filteredMAs.map((ma) => {
                              const isChecked = draftSelectedMAs.includes(ma.id);
                              return (
                                <button
                                  key={ma.id}
                                  type="button"
                                  onClick={() => {
                                    const next = isChecked
                                      ? draftSelectedMAs.filter((id) => id !== ma.id)
                                      : [...draftSelectedMAs, ma.id];
                                    scheduleMAsCommit(next);
                                  }}
                                  className={`flex items-center justify-between px-2 py-1.5 rounded-md text-xs transition-colors cursor-pointer ${isChecked
                                    ? 'bg-blue-600/15 text-blue-700 dark:text-blue-200 font-semibold'
                                    : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60'
                                    }`}
                                >
                                  <div className="flex items-center gap-2 truncate">
                                    <div
                                      className={`size-3.5 rounded border flex items-center justify-center shrink-0 ${isChecked
                                        ? 'bg-blue-600 border-blue-500 text-white'
                                        : 'border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900'
                                        }`}
                                    >
                                      {isChecked && <Check className="size-2.5" />}
                                    </div>
                                    <span className="truncate">{ma.name}</span>
                                  </div>
                                  {(() => {
                                    const rDef = getUserRoleDefinition(ma, workspaceTeams, workspaceRoles);
                                    return (
                                      <span className={`text-[9px] px-1.5 py-0.5 rounded border shrink-0 font-medium ${rDef.badgeClass}`}>
                                        {rDef.mainRoleShort}
                                      </span>
                                    );
                                  })()}
                                </button>
                              );
                            })
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Upwork Clients Configuration Button (Restricted to Aaron) */}
            {isAaron && (
              <button
                type="button"
                onClick={() => setUpworkModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-card border border-zinc-800/80 hover:border-emerald-500/50 rounded-xl text-xs font-medium text-zinc-300 hover:text-emerald-300 transition-colors cursor-pointer"
                title="Configure which clients are UPWORK clients"
              >
                <Briefcase className="size-3.5 text-emerald-400" />
                <span className="hidden sm:inline">Upwork Clients</span>
                {upworkClients.length > 0 && (
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/30 font-bold ml-0.5">
                    {upworkClients.length}
                  </span>
                )}
              </button>
            )}

            {/* Client Selector Dropdown (Checkbox Style with Admin Option) */}
            <div className="relative" ref={clientDropdownRef}>
              <button
                type="button"
                onClick={() => setClientDropdownOpen(!clientDropdownOpen)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer shadow-xs select-none ${buttonDetails.isHighlight
                  ? 'bg-blue-100 hover:bg-blue-200 text-blue-700 border border-blue-300 dark:bg-blue-950/70 dark:hover:bg-blue-950 dark:text-blue-200 dark:border-blue-700/80 shadow-sm'
                  : 'bg-card border border-zinc-800/80 hover:border-zinc-700 text-zinc-300 hover:text-zinc-100'
                  }`}
                title={
                  buttonDetails.isHighlight
                    ? `Filtered: ${buttonDetails.label}`
                    : `Filter: All Clients (${totalClientTasks} tasks)`
                }
              >
                <Building2 className={`size-3.5 shrink-0 ${buttonDetails.isHighlight ? 'text-blue-400' : 'text-blue-400'}`} />
                <span className="text-zinc-200 max-w-[120px] sm:max-w-[160px] truncate font-medium">
                  {buttonDetails.label}
                </span>
                <ChevronDown
                  className={`size-3 text-zinc-400 transition-transform duration-150 ${clientDropdownOpen ? 'rotate-180' : ''
                    }`}
                />
              </button>

              {clientDropdownOpen && (
                <div
                  className="absolute right-0 top-full mt-1.5 w-80 bg-popover border border-zinc-700/80 rounded-xl shadow-2xl p-1.5 z-50 flex flex-col gap-1 text-zinc-200 animate-in fade-in zoom-in-95 duration-100"
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  {/* Search if > 4 clients */}
                  {clients.length > 4 && (
                    <div className="px-1.5 py-0.5 relative">
                      <Search className="size-3 text-zinc-500 absolute left-3.5 top-2.5" />
                      <input
                        type="text"
                        value={clientSearch}
                        onChange={(e) => setClientSearch(e.target.value)}
                        placeholder="Search clients..."
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-7 pr-2 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                        autoFocus
                      />
                    </div>
                  )}

                  {/* Master Options: All Clients & Admin Tasks (Checkbox Style) */}
                  <div className="flex flex-col gap-0.5">
                    {/* Option 1: All Clients */}
                    <button
                      type="button"
                      onClick={handleToggleAllClients}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${allClientsChecked
                        ? 'bg-blue-600/15 text-blue-700 dark:text-blue-200 font-semibold'
                        : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60'
                        }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className={`size-3.5 rounded border flex items-center justify-center shrink-0 transition-colors ${allClientsChecked
                            ? 'bg-blue-600 border-blue-500 text-white'
                            : 'border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-transparent'
                            }`}
                        >
                          <Check className="size-2.5" />
                        </div>
                        <Building2 className="size-3 text-blue-600 dark:text-blue-400 shrink-0" />
                        <span className="truncate">All Clients</span>
                      </div>
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-zinc-800/80 text-zinc-400 shrink-0">
                        {totalClientTasks}
                      </span>
                    </button>

                    {/* Option 2: Admin Tasks / Admin Clients (Right under All, exactly per user red annotation) */}
                    <button
                      type="button"
                      onClick={() => scheduleAdminToggleCommit(!draftShowAdmin)}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${draftShowAdmin
                        ? 'bg-purple-100 text-purple-800 border border-purple-300 dark:bg-purple-950/60 dark:text-purple-200 dark:border-purple-800/60 font-semibold'
                        : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60'
                        }`}
                      title="Toggle Admin, Dormant, Startups & Human Resource folder tasks"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className={`size-3.5 rounded border flex items-center justify-center shrink-0 transition-colors ${draftShowAdmin
                            ? 'bg-purple-600 border-purple-500 text-white'
                            : 'border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-transparent'
                            }`}
                        >
                          <Check className="size-2.5" />
                        </div>
                        <Shield className="size-3 text-purple-600 dark:text-purple-400 shrink-0" />
                        <span className="truncate">Admin Tasks</span>
                      </div>
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-purple-100 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/40 shrink-0">
                        {adminCount ?? 0}
                      </span>
                    </button>
                  </div>

                  <div className="h-px bg-zinc-800/80 my-0.5" />

                  {/* List of individual clients with Checkboxes */}
                  <div
                    className="max-h-52 overflow-y-auto custom-scrollbar flex flex-col gap-0.5"
                    onWheel={(e) => e.stopPropagation()}
                    onTouchMove={(e) => e.stopPropagation()}
                  >
                    {filteredClients.length === 0 ? (
                      <p className="text-[11px] text-zinc-500 italic text-center py-2">
                        No clients found
                      </p>
                    ) : (
                      filteredClients.map((client) => {
                        const checked = isClientChecked(client.id, client.name);
                        const isUpwork = upworkClients.some((u) => u.toLowerCase() === client.name.toLowerCase());
                        const isProject = isProjectBasedUpwork(client.name) ||
                          upworkProjectClients.some((u) => u.toLowerCase() === client.name.toLowerCase());

                        return (
                          <div
                            key={client.id}
                            onClick={() => handleToggleClient(client.id)}
                            className={`group w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${checked
                              ? 'bg-zinc-200/70 text-zinc-900 dark:bg-zinc-800/60 dark:text-zinc-100 font-medium'
                              : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/40 hover:text-zinc-900 dark:hover:text-zinc-200'
                              }`}
                          >
                            <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-1">
                              <div
                                className={`size-3.5 rounded border flex items-center justify-center shrink-0 transition-colors ${checked
                                  ? 'bg-blue-600 border-blue-500 text-white'
                                  : 'border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-transparent'
                                  }`}
                              >
                                <Check className="size-2.5" />
                              </div>
                              <span className="truncate" title={client.name}>
                                {client.name}
                              </span>
                              {isUpwork && (
                                <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                                  <span className={`text-[9px] px-1 py-0.2 rounded font-semibold shrink-0 border ${isProject
                                    ? 'bg-purple-100 dark:bg-purple-500/20 text-purple-800 dark:text-purple-300 border-purple-300 dark:border-purple-500/30'
                                    : 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/30'
                                    }`}>
                                    UW
                                  </span>
                                  {isPmOrAdmin ? (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleToggleProjectBased(client.name);
                                      }}
                                      className={`px-1.5 py-0.5 rounded text-[8.5px] font-bold border transition-all cursor-pointer select-none flex items-center gap-1 ${isProject
                                        ? 'bg-purple-950/70 text-purple-200 border-purple-500/40 hover:bg-purple-900/80 shadow-xs'
                                        : 'bg-emerald-950/70 text-emerald-200 border-emerald-500/40 hover:bg-emerald-900/80 shadow-xs'
                                        }`}
                                      title={isProject
                                        ? 'Project-Based (No Upwork conflict). Click to switch to Hourly Rate'
                                        : 'Hourly Rate (Live tracking). Click to switch to Project-Based'
                                      }
                                    >
                                      <span className={`size-1.5 rounded-full ${isProject ? 'bg-purple-400' : 'bg-emerald-400'}`} />
                                      <span>{isProject ? 'PROJECT' : 'HOURLY'}</span>
                                    </button>
                                  ) : (
                                    <span className={`text-[8.5px] px-1 py-0.2 rounded font-medium border ${isProject
                                      ? 'text-purple-300 bg-purple-950/40 border-purple-800/40'
                                      : 'text-emerald-300 bg-emerald-950/40 border-emerald-800/40'
                                      }`}>
                                      {isProject ? 'PROJECT' : 'HOURLY'}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={(e) => handleSelectOnlyClient(client.id, e)}
                                className="opacity-0 group-hover:opacity-100 px-1 py-0.2 text-[9px] text-zinc-400 hover:text-blue-300 hover:bg-blue-950/60 rounded transition-all cursor-pointer"
                                title={`Show only ${client.name}`}
                              >
                                only
                              </button>
                              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-zinc-800/80 text-zinc-400">
                                {client.count}
                              </span>
                            </div>
                          </div>
                        );
                      })
                    )}

                    {/* Admin folder clients section */}
                    {adminClients && adminClients.length > 0 && draftShowAdmin && (
                      <>
                        <div className="h-px bg-purple-900/40 my-1" />
                        <div className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-purple-400 flex items-center gap-1">
                          <Shield className="size-2.5" />
                          <span>Admin Folder Clients</span>
                        </div>
                        {adminClients
                          .filter((ac) => ac.name.toLowerCase().includes(clientSearch.toLowerCase()))
                          .map((ac) => {
                            const checked = isClientChecked(ac.id, ac.name);
                            const isAcUpwork = upworkClients.some((u) => u.toLowerCase() === ac.name.toLowerCase());
                            const isAcProject = isProjectBasedUpwork(ac.name) ||
                              upworkProjectClients.some((u) => u.toLowerCase() === ac.name.toLowerCase());

                            return (
                              <div
                                key={ac.id}
                                onClick={() => handleToggleClient(ac.id)}
                                className={`group w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${checked
                                  ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-200 font-medium'
                                  : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/40 hover:text-zinc-900 dark:hover:text-zinc-200'
                                  }`}
                              >
                                <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-1">
                                  <div
                                    className={`size-3.5 rounded border flex items-center justify-center shrink-0 transition-colors ${checked
                                      ? 'bg-purple-600 border-purple-500 text-white'
                                      : 'border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-transparent'
                                      }`}
                                  >
                                    <Check className="size-2.5" />
                                  </div>
                                  <span className="truncate" title={ac.name}>
                                    {ac.name}
                                  </span>
                                  {isAcUpwork && (
                                    <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                                      <span className={`text-[9px] px-1 py-0.2 rounded font-semibold shrink-0 border ${isAcProject
                                        ? 'bg-purple-500/20 text-purple-300 border-purple-500/30'
                                        : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                                        }`}>
                                        UW
                                      </span>
                                      {isPmOrAdmin ? (
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleToggleProjectBased(ac.name);
                                          }}
                                          className={`px-1.5 py-0.5 rounded text-[8.5px] font-bold border transition-all cursor-pointer select-none flex items-center gap-1 ${isAcProject
                                            ? 'bg-purple-950/70 text-purple-200 border-purple-500/40 hover:bg-purple-900/80 shadow-xs'
                                            : 'bg-emerald-950/70 text-emerald-200 border-emerald-500/40 hover:bg-emerald-900/80 shadow-xs'
                                            }`}
                                          title={isAcProject
                                            ? 'Project-Based (No Upwork conflict). Click to switch to Hourly Rate'
                                            : 'Hourly Rate (Live tracking). Click to switch to Project-Based'
                                          }
                                        >
                                          <span className={`size-1.5 rounded-full ${isAcProject ? 'bg-purple-400' : 'bg-emerald-400'}`} />
                                          <span>{isAcProject ? 'PROJECT' : 'HOURLY'}</span>
                                        </button>
                                      ) : (
                                        <span className={`text-[8.5px] px-1 py-0.2 rounded font-medium border ${isAcProject
                                          ? 'text-purple-300 bg-purple-950/40 border-purple-800/40'
                                          : 'text-emerald-300 bg-emerald-950/40 border-emerald-800/40'
                                          }`}>
                                          {isAcProject ? 'PROJECT' : 'HOURLY'}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <button
                                    type="button"
                                    onClick={(e) => handleSelectOnlyClient(ac.id, e)}
                                    className="opacity-0 group-hover:opacity-100 px-1 py-0.2 text-[9px] text-purple-700 dark:text-purple-400 hover:text-purple-900 dark:hover:text-purple-200 hover:bg-purple-100 dark:hover:bg-purple-950/60 rounded transition-all cursor-pointer"
                                    title={`Show only ${ac.name}`}
                                  >
                                    only
                                  </button>
                                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/40">
                                    {ac.count}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                      </>
                    )}

                    {isAaron && (
                      <>
                        <div className="h-px bg-zinc-800/80 my-1" />
                        <button
                          type="button"
                          onClick={() => {
                            setClientDropdownOpen(false);
                            setUpworkModalOpen(true);
                          }}
                          className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs text-emerald-400 hover:bg-emerald-950/30 transition-colors cursor-pointer font-semibold"
                        >
                          <Briefcase className="size-3.5" />
                          <span>Manage Upwork Clients</span>
                        </button>
                      </>
                    )}
                  </div>

                  {/* Reset Filter Button */}
                  {isClientFiltered && (
                    <>
                      <div className="h-px bg-zinc-800/80 my-0.5" />
                      <button
                        type="button"
                        onClick={handleResetFilter}
                        className="w-full text-center py-1 text-[11px] text-zinc-400 hover:text-white rounded hover:bg-zinc-800/60 transition-colors cursor-pointer"
                      >
                        Reset Client Filter
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* MA Column Queue Sort Toggle */}
            {currentView === 'BOARD' && onMaSortModeChange && (
              <button
                type="button"
                onClick={() => {
                  const next =
                    maSortMode === 'DEFAULT'
                      ? 'QUEUE_DESC'
                      : maSortMode === 'QUEUE_DESC'
                        ? 'QUEUE_ASC'
                        : 'DEFAULT';
                  onMaSortModeChange(next);
                }}
                className={`flex items-center justify-center p-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer shadow-xs select-none ${
                  maSortMode !== 'DEFAULT'
                    ? 'bg-blue-100 hover:bg-blue-200 text-blue-700 border border-blue-300 dark:bg-blue-950/70 dark:hover:bg-blue-950 dark:text-blue-200 dark:border-blue-700/80 shadow-sm'
                    : 'bg-card border border-zinc-800/80 hover:border-zinc-700 text-zinc-400 hover:text-zinc-100'
                }`}
                title={
                  maSortMode === 'QUEUE_DESC'
                    ? 'Sorted by Queued Tasks: Highest first (click for Lowest first)'
                    : maSortMode === 'QUEUE_ASC'
                      ? 'Sorted by Queued Tasks: Lowest first (click for Default)'
                      : 'Sort MA columns by queued tasks count'
                }
              >
                {maSortMode === 'QUEUE_DESC' ? (
                  <ArrowDownWideNarrow className="size-3.5" />
                ) : maSortMode === 'QUEUE_ASC' ? (
                  <ArrowUpNarrowWide className="size-3.5" />
                ) : (
                  <ArrowUpDown className="size-3.5" />
                )}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Upwork Clients Management Modal (Restricted to Aaron) */}
      {upworkModalOpen && isAaron && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => setUpworkModalOpen(false)}
        >
          <div
            className="w-full max-w-md bg-popover border border-zinc-800 rounded-2xl shadow-2xl p-5 flex flex-col gap-4 animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="size-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                  <Briefcase className="size-4 text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-zinc-100">
                    {isAaron ? 'Upwork Clients' : 'Upwork Clients Mode'}
                  </h3>
                  <p className="text-[11px] text-zinc-400">
                    {isAaron
                      ? 'Designate Upwork clients and tracking modes'
                      : 'Toggle Project-Based vs Hourly Rate mode for Upwork clients'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setUpworkModalOpen(false)}
                className="size-7 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Quick Add Custom Client (Restricted to Aaron) */}
            {isAaron && (
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={newUpworkClient}
                    onChange={(e) => setNewUpworkClient(e.target.value)}
                    placeholder="Add client name (e.g. Melinda, ScaleUp)..."
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500 transition-colors"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddNewUpworkClient();
                      }
                    }}
                  />
                </div>
                <button
                  type="button"
                  onClick={handleAddNewUpworkClient}
                  disabled={!newUpworkClient.trim()}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold cursor-pointer transition-colors flex items-center gap-1 shrink-0"
                >
                  <Plus className="size-3.5" />
                  <span>Add</span>
                </button>
              </div>
            )}

            {/* Search filter within known clients */}
            <div className="relative">
              <Search className="size-3 text-zinc-500 absolute left-2.5 top-2.5 pointer-events-none" />
              <input
                type="text"
                value={upworkSearch}
                onChange={(e) => setUpworkSearch(e.target.value)}
                placeholder="Search clients..."
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-7 pr-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            {/* Client List with 1-Click Toggles */}
            <div className="max-h-60 overflow-y-auto custom-scrollbar flex flex-col gap-1 pr-1">
              {displayedClients.length === 0 ? (
                <p className="text-xs text-zinc-500 italic text-center py-4">
                  {isAaron ? 'No clients match search' : 'No Upwork clients found'}
                </p>
              ) : (
                displayedClients.map((client) => {
                  const isUpwork = upworkClients.some((u) => u.toLowerCase() === client.name.toLowerCase());
                  const isProject = isProjectBasedUpwork(client.name) ||
                    upworkProjectClients.some((u) => u.toLowerCase() === client.name.toLowerCase());
                  return (
                    <div
                      key={client.id || client.name}
                      className={`flex items-center justify-between px-3 py-2 rounded-xl border transition-all ${isUpwork
                        ? isProject
                          ? 'bg-purple-950/20 border-purple-500/30'
                          : 'bg-emerald-950/20 border-emerald-500/30'
                        : 'bg-zinc-900/50 border-zinc-800/80 hover:border-zinc-700'
                        }`}
                    >
                      <div className="flex items-center gap-2 truncate pr-2">
                        <Building2 className={`size-3.5 shrink-0 ${isUpwork ? (isProject ? 'text-purple-400' : 'text-emerald-400') : 'text-zinc-500'}`} />
                        <span className={`text-xs font-medium truncate ${isUpwork ? 'text-zinc-100 font-semibold' : 'text-zinc-300'}`}>
                          {client.name}
                        </span>
                      </div>

                      {isUpwork ? (
                        <div className="flex items-center gap-1.5 shrink-0">
                          {/* Toggle Mode: Hourly Rate vs Project-Based (No Conflict) - Visible to PMs */}
                          <button
                            type="button"
                            onClick={() => handleToggleProjectBased(client.name)}
                            className={`px-2 py-0.5 rounded-md text-[9px] font-bold transition-all cursor-pointer border ${isProject
                              ? 'bg-purple-900/50 text-purple-200 border-purple-500/40 hover:bg-purple-800/60'
                              : 'bg-emerald-900/50 text-emerald-200 border-emerald-500/40 hover:bg-emerald-800/60'
                              }`}
                            title={isProject
                              ? 'Project-Based (Output-based): Does NOT cause Upwork conflicts. Click to switch to Hourly Rate'
                              : 'Hourly Rate (Live-tracked): Requires Upwork tracker screenshots. Click to switch to Project-Based'
                            }
                          >
                            {isProject ? 'PROJECT-BASED' : 'HOURLY RATE'}
                          </button>

                          {/* Remove button - Restricted to Aaron */}
                          {isAaron && (
                            <button
                              type="button"
                              onClick={() => handleToggleUpworkClient(client.name)}
                              className="px-2 py-0.5 rounded-md text-[9px] font-bold transition-all cursor-pointer bg-zinc-800 text-zinc-400 hover:text-red-300 hover:bg-red-950/40 border border-zinc-700 hover:border-red-500/30"
                              title="Remove from Upwork clients"
                            >
                              REMOVE
                            </button>
                          )}
                        </div>
                      ) : isAaron ? (
                        <button
                          type="button"
                          onClick={() => handleToggleUpworkClient(client.name)}
                          className="px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 shrink-0"
                        >
                          MARK UPWORK
                        </button>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between pt-2 border-t border-zinc-800/80 text-[11px] text-zinc-400">
              <span>
                {upworkClients.length} clients marked as Upwork ({upworkClients.filter((u) => !isProjectBasedUpwork(u) && !upworkProjectClients.some((p) => p.toLowerCase() === u.toLowerCase())).length} hourly, {upworkClients.filter((u) => isProjectBasedUpwork(u) || upworkProjectClients.some((p) => p.toLowerCase() === u.toLowerCase())).length} project-based)
              </span>
              <button
                type="button"
                onClick={() => setUpworkModalOpen(false)}
                className="px-3 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

