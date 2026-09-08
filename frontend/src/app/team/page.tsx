'use client';

import { useState, useEffect } from 'react';
import { usersApi } from '@/api/users';
import { User } from '@/lib/types';
import { Users, Star, ExternalLink, Search, Shield } from 'lucide-react';
import { MemberSkeleton } from '@/components/ui/Skeleton';

const ROLE_COLORS: Record<string, string> = {
  PM: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
  DESIGNER: 'bg-pink-500/20 text-pink-300 border-pink-500/30',
  TECH: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  CRM: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  AUDITOR: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  ADMIN: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
};

const EMPLOYMENT_LABEL: Record<string, string> = {
  FULL_TIME: 'FULL_TIME',
  PART_TIME: 'PART_TIME',
  INTERN: 'INTERN',
  CONTRACTOR: 'CONTRACTOR',
};

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3].map((n) => (
        <Star
          key={n}
          className={`w-3 h-3 ${n <= rating ? 'text-yellow-400 fill-yellow-400' : 'text-zinc-700 fill-zinc-700'}`}
        />
      ))}
    </div>
  );
}

function MemberCard({ user }: { user: User }) {
  const initials = user.name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const roles = [user.primaryRole, user.secondaryRole, user.tertiaryRole, user.minorRole].filter(Boolean) as string[];

  return (
    <div className="bg-[#18181c] border border-zinc-800/80 rounded-2xl p-4 space-y-3 hover:border-zinc-700/80 transition-all shadow-lg">
      {/* Header */}
      <div className="flex items-start gap-3">
        {user.avatarUrl ? (
          <img src={user.avatarUrl} alt={user.name} className="w-10 h-10 rounded-full object-cover shrink-0" />
        ) : (
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-sm font-bold text-white shrink-0">
            {initials}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-bold text-white truncate">{user.name}</span>
            {user.systemRole === 'ADMIN' && (
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">
                ADMIN
              </span>
            )}
          </div>
          <p className="text-[11px] text-zinc-500 truncate">{user.email}</p>
        </div>
      </div>

      {/* Roles */}
      {roles.length > 0 ? (
        <div className="flex items-center flex-wrap gap-1.5">
          {roles.map((role) => (
            <span key={role} className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${ROLE_COLORS[role] ?? 'bg-zinc-700 text-zinc-300 border-zinc-600'}`}>
              {role}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-zinc-600 italic">No job roles assigned</p>
      )}

      {/* Stats */}
      <div className="space-y-1.5 pt-1 border-t border-zinc-800/60">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-zinc-500">Employment</span>
          <span className="text-zinc-300 font-medium">{EMPLOYMENT_LABEL[user.employmentType] ?? user.employmentType}</span>
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-zinc-500">Rating</span>
          <StarRating rating={user.starRating} />
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-zinc-500">Daily Sheet</span>
          {user.dailySheetUrl ? (
            <a
              href={user.dailySheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-blue-400 hover:text-blue-300 transition-colors"
            >
              Open <ExternalLink className="w-3 h-3" />
            </a>
          ) : (
            <span className="text-zinc-600">None</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TeamPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    usersApi.getUsers().then((res) => {
      setUsers(res.users || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const filtered = users.filter((u) =>
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase())
  );

  // Sort: admins first, then alphabetically
  const sorted = [...filtered].sort((a, b) => {
    if (a.systemRole === 'ADMIN' && b.systemRole !== 'ADMIN') return -1;
    if (b.systemRole === 'ADMIN' && a.systemRole !== 'ADMIN') return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="p-6 w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-zinc-400" />
            Member Directory
          </h1>
          <p className="text-zinc-500 text-sm mt-0.5">View and manage workspace members.</p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            placeholder="Search members..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 w-56"
          />
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
            <MemberSkeleton key={i} />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <div className="flex items-center justify-center py-20 text-zinc-600 text-sm">No members found.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {sorted.map((user) => (
            <MemberCard key={user.id} user={user} />
          ))}
        </div>
      )}
    </div>
  );
}
