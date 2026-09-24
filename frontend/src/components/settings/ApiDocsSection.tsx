import React from 'react';
import { Book, Code, List, CheckCircle, MessageSquare, Activity, Key, CornerDownRight, Box } from 'lucide-react';

const ENDPOINTS = [
  {
    id: "auth",
    method: "AUTH",
    path: "Authentication",
    title: "How to authenticate",
    icon: Key,
    description: "All API requests require an API key passed in the headers. You can generate API keys in the section above.",
    request: {
      headers: {
        "Authorization": "Bearer <YOUR_API_KEY>"
      }
    }
  },
  {
    id: "tasks-get",
    method: "GET",
    path: "/api/external/tasks",
    title: "List Tasks",
    icon: List,
    description: "Retrieve a list of tasks. You can optionally filter by status or listId.",
    request: {
      query: "?status=Pending&listId=list_123"
    },
    response: {
      "tasks": [
        {
          "id": "task_abc123",
          "title": "Fix the navigation bar",
          "status": "Pending",
          "client": "Acme Corp",
          "listName": "Sprint 1",
          "createdAt": "2023-10-12T07:20:50.52Z"
        }
      ]
    }
  },
  {
    id: "tasks-create",
    method: "POST",
    path: "/api/external/tasks",
    title: "Create Task",
    icon: CheckCircle,
    description: "Create a new task. If `assigneeId` is not provided, the task remains unassigned. Tasks are automatically injected into the Priorities Journal.",
    request: {
      body: {
        "title": "Design new landing page",
        "listId": "list_abc123",
        "description": "Ensure it uses the new color palette.",
        "priority": "HIGH",
        "status": "Pending",
        "assigneeId": "user_xyz789"
      }
    },
    response: {
      "message": "Task created successfully",
      "task": {
        "id": "task_xyz789",
        "title": "Design new landing page",
        "status": "Pending"
      }
    }
  },
  {
    id: "tasks-update",
    method: "PATCH",
    path: "/api/external/tasks/:taskId",
    title: "Update Task",
    icon: Box,
    description: "Update fields on an existing task. Only include fields you want to change.",
    request: {
      body: {
        "status": "In Progress",
        "priority": "URGENT"
      }
    },
    response: {
      "message": "Task updated successfully",
      "task": {
        "id": "task_xyz789",
        "status": "In Progress"
      }
    }
  },
  {
    id: "comments",
    method: "POST",
    path: "/api/external/comment",
    title: "Post Comment",
    icon: MessageSquare,
    description: "Add a new comment to a task.",
    request: {
      body: {
        "taskId": "task_xyz789",
        "content": "I have started working on this."
      }
    },
    response: {
      "message": "Comment added successfully"
    }
  },
  {
    id: "activity",
    method: "POST",
    path: "/api/external/activity",
    title: "Log Activity",
    icon: Activity,
    description: "Manually log a custom activity event on a task.",
    request: {
      body: {
        "taskId": "task_xyz789",
        "type": "STATUS_CHANGE",
        "oldValue": "Pending",
        "newValue": "In Progress"
      }
    },
    response: {
      "message": "Activity logged successfully"
    }
  }
];

export function ApiDocsSection({ innerRef }: { innerRef: React.RefObject<HTMLDivElement | null> }) {
  const getMethodColor = (method: string) => {
    switch (method) {
      case 'GET': return 'text-blue-400 bg-blue-400/10 border-blue-400/20';
      case 'POST': return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20';
      case 'PATCH': return 'text-amber-400 bg-amber-400/10 border-amber-400/20';
      case 'PUT': return 'text-orange-400 bg-orange-400/10 border-orange-400/20';
      case 'DELETE': return 'text-rose-400 bg-rose-400/10 border-rose-400/20';
      case 'AUTH': return 'text-indigo-400 bg-indigo-400/10 border-indigo-400/20';
      default: return 'text-zinc-400 bg-zinc-400/10 border-zinc-400/20';
    }
  };

  return (
    <section id="docs" ref={innerRef} className="scroll-mt-8 space-y-6">
      <div className="bg-[#121214] border border-zinc-800 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-800 bg-[#151518]">
          <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
            <Book className="w-4 h-4 text-zinc-400" />
            API Documentation
          </h2>
        </div>
        
        <div className="p-6 space-y-12 text-zinc-300">
          <div>
            <h1 className="text-xl font-bold text-white mb-2">Nexus API Reference</h1>
            <p className="text-sm text-zinc-400 leading-relaxed">
              Integrate Nexus with your internal tools, CRMs, and custom workflows. 
              All requests are made to the base URL <code className="bg-zinc-800/50 px-1.5 py-0.5 rounded text-indigo-300">/api/external</code> 
              and require an API key for authentication.
            </p>
          </div>

          <div className="space-y-8">
            {ENDPOINTS.map((endpoint) => (
              <div 
                key={endpoint.id} 
                className="bg-[#151518] border border-zinc-800/80 rounded-xl overflow-hidden"
              >
                {/* Endpoint Header */}
                <div className="px-5 py-3 border-b border-zinc-800 bg-[#18181b] flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center gap-2.5">
                    <endpoint.icon className="w-4 h-4 text-zinc-500" />
                    <h2 className="text-sm font-semibold text-zinc-100">{endpoint.title}</h2>
                  </div>
                  <div className="flex items-center gap-2 bg-[#0a0a0a] border border-zinc-800 px-2 py-1 rounded">
                    <span className={`text-[10px] font-bold ${getMethodColor(endpoint.method).split(' ')[0]}`}>
                      {endpoint.method}
                    </span>
                    <span className="text-xs font-mono text-zinc-300">{endpoint.path}</span>
                  </div>
                </div>

                {/* Endpoint Body */}
                <div className="p-5 space-y-4">
                  <p className="text-xs text-zinc-400">{endpoint.description}</p>
                  
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* Request Payload */}
                    <div className="space-y-2">
                      <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                        <CornerDownRight className="w-3 h-3" /> Request
                      </h3>
                      <div className="bg-[#0a0a0a] border border-zinc-800/80 rounded-md p-3 font-mono text-[11px] overflow-x-auto text-indigo-200">
                        <pre>{JSON.stringify(endpoint.request, null, 2)}</pre>
                      </div>
                    </div>

                    {/* Response Payload */}
                    {endpoint.response && (
                      <div className="space-y-2">
                        <h3 className="text-[10px] font-bold text-emerald-500/70 uppercase tracking-wider flex items-center gap-1.5">
                          <CheckCircle className="w-3 h-3" /> Response
                        </h3>
                        <div className="bg-[#0a0a0a] border border-zinc-800/80 rounded-md p-3 font-mono text-[11px] overflow-x-auto text-emerald-200/80">
                          <pre>{JSON.stringify(endpoint.response, null, 2)}</pre>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
