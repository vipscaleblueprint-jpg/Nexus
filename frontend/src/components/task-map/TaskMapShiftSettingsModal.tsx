import React, { useState } from 'react';
import { TaskMapShift, taskMapApi } from '@/api/taskMap';
import { X, Save, Clock } from 'lucide-react';
import { toast } from '@/lib/toast';

interface Props {
  isOpen: boolean;
  shifts: TaskMapShift[];
  onClose: () => void;
  onShiftsUpdated: () => void;
}

export const TaskMapShiftSettingsModal: React.FC<Props> = ({
  isOpen,
  shifts = [],
  onClose,
  onShiftsUpdated,
}) => {
  const [localShifts, setLocalShifts] = useState<TaskMapShift[]>(shifts);
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    setLocalShifts(shifts);
  }, [shifts]);

  if (!isOpen) return null;

  const handleChange = (index: number, field: keyof TaskMapShift, value: any) => {
    setLocalShifts((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await taskMapApi.updateShifts(localShifts);
      toast.success('Shift configurations updated');
      onShiftsUpdated();
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update shifts');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden flex flex-col text-zinc-200">
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/60">
          <div className="flex items-center gap-2">
            <Clock className="size-4 text-blue-400" />
            <h3 className="text-sm font-bold text-zinc-100">Shift Configuration (Admin)</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-800"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto custom-scrollbar">
          {localShifts.map((shift, idx) => (
            <div key={shift.shiftKey} className="p-3 bg-zinc-800/40 border border-zinc-800 rounded-lg space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs text-blue-400 uppercase tracking-wide">
                  {shift.name} Shift ({shift.shiftKey})
                </span>
                <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={shift.isActive}
                    onChange={(e) => handleChange(idx, 'isActive', e.target.checked)}
                    className="rounded bg-zinc-900 border-zinc-700 text-blue-600 focus:ring-0"
                  />
                  <span>Active</span>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="text-zinc-500 block mb-1">Start Time (24h)</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={shift.startHour}
                      onChange={(e) => handleChange(idx, 'startHour', parseInt(e.target.value, 10) || 0)}
                      className="w-16 bg-zinc-900 border border-zinc-700/80 rounded px-2 py-1 text-center font-mono"
                    />
                    <span>:</span>
                    <input
                      type="number"
                      min={0}
                      max={59}
                      value={shift.startMinute}
                      onChange={(e) => handleChange(idx, 'startMinute', parseInt(e.target.value, 10) || 0)}
                      className="w-16 bg-zinc-900 border border-zinc-700/80 rounded px-2 py-1 text-center font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-zinc-500 block mb-1">End Time (24h)</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={shift.endHour}
                      onChange={(e) => handleChange(idx, 'endHour', parseInt(e.target.value, 10) || 0)}
                      className="w-16 bg-zinc-900 border border-zinc-700/80 rounded px-2 py-1 text-center font-mono"
                    />
                    <span>:</span>
                    <input
                      type="number"
                      min={0}
                      max={59}
                      value={shift.endMinute}
                      onChange={(e) => handleChange(idx, 'endMinute', parseInt(e.target.value, 10) || 0)}
                      className="w-16 bg-zinc-900 border border-zinc-700/80 rounded px-2 py-1 text-center font-mono"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="text-zinc-500 block mb-1 text-xs">Timezone</label>
                <input
                  type="text"
                  value={shift.timezone}
                  onChange={(e) => handleChange(idx, 'timezone', e.target.value)}
                  placeholder="e.g. Asia/Manila"
                  className="w-full bg-zinc-900 border border-zinc-700/80 rounded px-2.5 py-1 text-xs"
                />
              </div>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-zinc-800 flex items-center justify-end gap-2 bg-zinc-950/40">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-zinc-400 hover:text-white rounded hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded font-semibold disabled:opacity-50"
          >
            <Save className="size-3.5" />
            <span>{saving ? 'Saving...' : 'Save Shifts'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
