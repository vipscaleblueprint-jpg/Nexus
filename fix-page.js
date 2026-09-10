const fs = require('fs');

const code = `                                      tempCheckbox.removeAttribute('checked');
                                    }
                                    
                                    // Also update the parent li data-checked attribute for Tiptap
                                    const li = tempCheckbox.closest('li[data-type="taskItem"]');
                                    if (li) {
                                      li.setAttribute('data-checked', isChecked ? 'true' : 'false');
                                    }
                                    
                                    const newContent = tempDiv.innerHTML;
                                    
                                    // Update blocks state and save
                                    const updated = blocks.map(b => b.id === block.id ? { ...b, content: newContent } : b);
                                    setBlocks(updated);
                                    handleSavePage(updated);
                                    
                                    if (socket) {
                                      socket.emit('block_content_update', { docId: id, blockId: block.id, content: newContent });
                                    }
                                  }
                                }
                                return; // Prevent focusing the block
                              }

                              if (!isLockedBySomeoneElse) handleFocusBlock(block.id);
                            }}
                            className={\`flex-1 \${!isLockedBySomeoneElse ? 'cursor-text select-text' : 'cursor-not-allowed text-zinc-500 select-none'} min-h-[24px]\`}
                          >
                            {block.content?.includes('data-type="live-kanban-block"') ? (
                              <div className="pointer-events-none">
                                <BlockEditor
                                  editable={false}
                                  content={block.content}
                                  onChange={() => {}}
                                  onBlur={() => {}}
                                />
                              </div>
                            ) : (
                              <div
                                className={\`prose prose-invert max-w-none text-sm text-zinc-100 prose-p:my-0 prose-headings:my-0 prose-ul:my-0 prose-ol:my-0 \${block.content ? '' : 'text-zinc-600 italic'}\`}
                                dangerouslySetInnerHTML={{ __html: block.content || 'Write text...' }}
                              />
                            )}
                          </div>
                        )}
                      </div>

                      {/* Assignee badges */}
                      {block.assignees && block.assignees.length > 0 && (
                        <div className="flex items-center gap-1 shrink-0 ml-1">
                          {block.assignees.map((ass, idx) => (
                            <span
                              key={idx}
                              className="h-4 min-w-[16px] px-1 rounded-full text-[9px] font-extrabold flex items-center justify-center bg-zinc-700 text-zinc-200 border border-zinc-700/60"
                            >
                              {ass.value}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Block Hover Actions */}
                      <div className={\`transition-opacity flex items-center gap-1 absolute right-2 bottom-1 bg-[#0d0d0d] px-1 py-1 rounded-md shadow-sm border border-zinc-800 \${focusedBlockId === block.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}\`}>
                        {isLockedBySomeoneElse && (
                          <div className="px-1.5 py-1 text-red-500 flex items-center gap-1 bg-red-950/40 rounded shadow-sm border border-red-900/50" title={\`Locked by \${block.lockedByName || 'another user'}\`}>
                            <Lock className="w-3 h-3" />
                            <span className="text-[10px] font-bold tracking-wide">
                              LOCKED BY {block.lockedByName ? block.lockedByName.toUpperCase() : 'USER'}
                            </span>
                          </div>
`;

let content = fs.readFileSync('c:\\Codes\\Nexus\\frontend\\src\\app\\docs\\[id]\\page.tsx', 'utf8');

// Find the exact marker where things broke
const searchStr = `                                      tempCheckbox.setAttribute('checked', 'checked');
                                    } else {`;
const endStr = `                        )}
                      </div>
                    </div>
                  );`;

const startIndex = content.indexOf(searchStr);
if (startIndex !== -1) {
  const insertIndex = startIndex + searchStr.length;
  const endIndex = content.indexOf(endStr, insertIndex);
  
  if (endIndex !== -1) {
    content = content.slice(0, insertIndex) + '\n' + code + '\n' + content.slice(endIndex);
    fs.writeFileSync('c:\\Codes\\Nexus\\frontend\\src\\app\\docs\\[id]\\page.tsx', content);
    console.log("SUCCESS");
  } else {
    console.log("Could not find end index");
  }
} else {
  console.log("Could not find start index");
}
