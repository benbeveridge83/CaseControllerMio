create index if not exists mio_efiling_status_audit_submission_idx on public.mio_efiling_status_audit(submission_id);
create index if not exists mio_efiling_status_audit_receipt_idx on public.mio_efiling_status_audit(receipt_id) where receipt_id is not null;
