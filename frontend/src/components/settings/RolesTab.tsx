'use client';

import { useState, useEffect } from 'react';
import { Plus, Trash2, Shield, Loader2 } from 'lucide-react';
import { getRoles, createRole, deleteRole } from '@/api/roles';
import { WorkspaceRole } from '@/lib/types';
import { ActionMenu } from '@/components/ui/ActionMenu';

export function RolesTab() {
  const [roles, setRoles] = useState<WorkspaceRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [newRoleName, setNewRoleName] = useState('');
  const [creating, setCreating] = useState(false);

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

  const handleDeleteRole = async (id: string) => {
    if (!confirm('Are you sure you want to delete this role? It will be removed from future assignment options.')) return;
    try {
      await deleteRole(id);
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
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center">
                    <Shield className="w-4 h-4 text-indigo-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-zinc-200">{role.name}</p>
                    <p className="text-[10px] text-zinc-500 font-mono mt-0.5">ID: {role.id}</p>
                  </div>
                </div>
                <button
                  onClick={() => handleDeleteRole(role.id)}
                  className="p-2 text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                  title="Delete Role"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
