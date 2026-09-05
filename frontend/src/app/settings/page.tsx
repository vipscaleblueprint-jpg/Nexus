'use client';

import { useState, useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { authApi } from '@/api/auth';
import { Settings, User as UserIcon, Lock, Star, Eye, EyeOff } from 'lucide-react';

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3].map((n) => (
        <Star
          key={n}
          className={`w-3.5 h-3.5 ${n <= rating ? 'text-yellow-400 fill-yellow-400' : 'text-zinc-700 fill-zinc-700'}`}
        />
      ))}
      <span className="ml-1.5 text-sm text-zinc-300">{rating}</span>
    </div>
  );
}

export default function SettingsPage() {
  const { currentUser, setCurrentUser } = useAppStore();

  const [name, setName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [dailySheetUrl, setDailySheetUrl] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Fetch current user if not yet in store (e.g. direct navigation to /settings)
  useEffect(() => {
    if (!currentUser) {
      authApi.getMe().then(({ user }) => setCurrentUser(user)).catch(() => {});
    }
  }, []);

  // Populate form fields whenever currentUser is available/changes
  useEffect(() => {
    if (currentUser) {
      setName(currentUser.name || '');
      setAvatarUrl(currentUser.avatarUrl || '');
      setDailySheetUrl(currentUser.dailySheetUrl || '');
    }
  }, [currentUser]);

  const handleSaveProfile = async () => {
    setProfileSaving(true);
    setProfileMsg(null);
    try {
      const res = await authApi.updateProfile({ name, avatarUrl, dailySheetUrl });
      setCurrentUser(res.user);
      setProfileMsg({ type: 'success', text: 'Profile updated successfully.' });
    } catch (e: any) {
      setProfileMsg({ type: 'error', text: e?.message || 'Failed to update profile.' });
    } finally {
      setProfileSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!newPassword || newPassword.length < 6) {
      setPwMsg({ type: 'error', text: 'New password must be at least 6 characters.' });
      return;
    }
    setPwSaving(true);
    setPwMsg(null);
    try {
      await authApi.changePassword({ currentPassword, newPassword });
      setPwMsg({ type: 'success', text: 'Password changed successfully.' });
      setCurrentPassword('');
      setNewPassword('');
    } catch (e: any) {
      setPwMsg({ type: 'error', text: e?.message || 'Failed to change password.' });
    } finally {
      setPwSaving(false);
    }
  };

  return (
    <div className="p-8 w-full">
      {/* Page title */}
      <div className="max-w-[660px] mx-auto mb-8">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Settings className="w-6 h-6" />
          Account Settings
        </h1>
        <p className="text-zinc-500 text-sm mt-1">Manage your profile details and sign-in credentials.</p>
      </div>

      <div className="max-w-[660px] mx-auto space-y-5">

        {/* ── Account (read-only) ── */}
        <div className="border border-zinc-800 rounded-xl overflow-hidden">
          {/* Section header */}
          <div className="px-5 pt-4 pb-3 flex items-center gap-2">
            <UserIcon className="w-4 h-4 text-zinc-400" />
            <h2 className="text-sm font-semibold text-zinc-200">Account</h2>
          </div>

          {/* Rows */}
          <div className="divide-y divide-zinc-800/70">
            <div className="flex items-center justify-between px-5 py-3">
              <span className="text-sm text-zinc-500">Email</span>
              <span className="text-sm text-zinc-300">{currentUser?.email}</span>
            </div>
            <div className="flex items-center justify-between px-5 py-3">
              <span className="text-sm text-zinc-500">System Role</span>
              <span className="text-xs font-bold uppercase tracking-wider text-yellow-400">
                {currentUser?.systemRole}
              </span>
            </div>
            <div className="flex items-center justify-between px-5 py-3">
              <span className="text-sm text-zinc-500">Employment</span>
              <span className="text-sm font-medium text-zinc-300">{currentUser?.employmentType}</span>
            </div>
            <div className="flex items-center justify-between px-5 py-3">
              <span className="text-sm text-zinc-500">Star Rating</span>
              <StarRating rating={currentUser?.starRating ?? 0} />
            </div>
          </div>

          <p className="px-5 py-3 text-[11px] text-zinc-600 italic border-t border-zinc-800/70">
            Role, employment type and rating are set by an administrator.
          </p>
        </div>

        {/* ── Profile (editable) ── */}
        <div className="border border-zinc-800 rounded-xl overflow-hidden">
          <div className="px-5 pt-4 pb-3">
            <h2 className="text-sm font-semibold text-zinc-200">Profile</h2>
          </div>

          <div className="px-5 pb-5 space-y-4">
            {/* Display Name */}
            <div>
              <label className="block text-[12px] text-zinc-400 mb-1.5">Display Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700/60 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500 transition-colors"
              />
            </div>

            {/* Avatar URL */}
            <div>
              <label className="block text-[12px] text-zinc-400 mb-1.5">Avatar URL</label>
              <input
                type="text"
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                placeholder="https://..."
                className="w-full bg-zinc-900 border border-zinc-700/60 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors"
              />
            </div>

            {/* Daily Sheet URL */}
            <div>
              <label className="block text-[12px] text-zinc-400 mb-1.5">
                Google Daily Sheet URL
              </label>
              <input
                type="text"
                value={dailySheetUrl}
                onChange={(e) => setDailySheetUrl(e.target.value)}
                placeholder="https://docs.google.com/..."
                className="w-full bg-zinc-900 border border-zinc-700/60 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors"
              />
            </div>

            {profileMsg && (
              <p className={`text-xs ${profileMsg.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                {profileMsg.text}
              </p>
            )}

            <button
              onClick={handleSaveProfile}
              disabled={profileSaving}
              className="w-full py-2.5 bg-zinc-100 hover:bg-white disabled:opacity-50 text-zinc-900 text-sm font-semibold rounded-lg transition-colors"
            >
              {profileSaving ? 'Saving...' : 'Save Profile'}
            </button>
          </div>
        </div>

        {/* ── Password ── */}
        <div className="border border-zinc-800 rounded-xl overflow-hidden">
          <div className="px-5 pt-4 pb-3 flex items-center gap-2">
            <Lock className="w-4 h-4 text-zinc-400" />
            <h2 className="text-sm font-semibold text-zinc-200">Password</h2>
          </div>

          <div className="px-5 pb-5 space-y-4">
            {/* Current Password */}
            <div>
              <label className="block text-[12px] text-zinc-400 mb-1.5">Current Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" />
                <input
                  type={showCurrent ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                  className="w-full bg-zinc-900 border border-zinc-700/60 rounded-lg pl-9 pr-10 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent(!showCurrent)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400"
                >
                  {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* New Password */}
            <div>
              <label className="block text-[12px] text-zinc-400 mb-1.5">
                New Password <span className="text-zinc-600">(min. 6 characters)</span>
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" />
                <input
                  type={showNew ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                  className="w-full bg-zinc-900 border border-zinc-700/60 rounded-lg pl-9 pr-10 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowNew(!showNew)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400"
                >
                  {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {pwMsg && (
              <p className={`text-xs ${pwMsg.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                {pwMsg.text}
              </p>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
