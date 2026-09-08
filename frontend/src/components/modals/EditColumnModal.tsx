import { useState, useEffect } from 'react';
import { X, Save, Trash2, Check, AlertCircle, Users, Lock } from 'lucide-react';
import { THEMES } from '../board/KanbanColumn';
import { getRoles } from '@/api/roles';
import type { WorkspaceRole } from '@/types/models';
import { ConfirmDeleteModal } from './ConfirmDeleteModal';

interface EditColumnModalProps {
  isOpen: boolean;
  onClose: () => void;
  status: string;
  theme: string;
  allowedRoles?: string[];
  onRename?: (newName: string) => void;
  onThemeChange?: (themeId: string) => void;
  onRoleChange?: (allowedRoles: string[]) => void;
  onDelete?: () => void;
}

export function EditColumnModal({
  isOpen,
  onClose,
  status,
  theme,
  onRename,
  onThemeChange,
  onRoleChange,
  onDelete,
}: EditColumnModalProps) {
  const [name, setName] = useState(status);
  const [selectedTheme, setSelectedTheme] = useState(theme);
  const [accessType, setAccessType] = useState<'all' | 'restricted'>('all');
  const [allowedRoles, setAllowedRoles] = useState<string[]>([]);
  const [roles, setRoles] = useState<WorkspaceRole[]>([]);
  const [isLoadingRoles, setIsLoadingRoles] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  useEffect(() => {
    setName(status);
    setSelectedTheme(theme);
    // If we have allowedRoles passed from parent (future), we'd set accessType to 'restricted'
    // For now, if there's any allowedRoles, it's restricted
    if (allowedRoles.length > 0) {
      setAccessType('restricted');
    }
  }, [status, theme, isOpen]);

  useEffect(() => {
    if (isOpen) {
      setIsLoadingRoles(true);
      getRoles()
        .then(setRoles)
        .catch(console.error)
        .finally(() => setIsLoadingRoles(false));
    }
  }, [isOpen]);

  const toggleRole = (roleId: string) => {
    setAllowedRoles(prev => 
      prev.includes(roleId) ? prev.filter(id => id !== roleId) : [...prev, roleId]
    );
  };

  useEffect(() => {
    setName(status);
    setSelectedTheme(theme);
  }, [status, theme, isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    if (name.trim() !== status && onRename) {
      onRename(name.trim());
    }
    if (selectedTheme !== theme && onThemeChange) {
      onThemeChange(selectedTheme);
    }
    
    if (onRoleChange) {
      onRoleChange(accessType === 'all' ? [] : allowedRoles);
    }

    onClose();
  };

  const handleDeleteConfirm = async () => {
    if (onDelete) onDelete();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div 
        className="w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <h2 className="text-lg font-semibold text-zinc-100">Edit Column</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-zinc-800 rounded-md text-zinc-400 transition-colors"
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
                  className={`w-8 h-8 rounded-full flex items-center justify-center transition-all flex-shrink-0 ${
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
              <p className="text-xs text-zinc-500 mt-1">Control who can move tasks into this status.</p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setAccessType('all')}
                className={`flex flex-col items-center justify-center gap-2 p-3 rounded-lg border transition-all ${
                  accessType === 'all'
                    ? 'border-indigo-500 bg-indigo-500/10 text-indigo-400'
                    : 'border-zinc-800 bg-zinc-900/50 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
                }`}
              >
                <Users className="w-5 h-5" />
                <span className="text-xs font-semibold">Allow Everyone</span>
              </button>
              <button
                onClick={() => setAccessType('restricted')}
                className={`flex flex-col items-center justify-center gap-2 p-3 rounded-lg border transition-all ${
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
              <div className="bg-zinc-900 border border-zinc-800 rounded-lg max-h-40 overflow-y-auto custom-scrollbar p-1 animate-in slide-in-from-top-2 duration-200">
                {isLoadingRoles ? (
                  <div className="p-4 flex justify-center"><div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>
                ) : roles.length === 0 ? (
                  <div className="p-4 text-center text-xs text-zinc-500 flex flex-col items-center gap-2">
                    <AlertCircle className="w-5 h-5 opacity-50" />
                    No custom roles found
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {roles.map(role => {
                      const isSelected = allowedRoles.includes(role.id);
                      return (
                        <button
                          key={role.id}
                          onClick={() => toggleRole(role.id)}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors text-left ${
                            isSelected ? 'bg-indigo-500/10 text-indigo-100' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <div className={`w-2.5 h-2.5 rounded-full ${role.color || 'bg-zinc-500'}`} />
                            <span className="font-medium">{role.name}</span>
                          </div>
                          {isSelected && <Check className="w-4 h-4 text-indigo-400" />}
                        </button>
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
            onClick={() => setIsDeleteModalOpen(true)}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-red-400 hover:text-red-300 hover:bg-red-950/30 rounded-lg transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors shadow-lg shadow-indigo-500/20"
            >
              <Save className="w-4 h-4" />
              Save Changes
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
