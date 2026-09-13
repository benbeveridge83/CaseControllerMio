# Meta Ads Workspace V318 — Design

## Goal

Give Case Controller Mio full read/write control over the firm's Meta advertising account while preserving a strict human-approval model. Mio should be able to inspect, analyze, create, edit, pause/resume, and verify Facebook/Instagram campaigns, ad sets, ads, and creatives. AI may recommend changes but may never publish without the user's explicit approval of the exact live change.

## Current State

`api/meta-ads.js` already supports:

- Firm-authenticated connection status
- Account reporting
- Campaign, ad set, and ad performance reads
- Platform, device, and regional breakdowns
- AI audit of supplied reporting data

The current server route accepts only `status`, `report`, and `audit`; there is no Meta mutation endpoint yet.

## Scope

### Included in V318

1. Read actual Meta campaign structure and creative details.
2. Read campaign/ad set/ad status, budgets, objectives, targeting summaries, placements, and performance.
3. Read creative copy, destination URL, call-to-action, image/video identifiers, and previewable media where Meta exposes them.
4. Pause/resume campaigns, ad sets, and ads.
5. Edit supported campaign and ad set fields such as budget/status where Meta allows direct mutation.
6. Edit existing ad creative by creating a replacement creative/ad revision where Meta requires immutability rather than pretending the existing creative is directly editable.
7. Create new campaigns, ad sets, creatives, and ads from Mio.
8. Support single-image and single-video Facebook/Instagram ads for the first creation workflow.
9. Select existing Meta image/video assets.
10. Upload new images from Mio.
11. Add video upload/processing support using an explicit asynchronous processing state before the video can be attached to an ad.
12. Show Facebook/Instagram ad previews using Meta preview APIs or the closest faithful representation available.
13. Provide AI suggestions based on actual account structure, creative, performance, placement, and audience data.
14. Require explicit approval before each live Meta write.
15. Maintain an auditable change history.
16. Re-read affected Meta resources after each mutation and show verified, failed, skipped, or unverified status.

### Not included initially

- Every specialized Meta format (carousel, collection, Advantage+ catalog, dynamic product ads, etc.).
- Automatic autonomous publishing.
- Automatic budget increases.
- Automatic creative replacement based solely on AI recommendations.

These can be added after the single-image/video workflow is stable.

## User Experience

### Meta Ads Workspace

The existing Marketing/Meta area should gain a dedicated workspace similar in philosophy to the Google Ads workspace.

Primary hierarchy:

- Account
  - Campaign
    - Ad Set
      - Ad
        - Creative

Selecting an item should show:

- Name and Meta ID
- Current status/effective status
- Budget and schedule where applicable
- Objective and optimization settings
- Placement summary
- Targeting summary
- Actual creative text/media/CTA/destination
- Performance for the selected date range
- Recent change history
- AI recommendations

### Create New Ad Flow

Creation should follow Meta's real dependency order:

1. Campaign
2. Ad Set
3. Creative
4. Ad

Mio should allow the user to draft all four before anything is written. The review screen should clearly separate:

- resources that will be created
- resources that already exist and will be reused
- exact settings and copy
- media selected/uploaded
- budget and schedule
- targeting/placements

The user then checks an explicit authorization control and clicks `Authorize & apply`.

### Existing Ad Editing

Where Meta allows direct field updates, Mio may update the resource after approval. Where Meta treats a creative as immutable, Mio should transparently create the replacement creative and update/create the appropriate ad revision. The UI must explain this instead of claiming an in-place edit occurred.

## Authorization and Safety

### Human Approval

AI is advisory only. No Meta write may occur from an AI recommendation alone.

Every mutation must display a before/after or create-summary review and require explicit approval from the user.

### Server-Side Guardrails

Add server-side safeguards:

- firm-user authentication
- approver allowlist/role check
- write-enabled environment flag
- required Meta permissions check before enabling write operations
- resource ID/account ownership validation
- accepted-action allowlist
- stale-resource protection for destructive or material edits
- idempotency key for create operations to reduce accidental duplicates
- post-write verification read
- structured audit record for every attempted mutation

### Permission Check

Mio should check the token/account for the permissions needed for intended operations. At minimum, the UI should distinguish:

- connected/readable
- read-only due to missing ad-management permission
- write-capable
- expired/invalid token

Write controls remain disabled unless the required permissions are confirmed.

## API Design

Keep Meta logic server-side. Extend `api/meta-ads.js` or split it into focused modules if size/complexity warrants it.

Recommended logical operations:

- `status`
- `report`
- `audit`
- `workspace`
- `permissions`
- `media`
- `preview`
- `mutate`

`mutate` accepts only a constrained action enum, for example:

- `campaign_create`
- `campaign_update`
- `campaign_status`
- `adset_create`
- `adset_update`
- `adset_status`
- `creative_create`
- `ad_create`
- `ad_status`
- `image_upload`
- `video_upload_start`
- `video_status`

The server constructs Graph API requests itself rather than accepting arbitrary paths or arbitrary Graph payloads from the browser.

## Data Flow

### Reads

Browser -> Mio Meta API -> Meta Graph API -> normalized response -> workspace UI.

### Writes

1. Browser creates local draft.
2. Browser requests server-side validation/review data.
3. User approves exact operation.
4. Browser submits approved mutation request with current resource version/snapshot identifiers where applicable.
5. Server authenticates Mio user and checks Meta write capability.
6. Server validates action and payload.
7. Server writes to Meta.
8. Server re-reads the affected resource(s).
9. Server records requested change, Meta response, verification result, user, and timestamps.
10. UI shows verified/failed/skipped/unverified result.

## Media Handling

### Existing Media

Read usable account/page image and video assets where the Marketing API exposes them and allow selection inside the creation flow.

### Image Upload

Support direct image upload through the server to the ad account. Store only Meta asset identifiers/hashes in Mio history unless a local copy is needed elsewhere.

### Video Upload

Video processing is asynchronous. The workflow must use states such as:

- uploading
- processing
- ready
- failed

Mio should not allow final ad creation until Meta reports the video ready.

## Creative Preview

Use Meta's ad preview capability where feasible. If Meta cannot return a preview for a draft state before resource creation, show a clearly labeled Mio approximation rather than presenting it as the final Meta rendering.

## AI Recommendations

AI may inspect:

- campaign/ad set/ad performance
- creative copy
- objective
- placements
- device/platform breakdowns
- region and demographic data where Meta legally/API-permissibly reports it
- frequency/fatigue indicators
- lead signals

AI output must distinguish facts from recommendations and must never claim it made a live change unless a verified mutation result exists.

## Change History

Create/extend a Supabase-backed Meta Ads change log containing:

- user ID/email
- Meta account ID
- entity type and ID
- action
- before snapshot
- proposed snapshot
- Meta response summary
- verification snapshot
- result state
- error text if any
- created timestamp

Suggested result states:

- verified
- failed
- skipped
- unverified

## Error Handling

Show Meta user-facing API errors whenever available, but do not leak tokens or secrets.

Common error categories should be normalized:

- authentication/token expired
- missing permission
- policy restriction
- invalid targeting/objective combination
- invalid creative/media
- duplicate/idempotency conflict
- stale resource
- Meta transient/server error
- post-write verification mismatch

No failed write should be silently retried if retrying could duplicate a campaign/ad set/ad.

## Testing

### Unit/Server Tests

Test:

- permission gating
- firm-user authentication
- mutation action allowlist
- payload validation
- idempotency behavior
- normalization of Meta errors
- immutable creative replacement behavior
- post-write verification logic
- audit log creation

### UI Tests

Test:

- read-only mode when write permissions are absent
- create flow draft -> review -> authorization
- pause/resume flow
- budget edit flow
- image selection/upload
- video processing state
- before/after comparison
- failed and unverified outcomes

### Production Smoke Test

Before merging to production:

1. Confirm read connection.
2. Confirm write-capability check.
3. Use a harmless or paused test resource when available for the first mutation.
4. Verify Meta reflects the change.
5. Verify Mio re-read matches Meta.
6. Verify change history contains the operation.

Do not perform a live budget increase or launch a new active ad as the first production mutation.

## Rollout

1. Build and test on `feat/meta-ads-workspace-v318`.
2. Deploy preview environment.
3. Verify read mode against the real account.
4. Confirm required Meta permissions/token capabilities.
5. Enable write controls only after capability verification.
6. Test a low-risk mutation.
7. Test draft creation using a paused resource.
8. Merge only after tests and production-safe verification pass.

## Success Criteria

V318 is successful when the user can open Mio and, without using Meta Ads Manager for ordinary work:

- inspect actual Facebook/Instagram campaigns, ad sets, ads, creative, and performance
- receive AI recommendations
- draft a new campaign/ad set/ad
- choose or upload media
- review exactly what will happen
- explicitly authorize the change
- have Mio apply it through Meta's API
- see a verified result and permanent history

At no point may AI publish a live change without the user's explicit authorization.
