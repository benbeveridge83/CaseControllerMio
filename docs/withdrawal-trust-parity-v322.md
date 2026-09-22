# Withdrawal rows and Bulk billing must agree on trust (V322)

## What was wrong

1. The withdrawal page drew at most twelve lines on its trust graph, while the table under it
   listed every matching matter ("Review all 20 matching matters"). Because most matters sit on
   the same balances, the drawn lines also overlapped into one black line, so a list of twenty
   looked like about seven lines.
2. The trust amount on a withdrawal row could differ from the Bulk billing trust amount for the
   same matter. Both screens calculate from the same records, but the withdrawal page only used
   the records that happened to be loaded in that tab. A tab opened before a LawPay receipt
   arrived - or a tab that never opened Billing - showed a trust balance built from an older set
   of records, with nothing on screen saying so.

## What changed

- `src/MioWithdrawalBlocks.jsx` plots every matching matter. The graph note now says how many
  matters are plotted, that red is withdrawing, that each other line keeps its own color, and
  that trust uses the same records Bulk billing shows.
- `src/mioWithdrawalInlineApp.inc` gives every non-withdrawing line its own color, so
  overlapping balances can still be told apart in the legend.
- `mio-v306-withdrawal-graph-table.js` keeps the graph set and the table set identical
  (`graphFinance = matchingFinance`).
- `src/mioFinanceReviewApp.inc` reloads the same read-only records Bulk billing uses whenever
  the Withdrawals page opens, regains focus, or every two minutes. The LawPay gateway sync stays
  on Billing and LawPay; Withdrawals never posts money.
- The Withdrawals header has **Refresh financial data**. It reports success, reports how many
  records could not be reloaded, and shows when the records were last reloaded. A refresh that
  cannot load LawPay receipts now fails loudly instead of looking current
  (`refreshMioFinancialGraphData` reports `{ok, failures}`).

## Verification

`node tests/withdrawal-finance-parity-browser.mjs` runs the real production bundle against
synthetic records and asserts:

- the graph plots all fourteen matching matters (the old code stopped at twelve),
- every withdrawal row's trust amount equals the Bulk billing trust amount for the same matter,
- an open withdrawal tab converges on a second Bulk billing tab's amount after a new LawPay
  trust charge arrives.

Bulk billing rounds its trust column to whole dollars while the withdrawal rows keep cents, so
page-to-page parity is compared within one dollar. `scripts/test-withdrawal-release.mjs` fails
the build if a fixed cap ever reappears on the graph.
