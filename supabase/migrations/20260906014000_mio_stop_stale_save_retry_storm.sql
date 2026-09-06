-- Application version conflicts are permanent for this request, not serialization failures.
-- Preserve the existing function and all permission/CAS checks; change only its two error codes.
DO $migration$
DECLARE definition text; conflicts integer;
BEGIN
  definition := pg_get_functiondef('public.mio_cloud_state_write_v277(uuid,text,text,timestamptz,boolean,boolean,text)'::regprocedure);
  conflicts := (length(definition) - length(replace(definition, 'errcode=''40001''', ''))) / length('errcode=''40001''');
  IF conflicts = 0 AND position('errcode=''PT409''' in definition) > 0 THEN RETURN; END IF;
  IF conflicts <> 2 THEN RAISE EXCEPTION 'Cloud write function changed; expected two application conflict guards, found %', conflicts; END IF;
  EXECUTE replace(definition, 'errcode=''40001''', 'errcode=''PT409''');
END
$migration$;
NOTIFY pgrst, 'reload schema';
