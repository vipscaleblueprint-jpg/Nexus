'use client';

import { useEffect, useState } from 'react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { useAppStore } from '@/lib/store';
import { authApi } from '@/api';
import { User } from '@/lib/types';
import {
  Lock,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  User as UserIcon,
  Star,
  Loader2,
} from 'lucide-react';

type Feedback = { kind: 'error' | 'success'; text: string } | null;

export default function SettingsPage() {
  const { currentUser, setCurrentUser } = useAppStore();
  const [isLoadingUser, setIsLoadingUser] = useState(!currentUser);

  // Password form
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [passwordFeedback, setPasswordFeedback] = useState<Feedback>(null);

  // The page can be opened directly, so it cannot rely on another route
  // having populated the store first.
  useEffect(() => {
    if (currentUser) return;

    let cancelled = false;
    (async () => {
      try {
        const { user } = await authApi.getMe();
        if (!cancelled && user) setCurrentUser(user);
      } catch (e) {
        console.warn('No active session found:', e);
      } finally {
        if (!cancelled) setIsLoadingUser(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentUser, setCurrentUser]);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordFeedback(null);

    if (newPassword.length < 6) {
      setPasswordFeedback({ kind: 'error', text: 'New password must be at least 6 characters long.' });
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordFeedback({ kind: 'error', text: 'New password and confirmation do not match.' });
      return;
    }

    setIsSavingPassword(true);

    try {
      const res = await authApi.changePassword({
        currentPassword: currentPassword || undefined,
        newPassword,
      });
      setPasswordFeedback({
        kind: 'success',
        text: res.message || 'Password updated. A confirmation email was sent.',
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPasswordFeedback({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Failed to update password.',
      });
    } finally {
      setIsSavingPassword(false);
    }
  };

  const inputClass =
    'w-full bg-[#131316] border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-700 transition-colors';

  const passwordInputClass =
    'w-full bg-[#131316] border border-zinc-800 rounded-xl pl-9 pr-10 py-2 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-700 transition-colors';

  return (
    <div className="flex h-screen bg-[#131316] text-[#e4e4e7] overflow-hidden font-sans">
      <Sidebar />

      <div className="flex-1 flex flex-col h-screen overflow-hidden bg-[#131316]">
        <Header />

        <main className="flex-1 overflow-y-auto p-6">
          {isLoadingUser ? (
            <div className="h-full flex items-center justify-center text-xs text-zinc-400 gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-zinc-300" />
              <span>Loading account...</span>
            </div>
          ) : !currentUser ? (
            <div className="h-full flex items-center justify-center text-xs text-zinc-400">
              You must be signed in to view account settings.
            </div>
          ) : (
            <div className="max-w-2xl mx-auto space-y-6">
              <div className="border-b border-zinc-800/60 pb-4">
                <h1 className="text-lg font-bold text-zinc-100">Account Settings</h1>
                <p className="text-xs text-zinc-400 mt-1">
                  Manage your profile details and sign-in credentials.
                </p>
              </div>

              {/* Read-only identity */}
              <section className="bg-zinc-900/40 border border-zinc-800/80 rounded-2xl p-5 space-y-3">
                <h2 className="text-xs font-bold text-zinc-200 flex items-center gap-2">
                  <UserIcon className="w-3.5 h-3.5 text-indigo-400" />
                  Account
                </h2>

                <dl className="text-xs space-y-2">
                  <div className="flex justify-between py-1 border-b border-zinc-800/60">
                    <dt className="text-zinc-400">Email</dt>
                    <dd className="text-zinc-200">{currentUser.email}</dd>
                  </div>
                  <div className="flex justify-between py-1 border-b border-zinc-800/60">
                    <dt className="text-zinc-400">System Role</dt>
                    <dd className="font-mono text-[10px] text-zinc-300 bg-zinc-900 px-1.5 py-0.5 rounded">
                      {currentUser.systemRole}
                    </dd>
                  </div>
                  <div className="flex justify-between py-1 border-b border-zinc-800/60">
                    <dt className="text-zinc-400">Employment</dt>
                    <dd className="font-mono text-[10px] text-zinc-300 bg-zinc-900 px-1.5 py-0.5 rounded">
                      {currentUser.employmentType}
                    </dd>
                  </div>
                  <div className="flex justify-between py-1">
                    <dt className="text-zinc-400">Star Rating</dt>
                    <dd className="text-amber-400 font-bold flex items-center gap-1">
                      <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                      {currentUser.starRating ?? 1}
                    </dd>
                  </div>
                </dl>

                <p className="text-[10px] text-zinc-500">
                  Role, employment type and rating are set by an administrator.
                </p>
              </section>

              <ProfileForm
                key={currentUser.id}
                user={currentUser}
                onSaved={setCurrentUser}
                inputClass={inputClass}
              />

              {/* Password */}
              <section className="bg-zinc-900/40 border border-zinc-800/80 rounded-2xl p-5">
                <h2 className="text-xs font-bold text-zinc-200 mb-4 flex items-center gap-2">
                  <Lock className="w-3.5 h-3.5 text-emerald-400" />
                  Password
                </h2>

                <form onSubmit={handleChangePassword} className="space-y-4">
                  {passwordFeedback && <FeedbackBanner feedback={passwordFeedback} />}

                  <PasswordField
                    id="currentPassword"
                    label="Current Password"
                    value={currentPassword}
                    onChange={setCurrentPassword}
                    show={showCurrent}
                    onToggle={() => setShowCurrent(!showCurrent)}
                    placeholder="Enter current password"
                    className={passwordInputClass}
                  />

                  <PasswordField
                    id="newPassword"
                    label="New Password (min. 6 characters)"
                    value={newPassword}
                    onChange={setNewPassword}
                    show={showNew}
                    onToggle={() => setShowNew(!showNew)}
                    placeholder="Enter new password"
                    required
                    className={passwordInputClass}
                  />

                  <PasswordField
                    id="confirmPassword"
                    label="Confirm New Password"
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    show={showConfirm}
                    onToggle={() => setShowConfirm(!showConfirm)}
                    placeholder="Confirm new password"
                    required
                    className={passwordInputClass}
                  />

                  <button
                    type="submit"
                    disabled={isSavingPassword}
                    className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-2.5 px-4 rounded-xl text-xs transition-all shadow-md cursor-pointer disabled:opacity-50"
                  >
                    {isSavingPassword ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Updating Password...</span>
                      </>
                    ) : (
                      <span>Save New Password</span>
                    )}
                  </button>
                </form>
              </section>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function FeedbackBanner({ feedback }: { feedback: NonNullable<Feedback> }) {
  const isError = feedback.kind === 'error';
  return (
    <div
      role="status"
      className={`p-3 rounded-xl text-xs flex items-center gap-2 border ${
        isError
          ? 'bg-rose-950/80 border-rose-900/80 text-rose-300'
          : 'bg-emerald-950/80 border-emerald-900/80 text-emerald-300'
      }`}
    >
      {isError ? (
        <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
      ) : (
        <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
      )}
      <span>{feedback.text}</span>
    </div>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  show,
  onToggle,
  placeholder,
  required,
  className,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
  placeholder: string;
  required?: boolean;
  className: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-[11px] font-medium text-zinc-400 block mb-1">
        {label}
      </label>
      <div className="relative">
        <Lock className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5" />
        <input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          className={className}
        />
        <button
          type="button"
          onClick={onToggle}
          aria-label={show ? 'Hide password' : 'Show password'}
          className="absolute right-3 top-2.5 text-zinc-500 hover:text-zinc-300"
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

/**
 * Rendered with `key={user.id}` so its state initialises straight from props.
 * Seeding it from an effect instead would set state during render commit.
 */
function ProfileForm({
  user,
  onSaved,
  inputClass,
}: {
  user: User;
  onSaved: (user: User) => void;
  inputClass: string;
}) {
  const [name, setName] = useState(user.name ?? '');
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl ?? '');
  const [dailySheetUrl, setDailySheetUrl] = useState(user.dailySheetUrl ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setIsSaving(true);

    try {
      // The server validates these as URLs, so send them only when non-empty.
      const { user: updated } = await authApi.updateProfile({
        name: name.trim() || undefined,
        avatarUrl: avatarUrl.trim() || undefined,
        dailySheetUrl: dailySheetUrl.trim() || undefined,
      });
      onSaved(updated);
      setFeedback({ kind: 'success', text: 'Profile updated.' });
    } catch (err) {
      setFeedback({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Failed to update profile.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="bg-zinc-900/40 border border-zinc-800/80 rounded-2xl p-5">
      <h2 className="text-xs font-bold text-zinc-200 mb-4">Profile</h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        {feedback && <FeedbackBanner feedback={feedback} />}

        <div>
          <label htmlFor="name" className="text-[11px] font-medium text-zinc-400 block mb-1">
            Display Name
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="avatarUrl" className="text-[11px] font-medium text-zinc-400 block mb-1">
            Avatar URL
          </label>
          <input
            id="avatarUrl"
            type="url"
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
            placeholder="https://..."
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="dailySheetUrl" className="text-[11px] font-medium text-zinc-400 block mb-1">
            Google Daily Sheet URL
          </label>
          <input
            id="dailySheetUrl"
            type="url"
            value={dailySheetUrl}
            onChange={(e) => setDailySheetUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/..."
            className={inputClass}
          />
        </div>

        <button
          type="submit"
          disabled={isSaving}
          className="w-full flex items-center justify-center gap-2 bg-zinc-200 hover:bg-white text-zinc-950 font-semibold py-2.5 px-4 rounded-xl text-xs transition-all shadow-md cursor-pointer disabled:opacity-50"
        >
          {isSaving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Saving...</span>
            </>
          ) : (
            <span>Save Profile</span>
          )}
        </button>
      </form>
    </section>
  );
}
