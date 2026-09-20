-- Use a non-partial unique index so PostgREST onConflict can enforce per-message task idempotency.
DROP INDEX IF EXISTS public.saeed_ai_task_message_once;
CREATE UNIQUE INDEX saeed_ai_task_message_once ON public.saeed_ai_tasks(source_update_id, source_item);
