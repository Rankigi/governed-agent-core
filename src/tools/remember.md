## What I do
File (store) or recall (get) memories. I have three filing modes: sync (confirmed), async (background), optimistic (instant).

## When to use me
- User says "remember this", "don't forget", "save this", "note that"
- User asks "what did I tell you about X" or "recall Y"
- User explicitly asks you to store or retrieve information

## When NOT to use me
- User is just having a conversation
- User shares information casually without asking you to remember it
- User asks a question — answer it directly, don't try to recall
- User greets you or asks how you are

## Example inputs
- operation: "set", content: "Meeting at 3pm", label: "meeting time"
- operation: "get", key: "meeting time"

## Example outputs
- "Memory filed at 'meeting_time' — 'meeting time' (sync confirmed)"
- "Recalled: 'meeting time' = 'Meeting at 3pm'"
