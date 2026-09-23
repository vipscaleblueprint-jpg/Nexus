import { useState, useEffect } from 'react';
import { X, Save, Trash2, Check, AlertCircle, Users, Lock, Shield, Loader2 } from 'lucide-react';
import { THEMES } from '../board/KanbanColumn';
import { getRoles } from '@/api/roles';
import type { WorkspaceRole } from '@/types/models';
import { ConfirmDeleteModal } from './ConfirmDeleteModal';
import { toast } from '@/lib/toast';
import { useAppStore } from '@/lib/store';

interface EditColumnModalProps {
  isOpen: boolean;
  onClose: () => void;
  status: string;
  theme: string;
  allowedRoles?: string[];
  onRename?: (newName: string) => void;
  onThemeChange?: (themeId: string) => void;
  onRoleChange?: (allowedRoles: string[]) => void;
  onSave?: (data: { name: string; color: string; allowedRoles: string[] }) => Promise<void> | void;
  onDelete?: () => void;
}

export function EditColumnModal({
  isOpen,
  onClose,
  status,
  theme,
  allowedRoles: initialAllowedRoles = [],
  onRename,
  onThemeChange,
  onRoleChange,
  onSave,
  onDelete,
}: EditColumnModalProps) {
  const [name, setName] = useState(status);
  const [selectedTheme, setSelectedTheme] = useState(theme);
  const [accessType, setAccessType] = useState<'all' | 'restricted'>('all');
  const [allowedRoles, setAllowedRoles] = useState<string[]>([]);
  const [roles, setRoles] = useState<WorkspaceRole[]>([]);
  const [isLoadingRoles, setIsLoadingRoles] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isRendered, setIsRendered] = useState(isOpen);
  const [isVisible, setIsVisible] = useState(false);
  const workspaceTeams = useAppStore(state => state.workspaceTeams);

  useEffect(() => {
    if (isOpen) {
      setIsRendered(true);
      document.body.style.overflow = 'hidden';
      // Small delay to ensure the element is rendered before adding the visible class
      const frame = requestAnimationFrame(() => {
        requestAnimationFrame(() => setIsVisible(true));
      });
      return () => cancelAnimationFrame(frame);
    } else {
      setIsVisible(false);
      document.body.style.overflow = '';
      const timer = setTimeout(() => setIsRendered(false), 200);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  useEffect(() => {
    setName(status);
    setSelectedTheme(theme);
    setAllowedRoles(initialAllowedRoles || []);
    setAccessType(initialAllowedRoles && initialAllowedRoles.length > 0 ? 'restricted' : 'all');
  }, [status, theme, initialAllowedRoles, isOpen]);

  useEffect(() => {
    if (isOpen) {
      setIsLoadingRoles(true);
      getRoles()
        .then(setRoles)
        .catch(console.error)
        .finally(() => setIsLoadingRoles(false));
    }
  }, [isOpen]);

  // Filter out ADMIN and ADMINISTRATOR from selectable options
  // Admins always have access to all columns
  const selectableRoles = roles.filter((role) => {
    const upper = role.name.trim().toUpperCase();
    return upper !== 'ADMIN' && upper !== 'ADMINISTRATOR';
  });

  const isRoleSelected = (role: WorkspaceRole) => {
    return allowedRoles.some(
      (r) => r === role.name || r === role.id || r.toUpperCase() === role.name.toUpperCase()
    );
  };

  const toggleRole = (role: WorkspaceRole) => {
    setAllowedRoles((prev) => {
      const exists = prev.some(
        (r) => r === role.name || r === role.id || r.toUpperCase() === role.name.toUpperCase()
      );
      if (exists) {
        return prev.filter(
          (r) => r !== role.name && r !== role.id && r.toUpperCase() !== role.name.toUpperCase()
        );
      }
      return [...prev, role.name];
    });
  };

  if (!isRendered) return null;

  const handleSave = async () => {
    setIsSaving(true);
    const finalRoles = accessType === 'all' ? [] : allowedRoles;
    const trimmedName = name.trim() || status;

    try {
      if (onSave) {
        await onSave({
          name: trimmedName,
          color: selectedTheme,
          allowedRoles: finalRoles,
        });
      } else {
        if (trimmedName !== status && onRename) onRename(trimmedName);
        if (selectedTheme !== theme && onThemeChange) onThemeChange(selectedTheme);
        if (onRoleChange) onRoleChange(finalRoles);
      }

      setSavedNotice(true);
      setTimeout(() => {
        setSavedNotice(false);
        setIsSaving(false);
        onClose();
      }, 300);
    } catch (err: any) {
      console.error('Failed to save column settings:', err);
      toast.error(err.message || 'Failed to save column settings');
      setIsSaving(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (onDelete) onDelete();
    onClose();
  };

  return (
    <div className={`fixed inset-0 z-[100] overflow-y-auto overscroll-contain flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 transition-opacity duration-200 ${isVisible ? 'opacity-100' : 'opacity-0'}`}>
      <div 
        className={`w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl flex flex-col overflow-hidden transition-all duration-200 ${isVisible ? 'scale-100 opacity-100' : 'scale-95 opacity-0'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <h2 className="text-lg font-semibold text-zinc-100">Edit Column</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-zinc-800 rounded-md text-zinc-400 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-6">
          {/* Rename Section */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-300">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
              placeholder="Column name"
            />
          </div>

          {/* Color Section */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-zinc-300">Color Theme</label>
            <div className="grid grid-cols-6 sm:grid-cols-8 gap-3 p-1">
              {Object.keys(THEMES).map((t) => (
                <button
                  key={t}
                  onClick={() => setSelectedTheme(t)}
                  className={`w-8 h-8 rounded-full flex items-center justify-center transition-all flex-shrink-0 cursor-pointer ${
                    THEMES[t as keyof typeof THEMES].badge.split(' ')[0]
                  } ${
                    selectedTheme === t
                      ? 'ring-2 ring-zinc-100 ring-offset-2 ring-offset-zinc-950 scale-110'
                      : 'opacity-70 hover:opacity-100 hover:scale-105'
                  }`}
                  title={t}
                >
                  {selectedTheme === t && <Check className="w-4 h-4 text-white drop-shadow-md" />}
                </button>
              ))}
            </div>
          </div>

          {/* Permissions / Role Section */}
          <div className="space-y-4">
            <div className="flex flex-col">
              <label className="text-sm font-medium text-zinc-300">Status Access Restrictions</label>
              <p className="text-xs text-zinc-400 mt-1">
                Anyone can move tasks into this column. Restricting access ensures only selected roles can move or change tasks out of this status.
              </p>
              <div className="mt-2 text-[11px] text-zinc-400 flex items-center gap-1.5 bg-zinc-900/90 px-2.5 py-1.5 rounded-lg border border-zinc-800/80">
                <Shield className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span>Admins have full access to all columns and can move tasks out of any status.</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAccessType('all')}
                className={`flex flex-col items-center justify-center gap-2 p-3 rounded-lg border transition-all cursor-pointer ${
                  accessType === 'all'
                    ? 'border-indigo-500 bg-indigo-500/10 text-indigo-400'
                    : 'border-zinc-800 bg-zinc-900/50 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
                }`}
              >
                <Users className="w-5 h-5" />
                <span className="text-xs font-semibold">Allow Everyone</span>
              </button>
              <button
                type="button"
                onClick={() => setAccessType('restricted')}
                className={`flex flex-col items-center justify-center gap-2 p-3 rounded-lg border transition-all cursor-pointer ${
                  accessType === 'restricted'
                    ? 'border-indigo-500 bg-indigo-500/10 text-indigo-400'
                    : 'border-zinc-800 bg-zinc-900/50 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
                }`}
              >
                <Lock className="w-5 h-5" />
                <span className="text-xs font-semibold">Restrict Access</span>
              </button>
            </div>

            {accessType === 'restricted' && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-lg max-h-44 overflow-y-auto overscroll-contain custom-scrollbar p-1 animate-in slide-in-from-top-2 duration-200">
                {isLoadingRoles ? (
                  <div className="p-4 flex justify-center"><div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>
                ) : selectableRoles.length === 0 ? (
                  <div className="p-4 text-center text-xs text-zinc-500 flex flex-col items-center gap-2">
                    <AlertCircle className="w-5 h-5 opacity-50" />
                    No custom roles available
                  </div>
                ) : (
                  <div className="flex flex-col gap-1 pr-1">
                    {workspaceTeams.length === 0 && <div className="px-2 py-1.5 text-xs text-zinc-500">No teams found.</div>}
                    {workspaceTeams.map(team => {
                      const teamRoles = (team.teamRoles || []).filter((r: any) => {
                        const upper = r.name.trim().toUpperCase();
                        return upper !== 'ADMIN' && upper !== 'ADMINISTRATOR';
                      });
                      const hasRoles = teamRoles.length > 0;
                      const allSelected = hasRoles && teamRoles.every((r: any) => isRoleSelected(r));
                      const someSelected = hasRoles && teamRoles.some((r: any) => isRoleSelected(r));

                      return (
                        <div key={team.id} className="mb-2">
                          <div
                            onClick={() => {
                              if (!hasRoles) return;
                              if (allSelected) {
                                // Deselect all
                                setAllowedRoles(prev => prev.filter(r => !teamRoles.find((tr: any) => tr.name === r || tr.id === r || tr.name.toUpperCase() === r.toUpperCase())));
                              } else {
                                // Select all missing
                                const toAdd = teamRoles.filter((tr: any) => !isRoleSelected(tr)).map((tr: any) => tr.name);
                                setAllowedRoles(prev => [...prev, ...toAdd]);
                              }
                            }}
                            className={`flex items-center gap-2 px-2 py-1 text-[10px] font-semibold tracking-wide uppercase bg-zinc-800/30 ${hasRoles ? 'cursor-pointer hover:bg-zinc-800/50 hover:text-zinc-200 transition-colors' : ''} ${someSelected ? 'text-indigo-400' : 'text-zinc-400'}`}
                          >
                            {hasRoles && (
                              <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-colors ${allSelected ? 'bg-indigo-600 border-indigo-500' : someSelected ? 'bg-indigo-900/50 border-indigo-500' : 'border-zinc-500 bg-[#1a1a20]'}`}>
                                {allSelected && <Check className="w-2.5 h-2.5 text-white" />}
                                {!allSelected && someSelected && <div className="w-1.5 h-0.5 bg-indigo-400 rounded-full" />}
                              </div>
                            )}
                            <span>{team.name}</span>
                          </div>
                          {(!team.teamRoles || teamRoles.length === 0) && (
                            <div className="px-2 py-1 text-[10px] text-zinc-500 italic">No roles</div>
                          )}
                          {teamRoles.length > 0 && (
                            <div className="flex flex-col ml-[15px] pl-3 py-0.5 border-l border-zinc-700/50 mt-1 mb-1 relative">
                              {teamRoles.map((role: any) => {
                                const selected = isRoleSelected(role);
                                return (
                                  <div
                                    key={role.id}
                                    onClick={() => toggleRole(role)}
                                    className="flex items-center gap-2 cursor-pointer px-1 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors rounded-md"
                                  >
                                    <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-colors ${selected ? 'bg-indigo-600 border-indigo-500' : 'border-zinc-600'}`}>
                                      {selected && <Check className="w-2.5 h-2.5 text-white" />}
                                    </div>
                                    {role.name}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

            )}
          </div>
        </div>

        <div className="flex items-center justify-between p-4 border-t border-zinc-800 bg-zinc-900/50">
          <button
            type="button"
            onClick={() => setIsDeleteModalOpen(true)}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-red-400 hover:text-red-300 hover:bg-red-950/30 rounded-lg transition-colors cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={isSaving}
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={handleSave}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors shadow-lg shadow-indigo-500/20 disabled:opacity-50 cursor-pointer"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : savedNotice ? (
                <>
                  <Check className="w-4 h-4 text-emerald-300" />
                  Saved!
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save Changes
                </>
              )}
            </button>
          </div>
        </div>
      </div>
      
      <ConfirmDeleteModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={handleDeleteConfirm}
        title="Delete Column"
        itemName={name || 'this column'}
      />
    </div>
  );
}
