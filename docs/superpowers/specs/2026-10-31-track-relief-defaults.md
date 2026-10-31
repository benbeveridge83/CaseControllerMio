# Track and matter defaults for Requested Relief
Approved in conversation: implement and publish.

- Each matter has a separate Proceeding default (Original or Modification), stored in existing cloud-backed matter extras. Older matters remain unspecified.
- Use the existing order_type filter group as the shared track/order dictionary. Initial values: final, temporary, tro, other. Keep stable IDs, custom choices, names and archives.
- Default Final Relief tracks resolve to final automatically. Add Track offers temporary, tro, other and custom active choices, excluding final. Discovery requests/responses retain their existing workspace and type.
- New requested relief inherits proceeding from its matter and order type from its track. Track and party entry points preserve their existing associations. Reused content adopts the destination context, not the source matter's filters. Existing saved filter contexts (including All/None) remain unchanged.
- Allow changing filters for one relief and restoring current matter/track defaults without deleting selections or text. Unknown older tracks remain unfiltered.
- Compact the setup UI around prefilled matter, track, party and defaults with expandable changes and optional filing/hearing controls.
- Keep drafting, service, hearings and order workflow expansion out of scope.
