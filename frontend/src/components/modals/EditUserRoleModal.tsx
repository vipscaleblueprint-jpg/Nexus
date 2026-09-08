'use client';

import { useState, useEffect } from 'react';
import { Shield, X, User as UserIcon, Check, Loader2, Star } from 'lucide-react';
import { usersApi } from '@/api/users';
import { getRoles } from '@/api/roles';
import { User, SystemRole, EmploymentType, WorkspaceRole } from '@/lib/types';

interface EditUserRoleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  user: User | null;
}

export function EditUserRoleModal({ isOpen, onClose, onSuccess, user }: EditUserRoleModalProps) {
  const [systemRole, setSystemRole] = useState<SystemRole>('MEMBER');
  const [employmentType, setEmploymentType] = useState<EmploymentType>('FULL_TIME');
  
  const [primaryRole, setPrimaryRole] = useState<string | undefined>();
  const [secondaryRole, setSecondaryRole] = useState<string | undefined>();
  const [tertiaryRole, setTertiaryRole] = useState<string | undefined>();
  const [minorRole, setMinorRole] = useState<string | undefined>();
  
  const [starRating, setStarRating] = useState<number>(1);
  const [isActive, setIsActive] = useState(true);

  const [availableRoles, setAvailableRoles] = useState<WorkspaceRole[]>([]);
  const [loadingRoles, setLoadingRoles] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setLoadingRoles(true);
      getRoles()
        .then(setAvailableRoles)
        .catch((err) => console.error('Failed to load roles', err))
        .finally(() => setLoadingRoles(false));
    }
  }, [isOpen]);

  useEffect(() => {
    if (user) {
      setSystemRole(user.systemRole || 'MEMBER');
      setEmploymentType(user.employmentType || 'FULL_TIME');
      setPrimaryRole(user.primaryRole || undefined);
      setSecondaryRole(user.secondaryRole || undefined);
      setTertiaryRole(user.tertiaryRole || undefined);
      setMinorRole(user.minorRole || undefined);
      setStarRating(user.starRating || 1);
      setIsActive(user.isActive ?? true);
      setError(null);
      setSuccess(false);
    }
  }, [user]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !user) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await usersApi.updateUser(user.id, {
        systemRole,
        employmentType,
        primaryRole: primaryRole || null,
        secondaryRole: secondaryRole || null,
        tertiaryRole: tertiaryRole || null,
        minorRole: minorRole || null,
        starRating,
        isActive,
      });

      setSuccess(true);
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 700);
    } catch (err: any) {
      setError(err?.message || 'Failed to update user role.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-role-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md max-h-[90vh] overflow-y-auto bg-[#18181c] border border-zinc-800 rounded-2xl shadow-2xl text-zinc-100 no-scrollbar"
      >
        {/* Header */}
        <div className="sticky top-0 z-10 px-5 py-4 border-b border-zinc-800/80 flex items-center justify-between bg-zinc-950/90 backdrop-blur">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-zinc-800/80 border border-zinc-700">
              <Shield className="w-4 h-4 text-indigo-400" />
            </div>
            <div>
              <h2 id="edit-role-title" className="text-sm font-bold tracking-tight text-white">
                Edit User Roles & Status
              </h2>
              <p className="text-[11px] text-zinc-400">Modify system role, employment, and status</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* User preview header */}
        <div className="px-5 py-3 bg-zinc-900/40 border-b border-zinc-800/60 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-xs font-bold text-white">
            {user.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="truncate">
            <div className="text-xs font-bold text-white truncate">{user.name}</div>
            <div className="text-[11px] text-zinc-400 truncate">{user.email}</div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          {error && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
              {error}
            </div>
          )}

          {success && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-400" />
              <span>User updated successfully!</span>
            </div>
          )}

          {/* System Role */}
          <div>
            <label className="block text-[11px] font-medium text-zinc-300 mb-1.5">
              System Role
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSystemRole('MEMBER')}
                className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all ${
                  systemRole === 'MEMBER'
                    ? 'bg-zinc-800/90 border-zinc-500 text-white shadow-sm'
                    : 'bg-[#131316] border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                }`}
              >
                <span className="font-semibold text-xs">Member</span>
                <span className="text-[10px] text-zinc-500 mt-0.5">Regular workspace access</span>
              </button>

              <button
                type="button"
                onClick={() => setSystemRole('ADMIN')}
                className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all ${
                  systemRole === 'ADMIN'
                    ? 'bg-yellow-500/10 border-yellow-500/50 text-yellow-200 shadow-sm'
                    : 'bg-[#131316] border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                }`}
              >
                <span className="font-semibold text-xs text-yellow-400 flex items-center gap-1">
                  <Shield className="w-3.5 h-3.5" />
                  Admin
                </span>
                <span className="text-[10px] text-zinc-500 mt-0.5">Full administrative control</span>
              </button>
            </div>
          </div>

          {/* Employment Type */}
          <div>
            <label className="block text-[11px] font-medium text-zinc-300 mb-1.5">
              Employment Type
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { type: 'FULL_TIME' as EmploymentType, label: 'Full Time' },
                { type: 'PART_TIME' as EmploymentType, label: 'Part Time' },
                { type: 'INTERN' as EmploymentType, label: 'Intern' },
              ].map(({ type, label }) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setEmploymentType(type)}
                  className={`py-2 px-2 rounded-xl border text-center font-medium text-xs transition-all ${
                    employmentType === type
                      ? 'bg-zinc-200 text-zinc-950 border-zinc-200 font-semibold shadow'
                      : 'bg-[#131316] border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Roles Group */}
          <div className="p-4 bg-zinc-900/50 border border-zinc-800/80 rounded-2xl space-y-3">
            <h3 className="text-xs font-semibold text-zinc-300 flex items-center gap-2 mb-1">
              <Shield className="w-3.5 h-3.5 text-zinc-400" />
              Job Roles Assignment
            </h3>
            
            <div className="grid grid-cols-2 gap-3">
              {/* Primary Role */}
              <div>
                <label className="block text-[10px] font-medium text-zinc-400 mb-1">
                  Primary Role
                </label>
                <select
                  value={primaryRole || ''}
                  onChange={(e) => setPrimaryRole(e.target.value || undefined)}
                  disabled={loadingRoles}
                  className="w-full bg-[#131316] border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                >
                  <option value="">None / Unassigned</option>
                  {availableRoles.map((r) => (
                    <option key={r.id} value={r.name}>{r.name}</option>
                  ))}
                </select>
              </div>

              {/* Secondary Role */}
              <div>
                <label className="block text-[10px] font-medium text-zinc-400 mb-1">
                  Secondary Role
                </label>
                <select
                  value={secondaryRole || ''}
                  onChange={(e) => setSecondaryRole(e.target.value || undefined)}
                  disabled={loadingRoles}
                  className="w-full bg-[#131316] border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                >
                  <option value="">None / Unassigned</option>
                  {availableRoles.map((r) => (
                    <option key={r.id} value={r.name}>{r.name}</option>
                  ))}
                </select>
              </div>

              {/* Tertiary Role */}
              <div>
                <label className="block text-[10px] font-medium text-zinc-400 mb-1">
                  Tertiary Role
                </label>
                <select
                  value={tertiaryRole || ''}
                  onChange={(e) => setTertiaryRole(e.target.value || undefined)}
                  disabled={loadingRoles}
                  className="w-full bg-[#131316] border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                >
                  <option value="">None / Unassigned</option>
                  {availableRoles.map((r) => (
                    <option key={r.id} value={r.name}>{r.name}</option>
                  ))}
                </select>
              </div>

              {/* Minor Role */}
              <div>
                <label className="block text-[10px] font-medium text-zinc-400 mb-1">
                  Minor Role
                </label>
                <select
                  value={minorRole || ''}
                  onChange={(e) => setMinorRole(e.target.value || undefined)}
                  disabled={loadingRoles}
                  className="w-full bg-[#131316] border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                >
                  <option value="">None / Unassigned</option>
                  {availableRoles.map((r) => (
                    <option key={r.id} value={r.name}>{r.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Star Rating & Status */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <label className="block text-[11px] font-medium text-zinc-300 mb-1.5">
                Rating
              </label>
              <div className="flex items-center gap-1.5 bg-[#131316] border border-zinc-800 rounded-xl px-3 py-2 h-[38px]">
                {[1, 2, 3].map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setStarRating(val)}
                    className="p-0.5 hover:scale-110 transition-transform"
                  >
                    <Star
                      className={`w-4 h-4 ${
                        val <= starRating
                          ? 'text-yellow-400 fill-yellow-400'
                          : 'text-zinc-700 fill-zinc-700'
                      }`}
                    />
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-zinc-300 mb-1.5">
                Account Status
              </label>
              <button
                type="button"
                onClick={() => setIsActive(!isActive)}
                className={`w-full h-[38px] px-3 rounded-xl border text-center font-medium text-xs transition-all ${
                  isActive
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                    : 'bg-zinc-800/80 text-zinc-400 border-zinc-700'
                }`}
              >
                {isActive ? 'Active' : 'Deactivated'}
              </button>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="pt-3 flex items-center justify-end gap-2 border-t border-zinc-800/80">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors font-medium text-xs cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || success}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white hover:bg-zinc-200 disabled:opacity-50 text-zinc-950 font-semibold text-xs transition-colors cursor-pointer"
            >
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{loading ? 'Saving...' : 'Save Changes'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
