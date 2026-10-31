'use client';

import { useState, useEffect, useMemo } from 'react';
import { getRoleMap, RoleMapEntry, RoleMember } from '@/api/roles';
import {
  Users,
  Search,
  Building,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  X,
  Layers,
  ArrowUpDown,
} from 'lucide-react';

interface RoleTheme {
  bg: string;
  text: string;
  border: string;
}

function getRoleTheme(roleName: string): RoleTheme {
  const norm = (roleName || '').toLowerCase().trim();

  // Strategy / Funnel
  if (norm.includes('funnel strategist') || (norm.includes('strategist') && !norm.includes('audit'))) {
    return {
      bg: 'bg-red-600 dark:bg-red-700',
      text: 'text-white',
      border: 'border-red-700/60 dark:border-red-600/60',
    };
  }
  if (norm.includes('funnel auditor')) {
    return {
      bg: 'bg-blue-600 dark:bg-blue-700',
      text: 'text-white',
      border: 'border-blue-700/60 dark:border-blue-600/60',
    };
  }
  if (norm.includes('funnel builder')) {
    return {
      bg: 'bg-amber-700 dark:bg-amber-800',
      text: 'text-white',
      border: 'border-amber-800/60 dark:border-amber-700/60',
    };
  }

  // Audits
  if (norm.includes('instruction audit')) {
    return {
      bg: 'bg-sky-500 dark:bg-sky-600',
      text: 'text-white',
      border: 'border-sky-600/60 dark:border-sky-500/60',
    };
  }
  if (norm.includes('ui ux') || norm.includes('ui/ux')) {
    return {
      bg: 'bg-blue-500 dark:bg-blue-600',
      text: 'text-white',
      border: 'border-blue-600/60 dark:border-blue-500/60',
    };
  }
  if (norm.includes('design audit')) {
    return {
      bg: 'bg-slate-700 dark:bg-slate-800',
      text: 'text-white',
      border: 'border-slate-800/60 dark:border-slate-700/60',
    };
  }

  // Design
  if (norm === 'design' || norm.includes('motion') || norm.includes('3d design')) {
    return {
      bg: 'bg-purple-600 dark:bg-purple-700',
      text: 'text-white',
      border: 'border-purple-700/60 dark:border-purple-600/60',
    };
  }

  // Project Managers & Management
  if (norm.includes('project manager') || norm.includes('pm')) {
    return {
      bg: 'bg-amber-500 dark:bg-amber-600',
      text: 'text-white',
      border: 'border-amber-600/60 dark:border-amber-500/60',
    };
  }
  if (norm.includes('client relationship') || norm.includes('relationship')) {
    return {
      bg: 'bg-slate-600 dark:bg-slate-700',
      text: 'text-white',
      border: 'border-slate-700/60 dark:border-slate-600/60',
    };
  }

  // Development
  if (norm.includes('back-end') || norm.includes('backend')) {
    return {
      bg: 'bg-emerald-700 dark:bg-emerald-800',
      text: 'text-white',
      border: 'border-emerald-800/60 dark:border-emerald-700/60',
    };
  }
  if (norm.includes('dev ops') || norm.includes('devops')) {
    return {
      bg: 'bg-zinc-700 dark:bg-zinc-800',
      text: 'text-white',
      border: 'border-zinc-800/60 dark:border-zinc-700/60',
    };
  }
  if (norm.includes('developer')) {
    return {
      bg: 'bg-lime-700 dark:bg-lime-800',
      text: 'text-white',
      border: 'border-lime-800/60 dark:border-lime-700/60',
    };
  }
  if (norm.includes('cybersecurity')) {
    return {
      bg: 'bg-teal-700 dark:bg-teal-800',
      text: 'text-white',
      border: 'border-teal-800/60 dark:border-teal-700/60',
    };
  }
  if (norm.includes('harmony')) {
    return {
      bg: 'bg-fuchsia-600 dark:bg-fuchsia-700',
      text: 'text-white',
      border: 'border-fuchsia-700/60 dark:border-fuchsia-600/60',
    };
  }

  // Marketing & Sales & Ops
  if (norm.includes('marketing')) {
    return {
      bg: 'bg-fuchsia-700 dark:bg-fuchsia-800',
      text: 'text-white',
      border: 'border-fuchsia-800/60 dark:border-fuchsia-700/60',
    };
  }
  if (norm.includes('sales')) {
    return {
      bg: 'bg-green-600 dark:bg-green-700',
      text: 'text-white',
      border: 'border-green-700/60 dark:border-green-600/60',
    };
  }
  if (norm.includes('lead generation')) {
    return {
      bg: 'bg-cyan-600 dark:bg-cyan-700',
      text: 'text-white',
      border: 'border-cyan-700/60 dark:border-cyan-600/60',
    };
  }
  if (norm.includes('production')) {
    return {
      bg: 'bg-zinc-700 dark:bg-zinc-800',
      text: 'text-white',
      border: 'border-zinc-800/60 dark:border-zinc-700/60',
    };
  }
  if (norm.includes('ai scene')) {
    return {
      bg: 'bg-zinc-900 dark:bg-black',
      text: 'text-white',
      border: 'border-zinc-800',
    };
  }

  return {
    bg: 'bg-[var(--accent)]',
    text: 'text-[var(--on-accent)]',
    border: 'border-[var(--accent)]/60',
  };
}

function MemberAvatar({ name, avatarUrl }: { name: string; avatarUrl?: string | null }) {
  const [imgError, setImgError] = useState(false);
  const initials = (name || '')
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  if (avatarUrl && !imgError) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        onError={() => setImgError(true)}
        className="w-5 h-5 rounded-full object-cover shrink-0 ring-1 ring-border/50"
      />
    );
  }

  return (
    <div className="w-5 h-5 rounded-full bg-[var(--accent)]/20 text-[var(--accent)] text-[10px] font-bold flex items-center justify-center shrink-0">
      {initials || '?'}
    </div>
  );
}

export default function RoleMapPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [roles, setRoles] = useState<RoleMapEntry[]>([]);
  const [unassigned, setUnassigned] = useState<RoleMember[]>([]);

  // Filtering states
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'workspace' | 'teamrole'>('all');
  const [selectedTeam, setSelectedTeam] = useState<string>('all');
  const [hideEmpty, setHideEmpty] = useState(false);
  const [sortBy, setSortBy] = useState<'members' | 'name' | 'team'>('members');

  const loadRoleMap = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getRoleMap();
      if (data && Array.isArray(data.roles)) {
        setRoles(data.roles);
        setUnassigned(data.unassignedMembers || []);
      }
    } catch (e: any) {
      setError(e?.message || 'Unable to load role map.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRoleMap();
  }, []);

  // Distinct list of teams for team filter dropdown
  const teamOptions = useMemo(() => {
    const set = new Set<string>();
    roles.forEach((r) => {
      if (r.teamName) set.add(r.teamName);
    });
    return Array.from(set).sort();
  }, [roles]);

  // Clean, deduplicate members and apply filters
  const filteredRoles = useMemo(() => {
    const q = search.trim().toLowerCase();

    const result = roles
      .map((role) => {
        // Deduplicate members by name
        const seen = new Set<string>();
        const uniqueMembers = (role.members || []).filter((m) => {
          const key = (m.name || m.id || '').trim().toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        return {
          ...role,
          members: uniqueMembers,
          memberCount: uniqueMembers.length,
        };
      })
      .filter((role) => {
        // Type filter
        if (filterType !== 'all' && role.type !== filterType) {
          return false;
        }

        // Team filter
        if (selectedTeam !== 'all') {
          if (!role.teamName || role.teamName !== selectedTeam) {
            return false;
          }
        }

        // Hide empty roles filter
        if (hideEmpty && role.memberCount === 0) {
          return false;
        }

        // Search filter
        if (q) {
          const matchesRole = role.name.toLowerCase().includes(q);
          const matchesTeam = role.teamName?.toLowerCase().includes(q);
          const matchesMember = role.members.some((m) =>
            m.name.toLowerCase().includes(q)
          );
          if (!matchesRole && !matchesTeam && !matchesMember) {
            return false;
          }
        }

        return true;
      });

    // Sorting
    result.sort((a, b) => {
      if (sortBy === 'members') {
        if (b.memberCount !== a.memberCount) {
          return b.memberCount - a.memberCount;
        }
        return a.name.localeCompare(b.name);
      }
      if (sortBy === 'team') {
        const teamA = a.teamName || 'ZZZ';
        const teamB = b.teamName || 'ZZZ';
        const cmp = teamA.localeCompare(teamB);
        if (cmp !== 0) return cmp;
        return a.name.localeCompare(b.name);
      }
      return a.name.localeCompare(b.name);
    });

    return result;
  }, [roles, search, filterType, selectedTeam, hideEmpty, sortBy]);

  const totalAssignedSlots = useMemo(
    () => roles.reduce((acc, r) => acc + (r.members?.length || 0), 0),
    [roles]
  );

  const uniqueAssignedUsersCount = useMemo(() => {
    const set = new Set<string>();
    roles.forEach((r) => {
      r.members?.forEach((m) => {
        if (m.name) set.add(m.name.toLowerCase());
      });
    });
    return set.size;
  }, [roles]);

  return (
    <div className="flex-1 overflow-y-auto bg-background text-foreground min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 md:py-8 space-y-6">
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-border">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">Role Map</h1>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20">
                Directory
              </span>
            </div>
            <p className="text-xs text-muted-foreground max-w-xl">
              Vertical directory showing active team members assigned to each role.
            </p>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
            {/* Quick Stats Pill */}
            <div className="hidden lg:flex items-center gap-3 px-3 py-1.5 rounded-xl bg-card border border-border text-xs">
              <span className="text-muted-foreground">
                <strong className="text-foreground">{roles.length}</strong> roles
              </span>
              <span className="text-border">•</span>
              <span className="text-muted-foreground">
                <strong className="text-foreground">{totalAssignedSlots}</strong> placements
              </span>
              <span className="text-border">•</span>
              <span className="text-muted-foreground">
                <strong className="text-foreground">{uniqueAssignedUsersCount}</strong> members
              </span>
            </div>

            <button
              onClick={loadRoleMap}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary hover:bg-accent text-foreground text-xs font-semibold border border-border transition-colors cursor-pointer disabled:opacity-50"
              title="Refresh role mappings"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh Map</span>
            </button>
          </div>
        </div>

        {/* Filter and Search Toolbar */}
        <div className="p-4 rounded-2xl bg-card border border-border shadow-xs space-y-3">
          <div className="flex flex-col md:flex-row items-center justify-between gap-3">
            {/* Search Input */}
            <div className="relative w-full md:w-80">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                placeholder="Search by role or member name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-8 py-2 bg-background border border-border rounded-xl text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 transition-colors shadow-2xs"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Role Type Filter Tabs */}
            <div className="flex items-center gap-1 p-1 bg-secondary/60 border border-border rounded-xl w-full md:w-auto">
              <button
                onClick={() => setFilterType('all')}
                className={`flex-1 md:flex-initial px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  filterType === 'all'
                    ? 'bg-[var(--accent)] text-[var(--on-accent)] shadow-xs'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                }`}
              >
                All Roles ({roles.length})
              </button>
              <button
                onClick={() => setFilterType('teamrole')}
                className={`flex-1 md:flex-initial px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  filterType === 'teamrole'
                    ? 'bg-[var(--accent)] text-[var(--on-accent)] shadow-xs'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                }`}
              >
                Team Roles
              </button>
              <button
                onClick={() => setFilterType('workspace')}
                className={`flex-1 md:flex-initial px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  filterType === 'workspace'
                    ? 'bg-[var(--accent)] text-[var(--on-accent)] shadow-xs'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                }`}
              >
                Workspace
              </button>
            </div>
          </div>

          {/* Secondary Filters: Team Selector, Empty Role Toggle, Sort */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2.5 border-t border-border/70 text-xs">
            {/* Team Dropdown & Empty Filter */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-muted-foreground font-medium flex items-center gap-1 shrink-0">
                <Building className="w-3.5 h-3.5 text-muted-foreground" />
                Team:
              </span>
              <select
                value={selectedTeam}
                onChange={(e) => setSelectedTeam(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg bg-background border border-border text-foreground font-medium focus:outline-none focus:border-[var(--accent)] cursor-pointer shadow-2xs"
              >
                <option value="all">All Teams ({teamOptions.length})</option>
                {teamOptions.map((team) => (
                  <option key={team} value={team}>
                    {team}
                  </option>
                ))}
              </select>

              {/* Toggle: Hide Empty Roles */}
              <button
                onClick={() => setHideEmpty(!hideEmpty)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-semibold transition-colors cursor-pointer ${
                  hideEmpty
                    ? 'bg-[var(--accent)]/10 text-[var(--accent)] border-[var(--accent)]/30'
                    : 'bg-background text-muted-foreground border-border hover:text-foreground hover:bg-secondary'
                }`}
              >
                <CheckCircle2 className={`w-3.5 h-3.5 ${hideEmpty ? 'text-[var(--accent)]' : 'text-muted-foreground'}`} />
                <span>Assigned Only</span>
              </button>
            </div>

            {/* Sort Selector */}
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground font-medium flex items-center gap-1">
                <ArrowUpDown className="w-3 h-3 text-muted-foreground" />
                Sort:
              </span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="px-2.5 py-1.5 rounded-lg bg-background border border-border text-foreground font-medium focus:outline-none focus:border-[var(--accent)] cursor-pointer shadow-2xs"
              >
                <option value="members">Most Members</option>
                <option value="name">Role Name (A-Z)</option>
                <option value="team">Team Name</option>
              </select>
            </div>
          </div>
        </div>

        {/* Main Content: Vertical Table (Role is dominant on the left, User names only on the right) */}
        {loading ? (
          <div className="flex flex-col items-center justify-center p-16 space-y-3">
            <RefreshCw className="w-7 h-7 text-[var(--accent)] animate-spin" />
            <p className="text-xs text-muted-foreground">Compiling active role mappings...</p>
          </div>
        ) : error ? (
          <div className="p-6 rounded-2xl bg-destructive/10 border border-destructive/20 text-center space-y-3 max-w-md mx-auto">
            <AlertCircle className="w-8 h-8 text-destructive mx-auto" />
            <p className="text-sm font-semibold text-destructive">{error}</p>
            <button
              onClick={loadRoleMap}
              className="px-4 py-2 bg-destructive text-destructive-foreground text-xs font-semibold rounded-lg transition-colors cursor-pointer"
            >
              Retry Connection
            </button>
          </div>
        ) : filteredRoles.length === 0 ? (
          <div className="p-16 rounded-2xl bg-card border border-border text-center space-y-2">
            <Users className="w-8 h-8 text-muted-foreground/60 mx-auto" />
            <p className="text-sm font-medium text-foreground">No matching roles found</p>
            <p className="text-xs text-muted-foreground">Try adjusting your search query or filters.</p>
          </div>
        ) : (
          <div className="w-full overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-border bg-secondary/50 text-xs font-bold text-muted-foreground uppercase tracking-wider select-none">
                    <th className="py-2.5 px-4 w-56 sm:w-64 min-w-[190px] border-r border-border sticky left-0 bg-secondary/95 backdrop-blur-xs z-10">
                      Role
                    </th>
                    <th className="py-2.5 px-4 min-w-[300px]">
                      Assigned Team Members
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredRoles.map((role) => {
                    const theme = getRoleTheme(role.name);

                    return (
                      <tr
                        key={role.id}
                        className="hover:bg-secondary/30 transition-colors group"
                      >
                        {/* Left Column: Role */}
                        <td className="py-2.5 px-4 w-56 sm:w-64 min-w-[190px] align-middle border-r border-border bg-card group-hover:bg-secondary/40 sticky left-0 z-10 transition-colors">
                          <div
                            className={`inline-flex items-center px-3 py-1 rounded-lg text-sm font-bold tracking-tight border shadow-xs select-none whitespace-nowrap ${theme.bg} ${theme.text} ${theme.border}`}
                          >
                            {role.name}
                          </div>
                        </td>

                        {/* Right Column: User Names and Profile Pictures */}
                        <td className="py-2.5 px-4 align-middle">
                          {role.members.length === 0 ? (
                            <span className="text-xs sm:text-sm text-muted-foreground/80 italic">
                              No members assigned yet
                            </span>
                          ) : (
                            <div className="flex flex-wrap items-center gap-2">
                              {role.members.map((member) => (
                                <div
                                  key={member.id}
                                  className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-secondary/80 hover:bg-secondary border border-border/80 hover:border-[var(--accent)]/50 text-[13px] sm:text-sm font-semibold text-foreground shadow-xs transition-all select-none cursor-default"
                                  title={`Assigned to ${role.name}`}
                                >
                                  <MemberAvatar name={member.name} avatarUrl={member.avatarUrl} />
                                  <span>{member.name}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Unassigned Active Members */}
        {!loading && unassigned.length > 0 && (
          <div className="p-4 sm:p-5 rounded-2xl bg-card border border-border shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm sm:text-base font-bold text-foreground">
                  Unassigned Active Members ({unassigned.length})
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Active members without any assigned workspace or team roles.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              {unassigned.map((member) => (
                <div
                  key={member.id}
                  className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-secondary/70 border border-border text-[13px] sm:text-sm font-semibold text-muted-foreground shadow-xs"
                >
                  <MemberAvatar name={member.name} avatarUrl={member.avatarUrl} />
                  <span>{member.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
