# Discovery analysis recovery

The previous client sent three requests in one call. Any provider or output-validation failure ended the whole loop; retry selected the same earliest unfinished batch. A single invalid strength or citation could therefore repeatedly block the remaining 22 requests.

The client now analyzes one request per call, gives recoverable failures one automatic retry, and continues to later requests after an isolated failure. Accepted results and manually edited annotations are retained. Stop cancels the active call or retry wait; resume selects only unfinished requests. Each attempt has a 115-second client deadline, covering the existing 12-second authentication and 95-second provider deadlines. There is no unbounded retry. Authentication, configuration, prolonged rate limits, or repeated rate limiting pause the run with an explanation.

A sticky progress panel above the request cards reports accepted/total, remaining, unresolved failures, current request, attempt and elapsed wait or retry countdown. Final states explicitly say complete, stopped, paused, or finished with requests needing retry. A failed call never becomes a “proper” assessment. Failure codes appear beside affected requests; confidential text and raw provider errors are not logged.

API failures distinguish timeout, connection/provider failure, output limit, invalid structured output, refusal, rate limit and configuration/quota errors. The client passes a validated retry reason; the second attempt reinforces concise, schema-correct output without weakening authority checks. Only an output-limit retry raises the output budget from 6,500 to 10,000 tokens. Model and authentication policy remain unchanged.

Verification targets: a 25-request queue with three completed and one persistent failure; transient recovery; stop during call/backoff; deadline recovery; identity mismatch; auth/config and rate-limit pauses; visible browser counts and retry status; preserved manual text and Word placement. The production provider's exact original 502 cause was not available from the screenshot; new response codes expose it on subsequent failures.

## Validation

- 49 discovery unit/integration tests pass, including ten queue recovery cases and typed provider failure tests.
- Browser checks pass with synthetic authenticated data and intercepted AI responses: 25 requests, stop at 3/25, resume 22, a persistent failure isolated while 21 others complete, a transient non-JSON 502 recovered, then retry to 25/25. Existing personal guidance, chat, manual annotation, Word export and mobile checks also pass with no browser page errors.
- Production build passes. Full repository suite before the two additional review regressions: 500 passed; the existing Formspree label expectation fails (`Send fee agreement for e-signature`), unchanged by this fix.
- Live provider output was not tested with the user's document or credentials. Their screenshot establishes repeated HTTP 502 responses; it does not identify which upstream failure generated them.

Final review regressions verify that Stop preserves prior failure details until success, and HTTP-date rate-limit instructions are honored.
