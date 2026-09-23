import { X, Shield } from 'lucide-react';
import { RolesTab } from '@/components/settings/RolesTab';

interface RoleManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function RoleManagementModal({ isOpen, onClose }: RoleManagementModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl max-h-[90vh] overflow-y-auto bg-[#18181c] border border-zinc-800 rounded-2xl shadow-2xl text-zinc-100 flex flex-col no-scrollbar"
      >
        <div className="sticky top-0 z-10 px-5 py-4 border-b border-zinc-800/80 flex items-center justify-between bg-zinc-950/90 backdrop-blur">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-zinc-800/80 border border-zinc-700">
              <Shield className="w-4 h-4 text-indigo-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold tracking-tight text-white">
                Role Management
              </h2>
              <p className="text-[11px] text-zinc-400">Manage teams, custom roles, and permissions.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5">
          <RolesTab />
        </div>
      </div>
    </div>
  );
}
