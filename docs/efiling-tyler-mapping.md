# Tyler EFM API Field Mapping (Placeholder)

This is a placeholder mapping between Mio e-filing fields and Tyler EFM. Final
Tyler field names are **pending the EFM Documentation ZIP review** — do not invent
Tyler fields yet. Use "pending Tyler API docs" until the real names are confirmed.

| Mio Field | Tyler API Field | Source in Mio | Required? | Auto-fill Confidence | Fallback Question |
| --- | --- | --- | --- | --- | --- |
| court / county | pending Tyler API docs | matter court settings (`courts.county`, `courts.court_name`) | yes | medium | Which court/location? |
| cause number | pending Tyler API docs | `matters.cause_number` | yes for existing case | high if present | Is this an initial filing or existing case? |
| filing mode | pending Tyler API docs | user action: E-File / E-File & Serve / E-Serve Only | yes | high | E-file only, e-file and serve, or e-serve only? |
| service contacts | pending Tyler API docs | matter contacts / Tyler lookup later | if serving | medium | Confirm service recipients. |
| payment account | pending Tyler API docs | e-filing settings later (TOGA) | usually yes | low until TOGA setup | Which payment account? |
| filing code | pending Tyler API docs | document type → filing code mapping (to build) | yes | low (needs mapping) | Which filing code / document type? |
| filing description | pending Tyler API docs | `documents.file_name` / title | yes | high | Confirm the filing description. |
| document security | pending Tyler API docs | user action (public/sensitive/confidential) | yes | high | Public, sensitive, or confidential? |
| lead document | pending Tyler API docs | selected matter document (`documents.file_url` / upload payload) | yes | high if present | Which document? Is it a PDF? |
| attachments | pending Tyler API docs | matter documents | no | medium | Add attachments? |
| filing attorney | pending Tyler API docs | `team_members` (name/email) + default | yes | high | Which attorney is filing? |
| bar number | pending Tyler API docs | drafting profile signature block `bar_number` | yes | medium (profile-based) | Confirm/enter the bar number. |
| case type/category | pending Tyler API docs | `matters.matter_type` | yes | medium | Which case type? |
| EFSP name | pending Tyler API docs | e-filing settings | yes | high (config) | — |
| callback URL | pending Tyler API docs | e-filing settings | yes | high (config) | — |

## Notes

- Confidence reflects how reliably Mio can auto-fill today **before** Tyler
  credentials/config exist. "high" does not mean verified against Tyler.
- Payment account, filing code mapping, and e-service contact lists are the three
  biggest gaps and are the next settings/data to add once TOGA and Tyler code sets
  are available.
- No live Tyler field values are assumed; all Tyler column values stay
  "pending Tyler API docs" until the final EFM ZIP is reviewed.
