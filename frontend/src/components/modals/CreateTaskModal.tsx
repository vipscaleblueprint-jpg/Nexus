import { useState, useEffect, useRef } from 'react';
import { X, Calendar, User, Flag, Loader2, RotateCw, Link2, Sparkles, ChevronDown } from 'lucide-react';
import { Priority, Task } from '@/lib/types';
import { usersApi } from '@/api/users';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  status: string;
  listId: string;
  onSave: (task: Partial<Task>) => Promise<void>;
}

function DropdownField({ label, placeholder, value, options, onSelect, optional, required, rightAction }: any) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const handleClick = (e: any) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);
  
  return (
    <div className="relative w-full" ref={ref}>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-bold text-zinc-100">
          {label} 
          {required && <span className="text-pink-500 ml-1">*</span>}
          {optional && <span className="text-zinc-500 font-normal ml-1">(Optional)</span>}
        </label>
        {rightAction}
      </div>
      <div className="relative w-full text-left" onClick={() => setOpen(!open)}>
        <input 
          type="text"
          readOnly
          value={value || ''}
          placeholder={placeholder}
          className="w-full bg-[#18181b] border border-zinc-800 rounded-md px-3 py-2.5 text-sm text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-[#332238] transition-colors cursor-pointer"
        />
        <ChevronDown className="w-4 h-4 text-zinc-600 absolute right-3 top-1/2 -translate-y-1/2" />
      </div>
      {open && (
        <div className="absolute left-0 top-full mt-1 w-full bg-[#18181b] border border-zinc-800 rounded shadow-xl z-50 py-1 max-h-48 overflow-y-auto">
          {options.length === 0 ? (
            <div className="px-3 py-2 text-xs text-zinc-500">No options</div>
          ) : options.map((opt: any) => (
            <button 
              key={opt.id || opt.value} 
              onClick={() => { onSelect(opt); setOpen(false); }} 
              className="w-full text-left px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors truncate capitalize"
            >
              {opt.label || opt.name || opt.value}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function CreateTaskModal({ isOpen, onClose, status, listId, onSave }: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignee, setAssignee] = useState<{id: string; name: string} | null>(null);
  const [priority, setPriority] = useState<Priority | null>(null);
  
  // New UI states
  const [client, setClient] = useState<{value: string; label: string} | null>(null);
  const [listedBy, setListedBy] = useState<any>(null);
  const [complexity, setComplexity] = useState<{value: string; label: string} | null>(null);

  const [users, setUsers] = useState<any[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen && users.length === 0) {
      usersApi.getUsers().then(res => setUsers(res.users)).catch(console.error);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setTitle('');
      setDescription('');
      setAssignee(null);
      setPriority(null);
      setClient(null);
      setListedBy(null);
      setComplexity(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = async () => {
    // In this mocked UI, we'll map "Prompt" to description and "Task Title" to title.
    if (!description.trim() && !title.trim()) return;
    setIsSaving(true);
    try {
      await onSave({
        title: title.trim() || 'New Task',
        description: description.trim(),
        status,
        listId,
        assigneeId: assignee?.id,
        priority: priority || ('LOW' as Priority),
      });
      onClose();
    } catch (e) {
      console.error(e);
    } finally {
      setIsSaving(false);
    }
  };

  const priorityOptions = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map(p => ({ value: p, label: p.toLowerCase() }));
  const dummyClientOptions = [{ value: 'client1', label: 'Acme Corp' }, { value: 'client2', label: 'Globex' }];
  const dummyComplexityOptions = [{ value: '1', label: '1 - Easy' }, { value: '2', label: '2 - Medium' }, { value: '3', label: '3 - Hard' }];

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div 
        className="relative w-full max-w-2xl my-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Form Container */}
        <div className="bg-[#121212] border border-[#332238] rounded-xl shadow-2xl p-6 flex flex-col gap-6 relative mt-8">
          
          {/* Header & Close Button */}
          <div className="flex items-center justify-between pb-2 border-b border-zinc-800/50">
            <h2 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-pink-500" />
              Add Task
            </h2>
            <button 
              onClick={onClose} 
              className="p-1.5 hover:bg-zinc-800/50 rounded-full text-zinc-500 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Client */}
          <DropdownField 
            label="Client" 
            required 
            value={client?.label}
            placeholder="Select a client"
            options={dummyClientOptions}
            onSelect={(c: any) => setClient(c)}
            rightAction={<RotateCw className="w-3.5 h-3.5 text-zinc-500 hover:text-zinc-300 cursor-pointer transition-colors" />}
          />

          {/* Task Title */}
          <div>
            <label className="block text-xs font-bold text-zinc-100 mb-1.5">Task Title <span className="text-zinc-500 font-normal ml-1">(Optional)</span></label>
            <input 
              type="text" 
              autoFocus
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full bg-[#18181b] border border-zinc-800 rounded-md px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#402a47] transition-colors"
              placeholder="Enter task title..."
            />
          </div>

          {/* Link / Channel */}
          <div>
            <label className="block text-xs font-bold text-zinc-100 mb-1.5">Link / Channel <span className="text-zinc-500 font-normal ml-1">(Optional)</span></label>
            <div className="relative flex items-center">
              <input 
                type="text" 
                className="w-full bg-[#18181b] border border-zinc-800 rounded-md pl-3 pr-28 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#402a47] transition-colors"
                placeholder="https://example.com or WhatsApp, Slack, Telegram..."
              />
              <div className="absolute right-2 flex items-center gap-1.5 cursor-pointer text-zinc-400 hover:text-zinc-200 transition-colors">
                <Link2 className="w-3.5 h-3.5" />
                <span className="text-xs font-semibold">Channels</span>
                <ChevronDown className="w-3.5 h-3.5" />
              </div>
            </div>
          </div>

          {/* Listed By */}
          <DropdownField 
            label="Listed By" 
            required 
            value={listedBy?.name}
            placeholder="Select who is listing this task..."
            options={users}
            onSelect={(u: any) => setListedBy(u)}
          />

          {/* Assignees */}
          <DropdownField 
            label="Assignees" 
            optional 
            value={assignee?.name}
            placeholder="Select assignees"
            options={users}
            onSelect={(u: any) => setAssignee({ id: u.id, name: u.name })}
          />

          <div className="grid grid-cols-2 gap-4">
            {/* Priority */}
            <DropdownField 
              label="Priority" 
              optional 
              value={priority?.toLowerCase()}
              placeholder="Select priority"
              options={priorityOptions}
              onSelect={(p: any) => setPriority(p.value as Priority)}
            />

            {/* Complexity */}
            <DropdownField 
              label="Complexity" 
              optional 
              value={complexity?.label}
              placeholder="Select complexity"
              options={dummyComplexityOptions}
              onSelect={(c: any) => setComplexity(c)}
            />
          </div>

          {/* Prompt */}
          <div>
            <label className="block text-xs font-bold text-zinc-100 mb-1.5">Prompt <span className="text-pink-500 ml-1">*</span></label>
            <textarea 
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full bg-[#18181b] border border-zinc-800 rounded-md px-3 py-3 text-sm text-zinc-100 focus:outline-none focus:border-[#402a47] transition-colors min-h-[120px] resize-y"
              placeholder="Describe the task details and requirements..."
            />
          </div>

          {/* Submit Button */}
          <button 
            onClick={handleSave}
            disabled={isSaving}
            className="w-full mt-2 flex items-center justify-center gap-2 py-3.5 bg-gradient-to-r from-purple-500 to-pink-500 hover:opacity-90 disabled:opacity-50 text-white text-sm font-bold rounded-md transition-opacity shadow-lg shadow-pink-500/10"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Create Task
          </button>
        </div>
      </div>
    </div>
  );
}
