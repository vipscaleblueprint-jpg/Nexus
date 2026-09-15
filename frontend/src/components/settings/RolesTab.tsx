'use client';

import { useState, useEffect } from 'react';
import { Plus, Trash2, Shield, Loader2, Pencil, Check, X } from 'lucide-react';
import { getRoles, createRole, deleteRole, updateRole } from '@/api/roles';
import { WorkspaceRole } from '@/lib/types';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { ConfirmActionModal } from '@/components/modals/ConfirmActionModal';

export function RolesTab() {
  const [roles, setRoles] = useState<WorkspaceRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [newRoleName, setNewRoleName] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [editRoleName, setEditRoleName] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);

  const [roleToDelete, setRoleToDelete] = useState<WorkspaceRole | null>(null);
  const [roleToConfirmEdit, setRoleToConfirmEdit] = useState<{ id: string, newName: string, oldName: string } | null>(null);

  const loadRoles = async () => {
    try {
      const data = await getRoles();
      setRoles(data);
    } catch (err) {
      console.error('Failed to load roles', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRoles();
  }, []);

  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoleName.trim()) return;
    setCreating(true);
    try {
      await createRole({ name: newRoleName.trim().toUpperCase() });
      setNewRoleName('');
      loadRoles();
    } catch (err) {
      console.error('Failed to create role', err);
    } finally {
      setCreating(false);
    }
  };

  const startEditing = (role: WorkspaceRole) => {
    setEditingRoleId(role.id);
    setEditRoleName(role.name);
  };

  const handleInitiateUpdate = (roleId: string, currentName: string) => {
    if (!editRoleName.trim() || editRoleName.trim() === currentName) {
      setEditingRoleId(null);
      return;
    }
    setRoleToConfirmEdit({ id: roleId, newName: editRoleName.trim(), oldName: currentName });
  };

  const handleConfirmUpdate = async () => {
    if (!roleToConfirmEdit) return;
    setSavingId(roleToConfirmEdit.id);
    try {
      await updateRole(roleToConfirmEdit.id, { name: roleToConfirmEdit.newName.toUpperCase() });
      setEditingRoleId(null);
      setRoleToConfirmEdit(null);
      loadRoles();
    } catch (err) {
      console.error('Failed to update role', err);
    } finally {
      setSavingId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!roleToDelete) return;
    try {
      await deleteRole(roleToDelete.id);
      setRoleToDelete(null);
      loadRoles();
    } catch (err) {
      console.error('Failed to delete role', err);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="bg-[#18181c] border border-zinc-800/80 rounded-2xl p-6 shadow-lg">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Shield className="w-5 h-5 text-indigo-400" />
              Custom Roles
            </h2>
            <p className="text-zinc-500 text-sm mt-1">
              Create custom roles to assign to your workspace members. These roles will be available in the member assignment dropdown.
            </p>
          </div>
        </div>

        <form onSubmit={handleCreateRole} className="flex gap-3 mb-8">
          <input
            type="text"
            placeholder="E.g., PRODUCT_MANAGER"
            value={newRoleName}
            onChange={(e) => setNewRoleName(e.target.value)}
            className="flex-1 bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500 uppercase"
            maxLength={30}
          />
          <button
            type="submit"
            disabled={!newRoleName.trim() || creating}
            className="flex items-center gap-2 px-6 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add Role
          </button>
        </form>

        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Available Roles</h3>
          {roles.length === 0 ? (
            <p className="text-sm text-zinc-600 italic py-4">No custom roles created yet.</p>
          ) : (
            roles.map((role) => (
              <div key={role.id} className="flex items-center justify-between p-3 bg-zinc-900/50 border border-zinc-800 rounded-xl group hover:border-zinc-700 transition-colors">
                <div className="flex items-center gap-3 w-full">
                  <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center shrink-0">
                    <Shield className="w-4 h-4 text-indigo-400" />
                  </div>
                  
                  {editingRoleId === role.id ? (
                    <div className="flex items-center gap-2 flex-1">
                      <input
                        type="text"
                        value={editRoleName}
                        onChange={(e) => setEditRoleName(e.target.value)}
                        className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1 text-sm text-white focus:outline-none focus:border-indigo-500 uppercase"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleInitiateUpdate(role.id, role.name);
                          if (e.key === 'Escape') setEditingRoleId(null);
                        }}
                      />
                      <button
                        onClick={() => handleInitiateUpdate(role.id, role.name)}
                        disabled={savingId === role.id || !editRoleName.trim()}
                        className="p-1.5 text-emerald-400 hover:bg-emerald-500/10 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {savingId === role.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => setEditingRoleId(null)}
                        className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-zinc-200">{role.name}</p>
                      <p className="text-[10px] text-zinc-500 font-mono mt-0.5">ID: {role.id}</p>
                    </div>
                  )}
                </div>
                
                {editingRoleId !== role.id && (
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-4 shrink-0">
                    <button
                      onClick={() => startEditing(role)}
                      className="p-2 text-zinc-500 hover:text-indigo-400 hover:bg-indigo-500/10 rounded-lg transition-colors"
                      title="Edit Role"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setRoleToDelete(role)}
                      className="p-2 text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
                      title="Delete Role"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      <ConfirmActionModal
        isOpen={!!roleToDelete}
        onClose={() => setRoleToDelete(null)}
        onConfirm={handleConfirmDelete}
        title="Delete Role"
        message={
          <>
            Are you sure you want to delete the role <span className="font-bold text-white">"{roleToDelete?.name}"</span>?
            <p className="mt-2 text-zinc-500 text-xs">
              This role will be removed from future assignment options.
            </p>
          </>
        }
        confirmText="Delete Role"
        isDestructive={true}
      />

      <ConfirmActionModal
        isOpen={!!roleToConfirmEdit}
        onClose={() => setRoleToConfirmEdit(null)}
        onConfirm={handleConfirmUpdate}
        title="Edit Role Name"
        message={
          <>
            Are you sure you want to rename <span className="font-bold text-white">"{roleToConfirmEdit?.oldName}"</span> to <span className="font-bold text-white">"{roleToConfirmEdit?.newName.toUpperCase()}"</span>?
            <p className="mt-2 text-zinc-500 text-xs">
              Users currently holding this role will not be affected unless re-assigned.
            </p>
          </>
        }
        confirmText="Save Changes"
        isDestructive={false}
      />
    </div>
  );
}
