'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Users,
  Mail,
  Plus,
  MoreHorizontal,
  RefreshCw,
  Trash2,
  Search,
  AlertTriangle,
  Star,
  ExternalLink,
  Pencil,
  Copy,
  Check
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { usersApi } from '@/api/users';
import { invitationsApi } from '@/api/invitations';
import { User, Invitation, WorkspaceRole } from '@/lib/types';
import { AddInvitationModal } from '@/components/modals/AddInvitationModal';
import { EditUserRoleModal } from '@/components/modals/EditUserRoleModal';
import { RolesTab } from '@/components/settings/RolesTab';
import { ConfirmDeleteModal } from '@/components/modals/ConfirmDeleteModal';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { SettingsSkeleton, MemberSkeleton } from '@/components/ui/Skeleton';

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

function formatDateTime(dateStr?: string | Date): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  } catch {
    return '—';
  }
}

function MemberCard({
  user,
  currentUser,
  onEdit,
  onDelete,
  onCopyEmail,
  copiedEmail
}: {
  user: User;
  currentUser: User | null;
  onEdit: (u: User) => void;
  onDelete: (u: User) => void;
  onCopyEmail: (e: string) => void;
  copiedEmail: string | null;
}) {
  const initials = user.name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const roles = [user.primaryRole, user.secondaryRole, user.tertiaryRole, user.minorRole].filter(Boolean) as string[];
  const isCurrent = currentUser?.id === user.id;

  return (
    <div 
      onClick={() => onEdit(user)}
      className="bg-[#18181c] border border-zinc-800/80 rounded-2xl p-4 space-y-3 hover:border-zinc-600 cursor-pointer transition-all shadow-lg relative group"
    >
      {/* Action Menu overlay */}
      <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
        <ActionMenu icon={<MoreHorizontal className="w-4 h-4 text-zinc-400" />}>
          <button
            onClick={() => onEdit(user)}
            className="w-full text-left px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-700/80 hover:text-white flex items-center gap-2 transition-colors cursor-pointer"
          >
            <Pencil className="w-3.5 h-3.5 text-zinc-400" />
            Edit Roles
          </button>
          <button
            onClick={() => onCopyEmail(user.email)}
            className="w-full text-left px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-700/80 hover:text-white flex items-center gap-2 transition-colors cursor-pointer"
          >
            {copiedEmail === user.email ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-zinc-400" />
            )}
            Copy Email
          </button>
          {!isCurrent && (
            <button
              onClick={() => onDelete(user)}
              className="w-full text-left px-3 py-2 text-xs text-rose-400 hover:bg-rose-500/20 hover:text-rose-300 flex items-center gap-2 transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-400" />
              Remove User
            </button>
          )}
        </ActionMenu>
      </div>

      {/* Header */}
      <div className="flex items-start gap-3">
        {user.avatarUrl ? (
          <img src={user.avatarUrl} alt={user.name} className="w-10 h-10 rounded-full object-cover shrink-0" />
        ) : (
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-sm font-bold text-white shrink-0">
            {initials}
          </div>
        )}
        <div className="min-w-0 flex-1 pr-6">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-bold text-white truncate">{user.name} {isCurrent && '(You)'}</span>
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
              onClick={(e) => e.stopPropagation()}
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

export default function UsersSettingsPage() {
  const router = useRouter();
  const { currentUser } = useAppStore();

  const [users, setUsers] = useState<User[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'users' | 'roles'>('users');

  // Modals state
  const [isAddInviteOpen, setIsAddInviteOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [deletingUser, setDeletingUser] = useState<User | null>(null);
  const [revokingInvite, setRevokingInvite] = useState<Invitation | null>(null);

  const [showAllInvites, setShowAllInvites] = useState(false);

  const loadData = async () => {
    try {
      const [usersRes, invitesRes] = await Promise.all([
        usersApi.getUsers(),
        invitationsApi.getInvitations().catch(() => ({ invitations: [] })),
      ]);
      setUsers(usersRes.users || []);
      setInvitations(invitesRes.invitations || []);
    } catch (err) {
      console.error('Failed to load users or invitations:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCopyEmail = (email: string) => {
    navigator.clipboard.writeText(email);
    setCopiedEmail(email);
    setTimeout(() => setCopiedEmail(null), 2000);
  };

  const handleResendInvite = async (inviteId: string) => {
    try {
      await invitationsApi.resendInvitation(inviteId);
      loadData();
    } catch (err) {
      console.error('Failed to resend invite:', err);
    }
  };

  const handleConfirmDeleteUser = async () => {
    if (!deletingUser) return;
    try {
      await usersApi.deleteUser(deletingUser.id);
      setDeletingUser(null);
      loadData();
    } catch (err) {
      console.error('Failed to delete user:', err);
    }
  };

  const handleConfirmRevokeInvite = async () => {
    if (!revokingInvite) return;
    try {
      await invitationsApi.revokeInvitation(revokingInvite.id);
      setRevokingInvite(null);
      loadData();
    } catch (err) {
      console.error('Failed to revoke invitation:', err);
    }
  };

  // If user is loaded and not an admin, block access
  if (currentUser && currentUser.systemRole !== 'ADMIN') {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-2xl mb-3">
          <AlertTriangle className="w-8 h-8 text-amber-400" />
        </div>
        <h2 className="text-lg font-bold text-white mb-1">Access Restricted</h2>
        <p className="text-xs text-zinc-400 max-w-sm mb-4">
          You must have the <strong className="text-yellow-400">ADMIN</strong> system role to manage workspace users and invitations.
        </p>
        <button
          onClick={() => router.push('/')}
          className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
        >
          Return to Workspace
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-8 w-full max-w-7xl mx-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 mb-8">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
            <MemberSkeleton key={i} />
          ))}
        </div>
        <SettingsSkeleton />
      </div>
    );
  }

  const filteredUsers = users.filter(
    (u) =>
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      u.name.toLowerCase().includes(search.toLowerCase())
  );

  const sortedUsers = [...filteredUsers].sort((a, b) => {
    if (a.systemRole === 'ADMIN' && b.systemRole !== 'ADMIN') return -1;
    if (b.systemRole === 'ADMIN' && a.systemRole !== 'ADMIN') return 1;
    return a.name.localeCompare(b.name);
  });

  const displayedInvites = showAllInvites ? invitations : invitations.slice(0, 5);

  return (
    <div className="p-8 w-full max-w-7xl mx-auto space-y-8 font-sans">
      
      {/* Header and Search */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-2">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-zinc-400" />
            Users & Roles
          </h1>
          <p className="text-zinc-500 text-sm mt-0.5">Manage workspace members, invitations, and custom roles.</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex space-x-1 border-b border-zinc-800/80 mb-6">
        <button
          onClick={() => setActiveTab('users')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'users'
              ? 'border-indigo-500 text-indigo-400'
              : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
          }`}
        >
          Users & Invitations
        </button>
        <button
          onClick={() => setActiveTab('roles')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'roles'
              ? 'border-indigo-500 text-indigo-400'
              : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
          }`}
        >
          Role Management
        </button>
      </div>

      {activeTab === 'users' && (
        <div className="space-y-8">
          <div className="flex justify-end">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input
                type="text"
                placeholder="Search members..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 pr-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 w-64"
              />
            </div>
          </div>

      {/* Grid */}
      {sortedUsers.length === 0 ? (
        <div className="flex items-center justify-center py-20 text-zinc-600 text-sm">No members found.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {sortedUsers.map((user) => (
            <MemberCard 
              key={user.id} 
              user={user} 
              currentUser={currentUser}
              onEdit={(u) => setEditingUser(u)} 
              onDelete={(u) => setDeletingUser(u)}
              onCopyEmail={handleCopyEmail}
              copiedEmail={copiedEmail}
            />
          ))}
        </div>
      )}

      {/* Bottom Section: Invitations Card */}
      <div className="bg-[#18181c] border border-zinc-800/80 rounded-2xl overflow-hidden shadow-2xl mt-8">
        {/* Card Header */}
        <div className="px-6 py-4 border-b border-zinc-800/80 bg-zinc-950/30 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
              <Mail className="w-4 h-4 text-zinc-400" />
              Invitations
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Create invitations to your organization.
            </p>
          </div>
          <button
            onClick={() => setIsAddInviteOpen(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white hover:bg-zinc-200 text-zinc-950 font-semibold text-xs transition-colors shadow cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-zinc-950" />
            <span>Add Invitation</span>
          </button>
        </div>

        {/* Invitations Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-zinc-800/80 text-zinc-400 font-semibold text-[11px] bg-zinc-900/20">
                <th className="px-6 py-3.5 font-medium">Email</th>
                <th className="px-6 py-3.5 font-medium">Role</th>
                <th className="px-6 py-3.5 font-medium">Status</th>
                <th className="px-6 py-3.5 font-medium">Expires At</th>
                <th className="px-6 py-3.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {invitations.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-zinc-500 italic">
                    No active invitations. Click "+ Add Invitation" to invite a team member.
                  </td>
                </tr>
              ) : (
                displayedInvites.map((invite) => {
                  const status = invite.status?.toLowerCase() || 'pending';
                  const isExpired =
                    status === 'expired' ||
                    (invite.expiresAt && new Date(invite.expiresAt) < new Date());

                  return (
                    <tr
                      key={invite.id}
                      className="hover:bg-zinc-800/30 transition-colors group"
                    >
                      {/* Email */}
                      <td className="px-6 py-4 text-zinc-200 font-mono text-xs">
                        {invite.email}
                      </td>

                      {/* Role */}
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium tracking-wide bg-zinc-800 text-zinc-200 border border-zinc-700">
                          {invite.role?.toLowerCase() || 'member'}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${
                            status === 'accepted'
                              ? 'bg-zinc-200 text-zinc-950 border-zinc-300 font-semibold'
                              : status === 'pending' && !isExpired
                              ? 'bg-blue-500/10 text-blue-300 border-blue-500/20'
                              : 'bg-zinc-800/80 text-zinc-500 border-zinc-700/60'
                          }`}
                        >
                          {isExpired && status !== 'accepted' ? 'expired' : status}
                        </span>
                      </td>

                      {/* Expires At */}
                      <td className="px-6 py-4 text-zinc-400 text-xs font-mono">
                        {formatDateTime(invite.expiresAt)}{' '}
                        {isExpired && status !== 'accepted' && (
                          <span className="text-zinc-500 font-sans">(Expired)</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-6 py-4 text-right">
                        <ActionMenu icon={<MoreHorizontal className="w-4 h-4 text-zinc-400" />}>
                          <button
                            onClick={() => handleResendInvite(invite.id)}
                            className="w-full text-left px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-700/80 hover:text-white flex items-center gap-2 cursor-pointer transition-colors"
                          >
                            <RefreshCw className="w-3.5 h-3.5 text-zinc-400" />
                            Resend / Extend
                          </button>
                          <button
                            onClick={() => setRevokingInvite(invite)}
                            className="w-full text-left px-3 py-2 text-xs text-rose-400 hover:bg-rose-500/20 hover:text-rose-300 flex items-center gap-2 cursor-pointer transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                            Revoke Invitation
                          </button>
                        </ActionMenu>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Card Footer: See all */}
        {invitations.length > 5 && (
          <div className="px-6 py-4 border-t border-zinc-800/80 flex items-center justify-between bg-zinc-950/30">
            <button
              onClick={() => setShowAllInvites(!showAllInvites)}
              className="text-xs text-zinc-400 hover:text-white font-medium transition-colors cursor-pointer"
            >
              {showAllInvites ? 'Show fewer invitations' : 'See all invitations'}
            </button>
          </div>
        )}
      </div>
      </div>
      )}

      {activeTab === 'roles' && <RolesTab />}

      {/* Modals */}
      <AddInvitationModal
        isOpen={isAddInviteOpen}
        onClose={() => setIsAddInviteOpen(false)}
        onSuccess={loadData}
      />

      <EditUserRoleModal
        isOpen={!!editingUser}
        onClose={() => setEditingUser(null)}
        onSuccess={loadData}
        user={editingUser}
      />

      <ConfirmDeleteModal
        isOpen={!!deletingUser}
        onClose={() => setDeletingUser(null)}
        onConfirm={handleConfirmDeleteUser}
        title="Remove User"
        itemName={deletingUser?.name || deletingUser?.email || 'User'}
      />

      <ConfirmDeleteModal
        isOpen={!!revokingInvite}
        onClose={() => setRevokingInvite(null)}
        onConfirm={handleConfirmRevokeInvite}
        title="Revoke Invitation"
        itemName={`invitation for ${revokingInvite?.email || 'user'}`}
      />
    </div>
  );
}
