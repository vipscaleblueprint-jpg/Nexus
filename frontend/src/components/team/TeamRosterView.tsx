'use client';

import { useState } from 'react';
import { User } from '@/lib/types';
import { Users, ExternalLink, Search, Star } from 'lucide-react';

interface TeamRosterViewProps {
  users: User[];
  isLoading?: boolean;
}

const ROLE_FILTERS = [
  { value: 'ALL', label: 'All Roles' },
  { value: 'ADMIN', label: 'Admins Only' },
  { value: 'PM', label: 'PMs Only' },
  { value: 'TECH', label: 'Tech / Engineers' },
  { value: 'DESIGNER', label: 'Designers' },
  { value: 'CRM', label: 'CRM' },
  { value: 'AUDITOR', label: 'Auditors' },
];

export function TeamRosterView({ users, isLoading = false }: TeamRosterViewProps) {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');

  const filteredUsers = users.filter((u) => {
    const term = searchTerm.toLowerCase();
    const matchesSearch =
      u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term);

    const matchesRole =
      roleFilter === 'ALL' || u.primaryRole === roleFilter || u.systemRole === roleFilter;

    return matchesSearch && matchesRole;
  });

  return (
    <div className="flex-1 bg-[#131316] text-[#e4e4e7] flex flex-col p-6 overflow-y-auto">
      {/* Header Bar */}
      <div className="flex items-start justify-between gap-4 mb-6 border-b border-zinc-800/60 pb-4 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-zinc-100 flex items-center gap-2">
            <Users className="w-5 h-5 text-indigo-400" />
            Member Directory
            {!isLoading && (
              <span className="text-xs font-medium text-zinc-400">
                ({users.length} {users.length === 1 ? 'member' : 'members'})
              </span>
            )}
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Roles, employment classifications, star ratings, and Google Daily Sheets.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-[#18181c] border border-zinc-800/80 px-3 py-1.5 rounded-lg text-xs">
            <Search className="w-3.5 h-3.5 text-zinc-400" />
            <input
              type="text"
              placeholder="Filter name or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              disabled={isLoading}
              aria-label="Filter members by name or email"
              className="bg-transparent text-zinc-200 outline-none placeholder-zinc-500 w-44 disabled:opacity-50"
            />
          </div>

          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            disabled={isLoading}
            aria-label="Filter members by role"
            className="bg-[#18181c] border border-zinc-800/80 text-zinc-200 rounded-lg px-3 py-1.5 text-xs outline-none disabled:opacity-50"
          >
            {ROLE_FILTERS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isLoading ? (
        <MemberCardGrid>
          {Array.from({ length: 8 }).map((_, i) => (
            <MemberCardSkeleton key={i} />
          ))}
        </MemberCardGrid>
      ) : filteredUsers.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-xs text-zinc-400">
          {users.length === 0
            ? 'No members yet.'
            : 'No members match the current filters.'}
        </div>
      ) : (
        <MemberCardGrid>
          {filteredUsers.map((user) => (
            <MemberCard key={user.id} user={user} />
          ))}
        </MemberCardGrid>
      )}
    </div>
  );
}

function MemberCardGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(260px,1fr))]">{children}</div>
  );
}

function MemberCard({ user }: { user: User }) {
  return (
    <article className="bg-[#18181c] border border-zinc-800/60 rounded-xl p-4 shadow-lg flex flex-col gap-3 hover:border-zinc-700/80 transition-colors">
      {/* Identity */}
      <div className="flex items-center gap-3 min-w-0">
        {user.imageUrl || user.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.imageUrl || user.avatarUrl}
            alt=""
            className="w-10 h-10 rounded-full object-cover border border-zinc-700 shrink-0"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-zinc-800 border border-zinc-700 font-bold text-zinc-100 flex items-center justify-center text-xs shrink-0">
            {user.name.slice(0, 2).toUpperCase()}
          </div>
        )}

        <div className="min-w-0">
          <h2 className="font-semibold text-zinc-100 text-sm truncate flex items-center gap-1.5">
            <span className="truncate">{user.name}</span>
            {user.systemRole === 'ADMIN' && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-200 text-zinc-950 font-extrabold shrink-0">
                ADMIN
              </span>
            )}
          </h2>
          <p className="text-[11px] text-zinc-400 truncate">{user.email}</p>
        </div>
      </div>

      {/* Roles */}
      <div className="flex items-center gap-1 flex-wrap">
        {user.primaryRole && (
          <span className="px-2 py-0.5 rounded bg-blue-950/80 text-blue-300 border border-blue-800/60 text-[10px] font-semibold">
            {user.primaryRole}
          </span>
        )}
        {user.secondaryRole && (
          <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[10px]">
            {user.secondaryRole}
          </span>
        )}
        {!user.primaryRole && !user.secondaryRole && (
          <span className="text-[10px] text-zinc-500 italic">No job roles assigned</span>
        )}
      </div>

      {/* Meta */}
      <dl className="text-[11px] space-y-1.5 border-t border-zinc-800/60 pt-3 mt-auto">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-zinc-400">Employment</dt>
          <dd className="font-mono text-[10px] text-zinc-300 bg-zinc-900 px-1.5 py-0.5 rounded">
            {user.employmentType}
          </dd>
        </div>

        <div className="flex items-center justify-between gap-2">
          <dt className="text-zinc-400">Rating</dt>
          <dd className="text-amber-400 font-bold flex items-center gap-0.5">
            {Array.from({ length: user.starRating || 1 }).map((_, i) => (
              <Star key={i} className="w-3 h-3 fill-amber-400 text-amber-400" />
            ))}
          </dd>
        </div>

        <div className="flex items-center justify-between gap-2">
          <dt className="text-zinc-400">Daily Sheet</dt>
          <dd className="truncate">
            {user.dailySheetUrl ? (
              <a
                href={user.dailySheetUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 font-medium hover:underline"
              >
                <span>Open</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            ) : (
              <span className="text-zinc-500 italic">None</span>
            )}
          </dd>
        </div>
      </dl>
    </article>
  );
}

function MemberCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="bg-[#18181c] border border-zinc-800/60 rounded-xl p-4 shadow-lg flex flex-col gap-3 animate-pulse"
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-zinc-800 shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-3 bg-zinc-800 rounded w-2/3" />
          <div className="h-2.5 bg-zinc-800/70 rounded w-full" />
        </div>
      </div>

      <div className="flex gap-1">
        <div className="h-4 w-14 bg-zinc-800 rounded" />
        <div className="h-4 w-10 bg-zinc-800/70 rounded" />
      </div>

      <div className="space-y-2 border-t border-zinc-800/60 pt-3">
        <div className="h-2.5 bg-zinc-800/70 rounded w-full" />
        <div className="h-2.5 bg-zinc-800/70 rounded w-5/6" />
        <div className="h-2.5 bg-zinc-800/70 rounded w-3/4" />
      </div>
    </div>
  );
}
