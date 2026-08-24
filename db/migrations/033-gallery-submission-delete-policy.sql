-- Fixes "Reject" not actually deleting a gallery submission — and, less
-- visibly, "Add to gallery" silently failing to clear the original out
-- of the review queue after publishing it. Both call
-- storage.remove() on the gallery-submissions bucket, but that bucket
-- only ever had an insert policy (a member uploading into their own
-- folder) and a select policy (the president browsing the queue,
-- migration 028) — no delete policy at all, for anyone. The request
-- wasn't erroring loudly; it was just being silently refused by RLS,
-- which is exactly the kind of failure that looks like "nothing
-- happened" from the UI.
--
-- Run this once in Supabase: Dashboard → SQL Editor → New query, paste,
-- Run. Needs 025 (is_president()) already applied.

create policy "President can delete gallery submissions"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'gallery-submissions' and public.is_president());
