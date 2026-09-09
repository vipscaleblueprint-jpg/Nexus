'use client';

import { useState, useEffect } from 'react';
import { Mail, X, Shield, Briefcase, Calendar, Check, Loader2 } from 'lucide-react';
import { invitationsApi } from '@/api/invitations';
import { SystemRole, EmploymentType } from '@/lib/types';

interface AddInvitationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function AddInvitationModal({ isOpen, onClose, onSuccess }: AddInvitationModalProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<SystemRole>('MEMBER');
  const [employmentType, setEmploymentType] = useState<EmploymentType>('FULL_TIME');
  const [expiresInDays, setExpiresInDays] = useState<number>(7);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleClose = () => {
    setEmail('');
    setRole('MEMBER');
    setEmploymentType('FULL_TIME');
    setExpiresInDays(7);
    setError(null);
    setSuccess(false);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !email.includes('@')) {
      setError('Please provide a valid email address.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await invitationsApi.createInvitation({
        email: email.trim().toLowerCase(),
        role,
        employmentType,
        expiresInDays,
      });

      setSuccess(true);
      setTimeout(() => {
        onSuccess();
        handleClose();
      }, 900);
    } catch (err: any) {
      setError(err?.message || 'Failed to send invitation. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-invite-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-[#18181c] border border-zinc-800 rounded-2xl shadow-2xl text-zinc-100 overflow-hidden"
      >
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-zinc-800/80 flex items-center justify-between bg-zinc-950/40">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-zinc-800/80 border border-zinc-700">
              <Mail className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h2 id="add-invite-title" className="text-sm font-bold tracking-tight text-white">
                Add Invitation
              </h2>
              <p className="text-[11px] text-zinc-400">Invite a new member to your workspace</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          {error && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
              {error}
            </div>
          )}

          {success && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-400" />
              <span>Invitation created successfully!</span>
            </div>
          )}

          {/* Email field */}
          <div>
            <label htmlFor="invite-email" className="block text-[11px] font-medium text-zinc-300 mb-1.5">
              Email Address <span className="text-rose-400">*</span>
            </label>
            <input
              id="invite-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. member@company.com"
              className="w-full bg-[#131316] border border-zinc-800 rounded-xl px-3 py-2.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors"
            />
          </div>

          {/* System Role */}
          <div>
            <label className="block text-[11px] font-medium text-zinc-300 mb-1.5">
              System Role
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setRole('MEMBER')}
                className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all ${
                  role === 'MEMBER'
                    ? 'bg-zinc-800/80 border-zinc-500 text-white shadow-sm'
                    : 'bg-[#131316] border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                }`}
              >
                <span className="font-semibold text-xs flex items-center gap-1.5">
                  Member
                </span>
                <span className="text-[10px] text-zinc-500 mt-1">
                  Standard member access
                </span>
              </button>

              <button
                type="button"
                onClick={() => setRole('ADMIN')}
                className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all ${
                  role === 'ADMIN'
                    ? 'bg-yellow-500/10 border-yellow-500/50 text-yellow-200 shadow-sm'
                    : 'bg-[#131316] border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                }`}
              >
                <span className="font-semibold text-xs flex items-center gap-1.5 text-yellow-400">
                  <Shield className="w-3.5 h-3.5" />
                  Admin
                </span>
                <span className="text-[10px] text-zinc-500 mt-1">
                  Full admin & role control
                </span>
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
                  className={`py-2 px-2.5 rounded-xl border text-center font-medium text-xs transition-all ${
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

          {/* Expiration Days */}
          <div>
            <label className="block text-[11px] font-medium text-zinc-300 mb-1.5">
              Expires In
            </label>
            <select
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(Number(e.target.value))}
              className="w-full bg-[#131316] border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
            >
              <option value={3}>3 days</option>
              <option value={7}>7 days (Default)</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
            </select>
          </div>

          {/* Modal Footer */}
          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleClose}
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
              <span>{loading ? 'Sending...' : 'Send Invitation'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
