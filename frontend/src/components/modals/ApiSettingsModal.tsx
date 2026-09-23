import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Key, Plus, Trash2, Code, Activity, Copy, Check } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { usersApi } from '@/api';
import { toast } from '@/lib/toast';

interface ApiKey {
  id: string;
  name: string;
  key: string;
  createdAt: string;
  lastUsed: string | null;
}

interface ApiSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ApiSettingsModal({ isOpen, onClose }: ApiSettingsModalProps) {
  const currentUser = useAppStore(state => state.currentUser);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKeyName, setNewKeyName] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && currentUser) {
      loadKeys();
    }
  }, [isOpen, currentUser]);

  const loadKeys = async () => {
    if (!currentUser) return;
    try {
      setLoading(true);
      const res = await usersApi.getApiKeys(currentUser.id);
      setKeys(res.apiKeys);
    } catch (err: any) {
      toast.error('Failed to load API keys');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim() || !currentUser) return;

    try {
      const res = await usersApi.createApiKey(currentUser.id, newKeyName.trim());
      setKeys([res.apiKey, ...keys]);
      setNewKeyName('');
      toast.success('API Key created successfully');
    } catch (err: any) {
      toast.error('Failed to create API key');
    }
  };

  const handleDelete = async (keyId: string) => {
    if (!currentUser) return;
    try {
      await usersApi.deleteApiKey(currentUser.id, keyId);
      setKeys(keys.filter(k => k.id !== keyId));
      toast.success('API Key revoked');
    } catch (err: any) {
      toast.error('Failed to revoke API key');
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  if (!isOpen) return null;

  const baseUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/+$/, '') + '/api/external';

  if (typeof window === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl bg-[hsl(240,5.9%,10%)] border border-[hsl(240,3.7%,15.9%)] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[hsla(240, 5%, 44%, 1.00)] shrink-0">
          <div className="flex items-center gap-3 text-[hsl(240,4.8%,95.9%)]">
            <div className="p-2 bg-indigo-500/20 rounded-lg">
              <Code className="size-5 text-indigo-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">API Integrations</h2>
              <p className="text-xs text-[hsl(240,5%,64.9%)]">Manage API keys and connect external tools like n8n or spreadsheets.</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-[hsl(240,5%,64.9%)] hover:text-white hover:bg-[hsl(240,3.7%,15.9%)] rounded-lg transition-colors cursor-pointer">
            <X className="size-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8">

          {/* Documentation Section */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Activity className="size-4 text-cyan-400" /> Endpoint Documentation
            </h3>

            <div className="bg-[hsl(240,3.7%,15.9%)] p-4 rounded-lg space-y-5 text-sm text-[hsl(240,5%,64.9%)]">
              <div>
                <p className="font-medium text-white mb-1">Base URL</p>
                <code className="text-xs bg-black/30 px-2 py-1 rounded text-cyan-300">{baseUrl}</code>
              </div>

              {/* GET /tasks */}
              <div className="border-t border-white/5 pt-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-bold bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded">GET</span>
                  <p className="font-medium text-white">/tasks</p>
                </div>
                <p className="text-xs mb-1">Fetch tasks to pull into your spreadsheet or n8n workflow.</p>
                <p className="text-xs mb-2 text-zinc-500">Query params: <code className="text-zinc-400">status</code>, <code className="text-zinc-400">listId</code> (all optional, max 50 results)</p>

                {/* Example Request */}
                <div className="bg-black/30 p-2 rounded-md overflow-x-auto relative group mb-2">
                  <button
                    onClick={() => copyToClipboard(`curl -X GET "${baseUrl}/tasks?status=Pending" \\\n  -H "Authorization: Bearer YOUR_API_KEY"`, 'curl-get')}
                    className="absolute top-2 right-2 p-1.5 rounded-md bg-[hsl(240,3.7%,15.9%)] border border-white/5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[hsl(240,3.7%,25%)]"
                    title="Copy snippet"
                  >
                    {copiedKey === 'curl-get' ? <Check className="size-3.5 text-green-400" /> : <Copy className="size-3.5 text-zinc-400" />}
                  </button>
                  <pre className="text-[11px] text-zinc-300">
                    curl -X GET "{baseUrl}/tasks?status=Pending"\n
                    -H "Authorization: Bearer YOUR_API_KEY"
                  </pre>
                </div>

                {/* Response Schema */}
                <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">Response</p>
                <div className="bg-black/30 p-2 rounded-md overflow-x-auto relative group">
                  <button
                    onClick={() => copyToClipboard(`{
  "tasks": [
    {
      "id": "uuid",
      "title": "Landing Page Design",
      "status": "In Progress",
      "client": "Vipscale",
      "listName": "Sprint 3",
      "createdAt": "2026-09-17T10:00:00Z",
      "updatedAt": "2026-09-17T10:43:08Z",
      "link": "${baseUrl.replace('/api/external', '')}/lists/LIST_ID?task=TASK_ID"
    }
  ]
}`, 'res-get')}
                    className="absolute top-2 right-2 p-1.5 rounded-md bg-[hsl(240,3.7%,15.9%)] border border-white/5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[hsl(240,3.7%,25%)]"
                    title="Copy schema"
                  >
                    {copiedKey === 'res-get' ? <Check className="size-3.5 text-green-400" /> : <Copy className="size-3.5 text-zinc-400" />}
                  </button>
                  <pre className="text-[11px] text-zinc-300">{`{
  "tasks": [
    {
      "id": "uuid",
      "title": "Landing Page Design",
      "status": "In Progress",
      "client": "Vipscale",          ← Space / workspace name
      "listName": "Sprint 3",        ← List the task belongs to
      "createdAt": "2026-09-17T...",
      "updatedAt": "2026-09-17T...",
      "link": "https://app.../lists/LIST_ID?task=TASK_ID"
    }
  ]
}`}</pre>
                </div>
              </div>

              {/* POST /activity */}
              <div className="border-t border-white/5 pt-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-bold bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded">POST</span>
                  <p className="font-medium text-white">/activity</p>
                </div>
                <p className="text-xs mb-2">Log external activity to a specific task in Nexus (e.g. from n8n or a spreadsheet automation).</p>
                <div className="bg-black/30 p-2 rounded-md overflow-x-auto relative group mb-2">
                  <button
                    onClick={() => copyToClipboard(`curl -X POST "${baseUrl}/activity" \\\n  -H "Authorization: Bearer YOUR_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"taskId": "TASK_UUID", "action": "Sync via n8n"}'`, 'curl-post')}
                    className="absolute top-2 right-2 p-1.5 rounded-md bg-[hsl(240,3.7%,15.9%)] border border-white/5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[hsl(240,3.7%,25%)]"
                    title="Copy snippet"
                  >
                    {copiedKey === 'curl-post' ? <Check className="size-3.5 text-green-400" /> : <Copy className="size-3.5 text-zinc-400" />}
                  </button>
                  <pre className="text-[11px] text-zinc-300">
                    curl -X POST "{baseUrl}/activity"\n
                    -H "Authorization: Bearer YOUR_API_KEY"\n
                    -H "Content-Type: application/json"\n
                    -d '{"{"}\"taskId\": \"TASK_UUID\", \"action\": \"Sync via n8n\"{"}"}'
                  </pre>
                </div>

                {/* Body Schema */}
                <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">Body</p>
                <div className="bg-black/30 p-2 rounded-md mb-2">
                  <pre className="text-[11px] text-zinc-300">{`{
  "taskId": "TASK_UUID",   ← required
  "action": "string",      ← required (e.g. "Synced from Sheet")
  "details": {}            ← optional JSON metadata
}`}</pre>
                </div>

                {/* Response Schema */}
                <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">Response</p>
                <div className="bg-black/30 p-2 rounded-md">
                  <pre className="text-[11px] text-zinc-300">{`{
  "message": "Activity logged successfully",
  "auditLog": { "id": "...", "action": "...", "createdAt": "..." }
}`}</pre>
                </div>
              </div>

              {/* Auth info */}
              <div className="border-t border-white/5 pt-4">
                <p className="text-xs font-medium text-white mb-1">Authentication</p>
                <p className="text-xs">Pass your API key in the <code className="text-amber-300">Authorization</code> header as a Bearer token, or as an <code className="text-amber-300">x-api-key</code> header.</p>
                <div className="mt-2 bg-black/30 p-2 rounded-md">
                  <pre className="text-[11px] text-zinc-300">{`Authorization: Bearer nx_your_api_key_here
# OR
x-api-key: nx_your_api_key_here`}</pre>
                </div>
              </div>
            </div>
          </section>

          {/* API Keys Section */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Key className="size-4 text-amber-400" /> Your API Keys
            </h3>

            <form onSubmit={handleCreate} className="flex gap-2">
              <input
                type="text"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="e.g. n8n workflow"
                className="flex-1 bg-black/20 border border-[hsl(240,3.7%,15.9%)] rounded-lg px-3 text-sm text-white focus:outline-none focus:border-indigo-500"
              />
              <button
                type="submit"
                disabled={!newKeyName.trim()}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
              >
                <Plus className="size-4" /> Create Key
              </button>
            </form>

            <div className="space-y-2">
              {loading ? (
                <p className="text-xs text-center text-zinc-500 py-4">Loading keys...</p>
              ) : keys.length === 0 ? (
                <p className="text-xs text-center text-zinc-500 py-4">No API keys generated yet.</p>
              ) : (
                keys.map(key => (
                  <div key={key.id} className="flex items-center justify-between p-3 border border-[hsl(240,3.7%,15.9%)] rounded-lg bg-black/10">
                    <div>
                      <p className="text-sm font-medium text-white">{key.name}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <code className="text-xs text-amber-300/70 font-mono">{key.key.substring(0, 8)}...{key.key.substring(key.key.length - 4)}</code>
                        <button
                          onClick={() => copyToClipboard(key.key, key.id)}
                          className="text-zinc-500 hover:text-white transition-colors"
                          title="Copy full key"
                        >
                          {copiedKey === key.id ? <Check className="size-3 text-green-400" /> : <Copy className="size-3" />}
                        </button>
                      </div>
                      <p className="text-[10px] text-zinc-500 mt-1">Created: {new Date(key.createdAt).toLocaleDateString()}</p>
                    </div>
                    <button
                      onClick={() => handleDelete(key.id)}
                      className="p-2 text-zinc-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                      title="Revoke key"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>

        </div>
      </div>
    </div>,
    document.body
  );
}
