---
name: thread-cleaner
description: Review and archive completed or unwanted BB conversations using Needs You.
---

Open Needs You → Thread cleaner. The Open threads view lists visible threads across projects, including read or dismissed conversations. Filter by project, title, or inactivity; select up to 100 per page. Done & archive records completion in Needs You; Archive unwanted records that a conversation is no longer needed. Neither changes linked Tracker tasks.

The server's cleanerList RPC supports archived, query, projectId, olderThanDays and offset. cleanerPreview accepts threadIds and reason (done or unneeded), and returns a five-minute, single-use token with the full affected thread list. cleanerArchive accepts that token only; it rechecks thread state and reports archivedIds and per-thread errors. Never treat a partial result as full success. cleanerRestore accepts threadIds and returns restoredIds/errors; restoring a parent also restores children from its recorded archive batch.

Keep the full preview visible before archive confirmation. BB also archives children and hidden forks, and can remove managed workspace files after its grace period. Conversation history is retained, but restoring it does not recover removed workspace files. Running, pinned, waiting, queued, or background-active threads and their parents are protected. Never auto-archive just because a thread is old or a turn finished.
