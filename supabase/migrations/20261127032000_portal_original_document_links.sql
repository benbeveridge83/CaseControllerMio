-- Preserve each existing released set's verified original-document reference.
-- The lookup verifies the document's owner, native set and matter association.
update public.mio_portal_discovery_sets s set source_document_id=x.document->>'id'
from public.mio_portal_discovery_sources(array(select id from public.mio_portal_discovery_sets where revoked_at is null and source_document_id is null),false) x
where s.id=x.set_id and s.source_document_id is null;
