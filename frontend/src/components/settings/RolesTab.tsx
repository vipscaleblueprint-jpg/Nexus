'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Trash2, Shield, Loader2, Pencil, Check, X, Users, ChevronDown, ChevronRight } from 'lucide-react';
import { getTeams, createTeam, deleteTeam, updateTeam, createTeamRole, updateTeamRole, deleteTeamRole } from '@/api/teams';
import { Team, TeamRole } from '@/lib/types';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { ConfirmActionModal } from '@/components/modals/ConfirmActionModal';

export function RolesTab() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTeamName, setNewTeamName] = useState('');
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set());

  // Editing state for Teams
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editTeamName, setEditTeamName] = useState('');
  
  // Adding/Editing state for Roles
  const [addingRoleToTeamId, setAddingRoleToTeamId] = useState<string | null>(null);
  const [newRoleName, setNewRoleName] = useState('');
  
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [editRoleName, setEditRoleName] = useState('');

  // Confirmation Modals
  const [teamToDelete, setTeamToDelete] = useState<Team | null>(null);
  const [roleToDelete, setRoleToDelete] = useState<{ teamId: string, role: TeamRole } | null>(null);

  const loadTeams = async () => {
    try {
      const data = await getTeams();
      setTeams(data);
    } catch (err) {
      console.error('Failed to load teams', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTeams();
  }, []);

  const toggleTeamExpand = (teamId: string) => {
    setExpandedTeams(prev => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  };

  // --- Team Actions ---
  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTeamName.trim()) return;
    setCreatingTeam(true);
    try {
      await createTeam({ name: newTeamName.trim() });
      setNewTeamName('');
      loadTeams();
    } catch (err) {
      console.error('Failed to create team', err);
    } finally {
      setCreatingTeam(false);
    }
  };

  const startEditingTeam = (team: Team) => {
    setEditingTeamId(team.id);
    setEditTeamName(team.name);
  };

  const handleUpdateTeam = async (teamId: string) => {
    if (!editTeamName.trim()) return;
    try {
      await updateTeam(teamId, { name: editTeamName.trim() });
      setEditingTeamId(null);
      loadTeams();
    } catch (err) {
      console.error('Failed to update team', err);
    }
  };

  const handleConfirmDeleteTeam = async () => {
    if (!teamToDelete) return;
    try {
      await deleteTeam(teamToDelete.id);
      setTeamToDelete(null);
      loadTeams();
    } catch (err) {
      console.error('Failed to delete team', err);
    }
  };

  // --- Team Role Actions ---
  const handleAddRole = async (teamId: string) => {
    if (!newRoleName.trim()) return;
    try {
      await createTeamRole(teamId, { name: newRoleName.trim() });
      setAddingRoleToTeamId(null);
      setNewRoleName('');
      loadTeams();
    } catch (err) {
      console.error('Failed to create team role', err);
    }
  };

  const startEditingRole = (role: TeamRole) => {
    setEditingRoleId(role.id);
    setEditRoleName(role.name);
  };

  const handleUpdateRole = async (teamId: string, roleId: string) => {
    if (!editRoleName.trim()) return;
    try {
      await updateTeamRole(teamId, roleId, { name: editRoleName.trim() });
      setEditingRoleId(null);
      loadTeams();
    } catch (err) {
      console.error('Failed to update team role', err);
    }
  };

  const handleConfirmDeleteRole = async () => {
    if (!roleToDelete) return;
    try {
      await deleteTeamRole(roleToDelete.teamId, roleToDelete.role.id);
      setRoleToDelete(null);
      loadTeams();
    } catch (err) {
      console.error('Failed to delete team role', err);
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
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white mb-1">Teams & Roles</h2>
          <p className="text-sm text-zinc-400">Manage your workspace teams and their specific roles.</p>
        </div>
      </div>

      <div className="bg-[#111111] rounded-xl border border-zinc-800/60 overflow-hidden shadow-xl">
        <div className="p-4 border-b border-zinc-800/60 bg-[#161616]">
          <form onSubmit={handleCreateTeam} className="flex gap-3">
            <div className="relative flex-1">
              <Users className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Enter new team name (e.g. Design Team)"
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
                className="w-full bg-[#0a0a0a] border border-zinc-800 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500/50 transition-colors"
              />
            </div>
            <button
              type="submit"
              disabled={!newTeamName.trim() || creatingTeam}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/50 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-all flex items-center gap-2 shadow-lg shadow-indigo-900/20"
            >
              {creatingTeam ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Create Team
            </button>
          </form>
        </div>

        <div className="divide-y divide-zinc-800/50">
          {teams.length === 0 ? (
            <div className="p-8 text-center text-zinc-500 text-sm">
              No teams created yet.
            </div>
          ) : (
            teams.map((team) => {
              const isExpanded = expandedTeams.has(team.id);
              return (
                <div key={team.id} className="group/team">
                  <div className="p-4 flex items-center justify-between hover:bg-zinc-800/20 transition-colors">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <button 
                        onClick={() => toggleTeamExpand(team.id)}
                        className="p-1 hover:bg-zinc-800 rounded text-zinc-500 hover:text-zinc-300 transition-colors"
                      >
                        <motion.div
                          animate={{ rotate: isExpanded ? 90 : 0 }}
                          transition={{ duration: 0.2 }}
                        >
                          <ChevronRight className="w-4 h-4" />
                        </motion.div>
                      </button>
                      
                      {editingTeamId === team.id ? (
                        <div className="flex items-center gap-2 flex-1 max-w-sm">
                          <input
                            type="text"
                            value={editTeamName}
                            onChange={(e) => setEditTeamName(e.target.value)}
                            className="flex-1 bg-black border border-indigo-500/50 rounded px-2 py-1 text-sm text-white focus:outline-none"
                            autoFocus
                            onKeyDown={(e) => e.key === 'Enter' && handleUpdateTeam(team.id)}
                          />
                          <button onClick={() => handleUpdateTeam(team.id)} className="p-1 text-emerald-500 hover:bg-emerald-500/10 rounded">
                            <Check className="w-4 h-4" />
                          </button>
                          <button onClick={() => setEditingTeamId(null)} className="p-1 text-zinc-500 hover:bg-zinc-800 rounded cursor-pointer">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div 
                          className="flex items-center gap-2 cursor-pointer select-none"
                          onClick={() => toggleTeamExpand(team.id)}
                        >
                          <Users className="w-4 h-4 text-zinc-400" />
                          <span className="text-sm font-bold text-zinc-200">{team.name}</span>
                          <span className="text-xs text-zinc-500 font-normal px-2 py-0.5 rounded-full bg-zinc-800/50">
                            {team.teamRoles?.length || 0} roles
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center opacity-0 group-hover/team:opacity-100 transition-opacity">
                      <ActionMenu>
                        <div className="py-1">
                          <button
                            onClick={() => startEditingTeam(team)}
                            className="w-full text-left px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 flex items-center gap-2"
                          >
                            <Pencil className="w-4 h-4" /> Rename Team
                          </button>
                          <button
                            onClick={() => setAddingRoleToTeamId(team.id)}
                            className="w-full text-left px-4 py-2 text-sm text-indigo-400 hover:bg-zinc-800 flex items-center gap-2"
                          >
                            <Plus className="w-4 h-4" /> Add Role
                          </button>
                          <button
                            onClick={() => setTeamToDelete(team)}
                            className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-zinc-800 flex items-center gap-2"
                          >
                            <Trash2 className="w-4 h-4" /> Delete Team
                          </button>
                        </div>
                      </ActionMenu>
                    </div>
                  </div>

                  {/* Team Roles Dropdown Section */}
                  <AnimatePresence initial={false}>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: "easeInOut" }}
                        className="overflow-hidden bg-black/20"
                      >
                        <div className="pl-12 pr-4 pb-4 pt-1 space-y-1">
                          {team.teamRoles?.length === 0 && addingRoleToTeamId !== team.id && (
                            <div className="py-2 text-xs text-zinc-600 italic">No roles defined for this team.</div>
                      )}
                      
                      {team.teamRoles?.map(role => (
                        <div key={role.id} className="flex items-center justify-between py-1.5 px-3 rounded-lg hover:bg-zinc-800/30 group/role">
                          {editingRoleId === role.id ? (
                            <div className="flex items-center gap-2 flex-1 max-w-sm">
                              <input
                                type="text"
                                value={editRoleName}
                                onChange={(e) => setEditRoleName(e.target.value)}
                                className="flex-1 bg-black border border-indigo-500/50 rounded px-2 py-1 text-sm text-white focus:outline-none"
                                autoFocus
                                onKeyDown={(e) => e.key === 'Enter' && handleUpdateRole(team.id, role.id)}
                              />
                              <button onClick={() => handleUpdateRole(team.id, role.id)} className="p-1 text-emerald-500 hover:bg-emerald-500/10 rounded">
                                <Check className="w-4 h-4" />
                              </button>
                              <button onClick={() => setEditingRoleId(null)} className="p-1 text-zinc-500 hover:bg-zinc-800 rounded cursor-pointer">
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <Shield className="w-3.5 h-3.5 text-zinc-500" />
                              <span className="text-sm text-zinc-400 group-hover/role:text-zinc-300 transition-colors">{role.name}</span>
                            </div>
                          )}
                          
                          <div className="flex items-center gap-1 opacity-0 group-hover/role:opacity-100 transition-opacity">
                            <button
                              onClick={() => startEditingRole(role)}
                              className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 rounded transition-colors"
                              title="Edit Role"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setRoleToDelete({ teamId: team.id, role })}
                              className="p-1.5 text-red-500/70 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                              title="Delete Role"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}

                      {addingRoleToTeamId === team.id && (
                        <div className="flex items-center gap-2 py-1.5 px-3 mt-2">
                          <Shield className="w-3.5 h-3.5 text-indigo-500" />
                          <input
                            type="text"
                            value={newRoleName}
                            onChange={(e) => setNewRoleName(e.target.value)}
                            placeholder="New role name..."
                            className="flex-1 max-w-sm bg-black border border-indigo-500/50 rounded px-2 py-1 text-sm text-white focus:outline-none"
                            autoFocus
                            onKeyDown={(e) => e.key === 'Enter' && handleAddRole(team.id)}
                          />
                          <button onClick={() => handleAddRole(team.id)} className="p-1 text-emerald-500 hover:bg-emerald-500/10 rounded">
                            <Check className="w-4 h-4" />
                          </button>
                          <button onClick={() => { setAddingRoleToTeamId(null); setNewRoleName(''); }} className="p-1 text-zinc-500 hover:bg-zinc-800 rounded cursor-pointer">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                      
                      {addingRoleToTeamId !== team.id && (
                        <button 
                          onClick={() => setAddingRoleToTeamId(team.id)}
                          className="flex items-center gap-1.5 py-1 px-3 mt-1 text-xs text-indigo-400/70 hover:text-indigo-400 hover:bg-indigo-500/10 rounded transition-colors"
                        >
                          <Plus className="w-3 h-3" />
                          Add Role
                        </button>
                      )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })
          )}
        </div>
      </div>

      <ConfirmActionModal
        isOpen={!!teamToDelete}
        onClose={() => setTeamToDelete(null)}
        onConfirm={handleConfirmDeleteTeam}
        title="Delete Team"
        message={`Are you sure you want to delete the team "${teamToDelete?.name}"? All associated roles will be deleted as well. This action cannot be undone.`}
        confirmText="Delete Team"
        isDestructive={true}
      />
      
      <ConfirmActionModal
        isOpen={!!roleToDelete}
        onClose={() => setRoleToDelete(null)}
        onConfirm={handleConfirmDeleteRole}
        title="Delete Role"
        message={`Are you sure you want to delete the role "${roleToDelete?.role.name}"? This action cannot be undone.`}
        confirmText="Delete Role"
        isDestructive={true}
      />
    </div>
  );
}
