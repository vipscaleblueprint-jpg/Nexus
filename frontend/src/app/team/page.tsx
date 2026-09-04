'use client';

import { useEffect, useState } from 'react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { TeamRosterView } from '@/components/team/TeamRosterView';
import { useAppStore } from '@/lib/store';
import { User } from '@/lib/types';
import { authApi, usersApi } from '@/api';

export default function TeamPage() {
  const { setCurrentUser } = useAppStore();
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    async function loadData() {
      setIsLoading(true);

      // Current authenticated session user, resolved from the auth cookie.
      let activeAuthUser: User | null = null;
      try {
        const meData = await authApi.getMe();
        if (meData.user) {
          activeAuthUser = meData.user;
          setCurrentUser(meData.user);
        }
      } catch (e) {
        console.warn('No active session found or auth server offline:', e);
      }

      try {
        const userData = await usersApi.getUsers();
        const roster = userData.users || [];
        setUsers(roster);
        if (!activeAuthUser && roster.length > 0) {
          setCurrentUser(roster[0]);
        }
      } catch (e) {
        console.error('Failed to load user roster:', e);
      }

      setIsLoading(false);
    }

    loadData();
  }, [setCurrentUser]);

  return (
    <div className="flex h-screen bg-[#131316] text-[#e4e4e7] overflow-hidden font-sans">
      <Sidebar />

      <div className="flex-1 flex flex-col h-screen overflow-hidden bg-[#131316]">
        <Header />

        <main className="flex-1 flex overflow-hidden bg-[#131316]">
          <TeamRosterView users={users} isLoading={isLoading} />
        </main>
      </div>
    </div>
  );
}
