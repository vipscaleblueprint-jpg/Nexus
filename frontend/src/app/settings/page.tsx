'use client';

import { useState, useEffect, useRef } from 'react';
import { useAppStore } from '@/lib/store';
import { authApi, usersApi } from '@/api';
import { API_BASE_URL } from '@/api/client';
import { Settings, User as UserIcon, Lock, Star, Eye, EyeOff, UploadCloud, Loader2, Code, Plus, Check, Copy, Trash2, Book } from 'lucide-react';
import { SettingsSkeleton } from '@/components/ui/Skeleton';
import { toast } from '@/lib/toast';
import { ApiDocsSection } from '@/components/settings/ApiDocsSection';
import { ConfirmDeleteModal } from '@/components/modals/ConfirmDeleteModal';

interface ApiKey {
  id: string;
  name: string;
  key: string;
  createdAt: string;
  lastUsed: string | null;
}

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

  const [loading, setLoading] = useState(!currentUser);
  
  // Profile State
  const [name, setName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [dailySheetUrl, setDailySheetUrl] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // Password State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);

  // API Keys State
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [newKeyName, setNewKeyName] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [keyToDelete, setKeyToDelete] = useState<ApiKey | null>(null);

  // Scrollspy Refs
  const profileRef = useRef<HTMLDivElement>(null);
  const passwordRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<HTMLDivElement>(null);
  const docsRef = useRef<HTMLDivElement>(null);
  const [activeSection, setActiveSection] = useState('profile');

  // Load user
  useEffect(() => {
    if (!currentUser) {
      authApi.getMe()
        .then(({ user }) => setCurrentUser(user))
        .catch(() => {})
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
      loadApiKeys(currentUser.id);
    }
  }, []);

  // Populate profile fields
  useEffect(() => {
    if (currentUser) {
      setName(currentUser.name || '');
      setAvatarUrl(currentUser.avatarUrl || '');
      setDailySheetUrl(currentUser.dailySheetUrl || '');
      setLoading(false);
      loadApiKeys(currentUser.id);
    }
  }, [currentUser]);

  // Scrollspy observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        });
      },
      { rootMargin: '-20% 0px -80% 0px' }
    );

    if (profileRef.current) observer.observe(profileRef.current);
    if (passwordRef.current) observer.observe(passwordRef.current);
    if (apiRef.current) observer.observe(apiRef.current);
    if (docsRef.current) observer.observe(docsRef.current);

    return () => observer.disconnect();
  }, []);

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // Profile Methods
  const handleSaveProfile = async () => {
    setProfileSaving(true);
    try {
      const res = await authApi.updateProfile({ name, avatarUrl, dailySheetUrl });
      setCurrentUser(res.user);
      toast.success('Profile updated successfully.');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to update profile.');
    } finally {
      setProfileSaving(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Avatar file size cannot exceed 2MB');
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', 'avatars');

      const res = await fetch(`${API_BASE_URL}/upload/avatar`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: formData
      });

      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();
      setAvatarUrl(data.url);
      setCurrentUser(data.user);
      toast.success("Avatar updated successfully.");
    } catch (error: any) {
      toast.error('Failed to upload avatar.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileUpload(e.target.files[0]);
    }
  };

  // Password Methods
  const handleChangePassword = async () => {
    if (!newPassword || newPassword.length < 6) {
      toast.error('New password must be at least 6 characters.');
      return;
    }
    setPwSaving(true);
    try {
      await authApi.changePassword({ currentPassword, newPassword });
      toast.success('Password changed successfully.');
      setCurrentPassword('');
      setNewPassword('');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to change password.');
    } finally {
      setPwSaving(false);
    }
  };

  // API Methods
  const loadApiKeys = async (userId: string) => {
    try {
      setLoadingKeys(true);
      const res = await usersApi.getApiKeys(userId);
      setApiKeys(res.apiKeys);
    } catch (err: any) {
      toast.error('Failed to load API keys');
    } finally {
      setLoadingKeys(false);
    }
  };

  const handleCreateApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim() || !currentUser) return;
    try {
      const res = await usersApi.createApiKey(currentUser.id, newKeyName.trim());
      setApiKeys([res.apiKey, ...apiKeys]);
      setNewKeyName('');
      toast.success('API Key created successfully');
    } catch (err: any) {
      toast.error('Failed to create API key');
    }
  };

  const handleDeleteApiKey = async (keyId: string) => {
    if (!currentUser) return;
    try {
      await usersApi.deleteApiKey(currentUser.id, keyId);
      setApiKeys(apiKeys.filter(k => k.id !== keyId));
      toast.success('API Key revoked');
      setKeyToDelete(null);
    } catch (err: any) {
      toast.error('Failed to revoke API key');
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  if (loading) {
    return <SettingsSkeleton />;
  }

  return (
    <div className="flex w-full h-full bg-[#0a0a0a] overflow-hidden">
      {/* Settings Sidebar (Scrollspy) */}
      <div className="w-64 shrink-0 bg-[#121212] border-r border-zinc-800 flex flex-col">
        <div className="p-4 border-b border-zinc-800">
          <h1 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
            <Settings className="w-4 h-4 text-zinc-400" />
            Settings
          </h1>
        </div>
        <nav className="flex-1 overflow-y-auto p-3 space-y-1 custom-scrollbar">
          <button
            onClick={() => scrollToSection('profile')}
            className={`flex items-center gap-2 px-3 py-2 w-full text-left rounded-lg text-sm transition-colors ${
              activeSection === 'profile'
                ? 'bg-zinc-800/80 text-white font-medium'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
            }`}
          >
            <UserIcon className={`w-4 h-4 ${activeSection === 'profile' ? 'text-indigo-400' : 'text-zinc-500'}`} />
            Profile
          </button>
          
          <button
            onClick={() => scrollToSection('password')}
            className={`flex items-center gap-2 px-3 py-2 w-full text-left rounded-lg text-sm transition-colors ${
              activeSection === 'password'
                ? 'bg-zinc-800/80 text-white font-medium'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
            }`}
          >
            <Lock className={`w-4 h-4 ${activeSection === 'password' ? 'text-indigo-400' : 'text-zinc-500'}`} />
            Password
          </button>
          
          <button
            onClick={() => scrollToSection('api')}
            className={`flex items-center gap-2 px-3 py-2 w-full text-left rounded-lg text-sm transition-colors ${
              activeSection === 'api'
                ? 'bg-zinc-800/80 text-white font-medium'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
            }`}
          >
            <Code className={`w-4 h-4 ${activeSection === 'api' ? 'text-indigo-400' : 'text-zinc-500'}`} />
            API Integrations
          </button>
          
          <button
            onClick={() => scrollToSection('docs')}
            className={`flex items-center gap-2 px-3 py-2 w-full text-left rounded-lg text-sm transition-colors ${
              activeSection === 'docs'
                ? 'bg-zinc-800/80 text-white font-medium'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
            }`}
          >
            <Book className={`w-4 h-4 ${activeSection === 'docs' ? 'text-indigo-400' : 'text-zinc-500'}`} />
            API Documentation
          </button>
        </nav>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 h-full overflow-y-auto custom-scrollbar bg-[#0a0a0a]">
        <div className="max-w-[700px] mx-auto py-10 px-8 pb-32 space-y-12">
          
          <div className="mb-4">
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              Account Settings
            </h1>
            <p className="text-zinc-500 text-sm mt-1">Manage your profile details, security, and integrations.</p>
          </div>

          {/* PROFILE SECTION */}
          <section id="profile" ref={profileRef} className="scroll-mt-8 space-y-6">
            <div className="bg-[#121214] border border-zinc-800 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-zinc-800 bg-[#151518]">
                <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                  <UserIcon className="w-4 h-4 text-zinc-400" />
                  Account Profile
                </h2>
              </div>
              <div className="p-6">
                {/* Read Only Stats */}
                <div className="bg-zinc-900/50 rounded-lg p-4 border border-zinc-800 mb-6 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-500">Email</span>
                    <span className="text-sm text-zinc-300">{currentUser?.email}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-500">System Role</span>
                    <span className="text-xs font-bold uppercase tracking-wider text-yellow-400">
                      {currentUser?.systemRole}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-500">Employment</span>
                    <span className="text-sm font-medium text-zinc-300">{currentUser?.employmentType || 'N/A'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-500">Star Rating</span>
                    <StarRating rating={currentUser?.starRating || 1} />
                  </div>
                </div>

                <div className="space-y-5">
                  <div className="flex items-start gap-6">
                    {/* Avatar Upload */}
                    <div className="shrink-0">
                      <label className="block text-[12px] text-zinc-400 mb-1.5">Avatar Image</label>
                      <label className="relative w-16 h-16 rounded-full overflow-hidden bg-zinc-800 border border-zinc-700 flex items-center justify-center cursor-pointer group block">
                        {avatarUrl ? (
                          <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
                        ) : (
                          <UserIcon className="w-6 h-6 text-zinc-500" />
                        )}
                        
                        {/* Hover Overlay */}
                        <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <UploadCloud className="w-4 h-4 text-zinc-100 drop-shadow-md mb-0.5" />
                          <span className="text-[10px] font-medium text-zinc-100 drop-shadow-md leading-none">Upload</span>
                        </div>

                        {/* Loading Overlay */}
                        {isUploading && (
                          <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-10">
                            <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />
                          </div>
                        )}
                        
                        <input 
                          type="file" 
                          className="hidden" 
                          accept="image/*"
                          onChange={handleFileChange}
                          disabled={isUploading}
                        />
                      </label>
                    </div>

                    {/* Display Name Input */}
                    <div className="flex-1">
                      <label className="block text-[12px] text-zinc-400 mb-1.5">Display Name</label>
                      <input
                        type="text"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        maxLength={100}
                        className="w-full bg-[#18181b] border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-600 transition-colors"
                      />
                      <div className="flex justify-between items-start mt-1.5 px-1">
                        <span className="text-[11px] text-zinc-500">This name will be displayed across your workspace.</span>
                        <span className="text-[10px] text-zinc-500 font-medium">{name.length}/100</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[12px] text-zinc-400 mb-1.5">Google Daily Sheet URL</label>
                    <input
                      type="text"
                      value={dailySheetUrl}
                      onChange={e => setDailySheetUrl(e.target.value)}
                      className="w-full bg-[#18181b] border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-600 transition-colors"
                    />
                  </div>

                  <div className="pt-2">
                    <button
                      onClick={handleSaveProfile}
                      disabled={profileSaving}
                      className="w-full py-2 bg-zinc-100 hover:bg-white text-zinc-900 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
                    >
                      {profileSaving ? 'Saving...' : 'Save Profile'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* PASSWORD SECTION */}
          <section id="password" ref={passwordRef} className="scroll-mt-8 space-y-6">
            <div className="bg-[#121214] border border-zinc-800 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-zinc-800 bg-[#151518]">
                <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                  <Lock className="w-4 h-4 text-zinc-400" />
                  Password
                </h2>
              </div>
              <div className="p-6 space-y-5">
                <div>
                  <label className="block text-[12px] text-zinc-400 mb-1.5">Current Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 w-4 h-4 text-zinc-600" />
                    <input
                      type={showCurrent ? 'text' : 'password'}
                      value={currentPassword}
                      onChange={e => setCurrentPassword(e.target.value)}
                      placeholder="Enter current password"
                      className="w-full bg-[#18181b] border border-zinc-800 rounded-lg pl-9 pr-10 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-600 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrent(!showCurrent)}
                      className="absolute right-3 top-2.5 text-zinc-500 hover:text-zinc-300"
                    >
                      {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[12px] text-zinc-400 mb-1.5">
                    New Password <span className="text-zinc-600 font-normal">(min. 6 characters)</span>
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 w-4 h-4 text-zinc-600" />
                    <input
                      type={showNew ? 'text' : 'password'}
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      placeholder="Enter new password"
                      className="w-full bg-[#18181b] border border-zinc-800 rounded-lg pl-9 pr-10 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-600 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNew(!showNew)}
                      className="absolute right-3 top-2.5 text-zinc-500 hover:text-zinc-300"
                    >
                      {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    onClick={handleChangePassword}
                    disabled={pwSaving || !currentPassword || !newPassword}
                    className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
                  >
                    {pwSaving ? 'Updating...' : 'Update Password'}
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* API INTEGRATIONS SECTION */}
          <section id="api" ref={apiRef} className="scroll-mt-8 space-y-6">
            <div className="bg-[#121214] border border-zinc-800 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-zinc-800 bg-[#151518]">
                <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                  <Code className="w-4 h-4 text-zinc-400" />
                  API Integrations
                </h2>
              </div>
              <div className="p-6">
                
                {/* Generate New Key Form */}
                <form onSubmit={handleCreateApiKey} className="flex gap-2 mb-8">
                  <input
                    type="text"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    placeholder="Key Name (e.g., n8n Automation)"
                    className="flex-1 bg-[hsl(240,3.7%,15.9%)] border border-transparent rounded-lg px-3 py-2 text-sm text-[hsl(240,4.8%,95.9%)] focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all placeholder:text-[hsl(240,5%,64.9%)]"
                  />
                  <button
                    type="submit"
                    disabled={!newKeyName.trim()}
                    className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-2 whitespace-nowrap"
                  >
                    <Plus className="size-4" />
                    Generate Key
                  </button>
                </form>

                {/* Keys List */}
                <div className="space-y-3">
                  {loadingKeys ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                    </div>
                  ) : apiKeys.length === 0 ? (
                    <div className="text-center py-8 border border-dashed border-[hsl(240,3.7%,15.9%)] rounded-lg">
                      <Code className="size-8 text-[hsl(240,5%,64.9%)] mx-auto mb-3" />
                      <p className="text-sm text-[hsl(240,5%,64.9%)]">No API keys generated yet.</p>
                    </div>
                  ) : (
                    apiKeys.map(key => (
                      <div key={key.id} className="p-4 bg-[hsl(240,5.9%,10%)] border border-[hsl(240,3.7%,15.9%)] rounded-lg">
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <h4 className="text-sm font-medium text-[hsl(240,4.8%,95.9%)]">{key.name}</h4>
                            <p className="text-xs text-[hsl(240,5%,64.9%)] mt-0.5">
                              Created {new Date(key.createdAt).toLocaleDateString()}
                            </p>
                          </div>
                          <button
                            onClick={() => setKeyToDelete(key)}
                            className="p-1.5 text-red-400 hover:text-red-300 hover:bg-red-400/10 rounded transition-colors"
                            title="Revoke Key"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-black/40 rounded p-2 text-xs font-mono text-[hsl(240,4.8%,95.9%)] border border-[hsl(240,3.7%,15.9%)] overflow-hidden text-ellipsis whitespace-nowrap">
                            {key.key || '••••••••••••••••••••••••••••••••'}
                          </div>
                          {key.key && (
                            <button
                              onClick={() => copyToClipboard(key.key, key.id)}
                              className="shrink-0 p-2 text-[hsl(240,5%,64.9%)] hover:text-white bg-[hsl(240,3.7%,15.9%)] rounded hover:bg-[hsl(240,5%,25.9%)] transition-colors"
                              title="Copy to clipboard"
                            >
                              {copiedKey === key.id ? <Check className="size-4 text-emerald-400" /> : <Copy className="size-4" />}
                            </button>
                          )}
                        </div>
                        {key.key && (
                          <p className="text-[11px] text-yellow-500/90 mt-2">
                            Make sure to copy your API key now. You won't be able to see it again!
                          </p>
                        )}
                      </div>
                    ))
                  )}
                </div>

              </div>
            </div>
          </section>

          <ApiDocsSection innerRef={docsRef} />

        </div>
      </div>
      
      {/* Modals */}
      {keyToDelete && (
        <ConfirmDeleteModal
          isOpen={true}
          onClose={() => setKeyToDelete(null)}
          onConfirm={async () => {
            await handleDeleteApiKey(keyToDelete.id);
          }}
          title="Revoke API Key"
          itemName={keyToDelete.name}
        />
      )}
    </div>
  );
}
