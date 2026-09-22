-- V323 database behaviour tests: posting, duplicate protection, rollback, corrections and
-- matching. Runs against an isolated PostgreSQL with the synthetic fixture; never against Mio.
\set ON_ERROR_STOP on
-- The two provider accounts are mapped by an administrator exactly as reported.
select public.mio_map_lawpay_account_v323(jsonb_build_object('provider_account_id','acct-91075','account_key','trust','bank_account_id','plaid-trust','bank_role','trust','label','Trust / IOLTA 1075'),'ben@firm');
select public.mio_map_lawpay_account_v323(jsonb_build_object('provider_account_id','acct-91077','account_key','operating','bank_account_id','plaid-operating','bank_role','operating','label','Operating 1077'),'ben@firm');

-- 1. A mapped trust charge posts once and credits trust by the stored provider amount.
select public.mio_post_lawpay_classification_v323(jsonb_build_object(
  'gateway_transaction_id','lawpay-charge-rooney','ownership','matter','matter_id','matter-rooney',
  'actual_account_key','trust','account_source','reported_by_lawpay','category','trust_deposit'),'ben@firm')
where not exists (select 1 from public.mio_lawpay_classifications where identity = 'lawpay-charge-rooney');
do $$ begin
  if (select count(*) from public.mio_lawpay_ledger_entries where identity = 'lawpay-charge-rooney') <> 1 then raise exception 'a trust deposit must post exactly one ledger entry'; end if;
  if (select sum(case when direction = 'in' then amount_cents else -amount_cents end) from public.mio_lawpay_ledger_entries where identity = 'lawpay-charge-rooney') <> 500000 then raise exception 'the trust deposit must be the stored provider amount'; end if;
  if (select posting_status from public.mio_lawpay_classifications where identity = 'lawpay-charge-rooney') <> 'posted' then raise exception 'the classification must be posted'; end if;
  if (select amount_cents from public.mio_lawpay_classifications where identity = 'lawpay-charge-rooney') <> 500000 then raise exception 'the posted amount must come from the stored provider record'; end if;
end $$;

-- 2. A retry, rescan or webhook replay about the same transaction posts nothing more.
select public.mio_post_lawpay_classification_v323(jsonb_build_object(
  'gateway_transaction_id','lawpay-charge-rooney','ownership','matter','matter_id','matter-rooney',
  'actual_account_key','trust','account_source','reported_by_lawpay','category','trust_deposit'),'ben@firm');
do $$ begin
  if (select count(*) from public.mio_lawpay_ledger_entries where identity = 'lawpay-charge-rooney') <> 1 then raise exception 'a repeated posting attempt must not add a second ledger entry'; end if;
  if (select count(*) from public.mio_lawpay_classifications where identity = 'lawpay-charge-rooney' and posting_status = 'posted') <> 1 then raise exception 'only one classification may be posted per transaction'; end if;
end $$;

-- 3. An unresolved deposit account is refused and saved as a review item instead.
do $$
declare r jsonb;
begin
  r := public.mio_post_lawpay_classification_v323(jsonb_build_object('gateway_transaction_id','lawpay-unmapped-charge','ownership','matter','matter_id','matter-south','actual_account_key','','account_source','','category','trust_deposit'),'ben@firm');
  if r->>'status' <> 'account_not_established' then raise exception 'an unestablished account must be refused, got %', r->>'status'; end if;
  if exists (select 1 from public.mio_lawpay_ledger_entries where identity = 'lawpay-unmapped-charge') then raise exception 'a refused posting must not write a ledger entry'; end if;
  r := public.mio_save_lawpay_classification_v323(jsonb_build_object('gateway_transaction_id','lawpay-unmapped-charge','ownership','matter','matter_id','matter-south','category','trust_deposit','other_reason',''),'ben@firm');
  if r->>'status' <> 'saved' then raise exception 'saving for later must succeed, got %', r->>'status'; end if;
  if (select count(*) from public.mio_lawpay_ledger_entries where identity = 'lawpay-unmapped-charge') <> 0 then raise exception 'a saved review item must not post anything'; end if;
end $$;

-- 4. Records LawPay has not completed never post, and a void is not money movement.
do $$
declare r jsonb;
begin
  r := public.mio_post_lawpay_classification_v323(jsonb_build_object('gateway_transaction_id','lawpay-pending-south','ownership','matter','matter_id','matter-south','actual_account_key','operating','account_source','reported_by_lawpay','category','consultation_payment'),'ben@firm');
  if r->>'status' <> 'not_postable' then raise exception 'a pending charge must not post, got %', r->>'status'; end if;
  r := public.mio_post_lawpay_classification_v323(jsonb_build_object('gateway_transaction_id','lawpay-consult-south','ownership','matter','matter_id','matter-south','actual_account_key','operating','account_source','reported_by_lawpay','category','void'),'ben@firm');
  if r->>'status' <> 'no_money_moved' then raise exception 'a void must record no money movement, got %', r->>'status'; end if;
end $$;

-- 5. A refused posting rolls back completely: no classification and no invoice event.
do $$
begin
  begin
    perform public.mio_post_lawpay_classification_v323(jsonb_build_object('gateway_transaction_id','lawpay-consult-south','ownership','matter','matter_id','matter-south','actual_account_key','operating','account_source','reported_by_lawpay','category','earned_fee_payment','invoice_id','10000000-0000-4000-8000-0000000000c2'),'ben@firm');
    raise exception 'expected the invoice from another matter to be refused';
  exception when others then
    if position('different matter' in sqlerrm) = 0 then raise; end if;
  end;
  if exists (select 1 from public.mio_lawpay_classifications where identity = 'lawpay-consult-south') then raise exception 'a refused posting must leave no classification behind'; end if;
  if exists (select 1 from public.mio_invoice_events where provider_event_id = 'lawpay-consult-south') then raise exception 'a refused posting must leave no invoice event behind'; end if;
end $$;

-- 6. A correction reverses the old entry and posts a linked replacement.
do $$
declare r jsonb; prev uuid;
begin
  select id into prev from public.mio_lawpay_classifications where identity = 'lawpay-charge-rooney' and posting_status = 'posted';
  r := public.mio_correct_lawpay_classification_v323(jsonb_build_object('gateway_transaction_id','lawpay-charge-rooney','ownership','matter','matter_id','matter-rooney','actual_account_key','operating','account_source','reported_by_lawpay','category','consultation_payment'),'This was earned fees in operating, not a trust deposit','ben@firm');
  if r->>'status' <> 'posted' then raise exception 'the corrected classification must post, got %', r->>'status'; end if;
  if (select posting_status from public.mio_lawpay_classifications where id = prev) <> 'reversed' then raise exception 'the previous classification must be marked reversed, never deleted'; end if;
  if (select count(*) from public.mio_lawpay_ledger_entries where identity = 'lawpay-charge-rooney' and entry_kind = 'reversal') <> 1 then raise exception 'the previous trust entry must be reversed by exactly one linked entry'; end if;
  if (select coalesce(sum(case when direction = 'in' then amount_cents else -amount_cents end),0) from public.mio_lawpay_ledger_entries where identity = 'lawpay-charge-rooney') <> 0 then raise exception 'a corrected trust posting must net to zero'; end if;
  if (select corrects_classification_id from public.mio_lawpay_classifications where id = (r->>'classification_id')::uuid) is distinct from prev then raise exception 'the corrected record must link to the one it replaces'; end if;
  if (select count(*) from public.mio_lawpay_classifications where identity = 'lawpay-charge-rooney' and posting_status = 'posted') <> 1 then raise exception 'exactly one classification may be posted per transaction'; end if;
end $$;

-- 7. A refused correction leaves the recorded classification and its entry untouched.
do $$
declare prev uuid; reversals_before integer;
begin
  select id into prev from public.mio_lawpay_classifications where identity = 'lawpay-charge-rooney' and posting_status = 'posted';
  select count(*) into reversals_before from public.mio_lawpay_ledger_entries where identity = 'lawpay-charge-rooney' and entry_kind = 'reversal';
  begin
    perform public.mio_correct_lawpay_classification_v323(jsonb_build_object('gateway_transaction_id','lawpay-charge-rooney','ownership','matter','matter_id','matter-south','actual_account_key','operating','account_source','reported_by_lawpay','category','earned_fee_payment','invoice_id','10000000-0000-4000-8000-0000000000c2'),'invoice belongs to another matter','ben@firm');
    raise exception 'expected the corrected posting to be refused';
  exception when others then
    if position('different matter' in sqlerrm) = 0 then raise; end if;
  end;
  if (select posting_status from public.mio_lawpay_classifications where id = prev) <> 'posted' then raise exception 'a refused correction must leave the recorded classification intact'; end if;
  if (select count(*) from public.mio_lawpay_ledger_entries where identity = 'lawpay-charge-rooney' and entry_kind = 'reversal') <> reversals_before then raise exception 'a refused correction must not leave a reversal entry behind'; end if;
end $$;

-- 8. Matching uses the stored entry and prevents conflicting matches.
do $$
declare r jsonb;
begin
  r := public.mio_match_lawpay_classification_v323(jsonb_build_object('gateway_transaction_id','lawpay-refund-rooney','ownership','matter','matter_id','matter-rooney','category','client_refund','matched_entry_id','opening-trust-row-4','matched_entry_source','trust_ledger'),'00000000-0000-4000-8000-0000000000aa','ben@firm');
  if r->>'status' <> 'matched' then raise exception 'the refund must match the stored opening-balance entry, got %', r->>'status'; end if;
  if exists (select 1 from public.mio_lawpay_ledger_entries where identity = 'lawpay-refund-rooney') then raise exception 'matching must never write another ledger entry'; end if;
  if (select posting_status from public.mio_lawpay_classifications where identity = 'lawpay-refund-rooney') <> 'matched' then raise exception 'the matched classification must be recorded as matched'; end if;
  r := public.mio_post_lawpay_classification_v323(jsonb_build_object('gateway_transaction_id','lawpay-refund-rooney','ownership','matter','matter_id','matter-rooney','actual_account_key','trust','account_source','reported_by_lawpay','category','client_refund'),'ben@firm');
  if r->>'status' <> 'already_posted' then raise exception 'a matched transaction must not post afterwards, got %', r->>'status'; end if;
  r := public.mio_match_lawpay_classification_v323(jsonb_build_object('gateway_transaction_id','lawpay-refunded-charge','ownership','matter','matter_id','matter-rooney','category','client_refund','matched_entry_id','opening-trust-row-4','matched_entry_source','trust_ledger'),'00000000-0000-4000-8000-0000000000aa','ben@firm');
  if r->>'status' <> 'entry_already_matched' then raise exception 'an entry already matched must not account for another transaction, got %', r->>'status'; end if;
  r := public.mio_match_lawpay_classification_v323(jsonb_build_object('gateway_transaction_id','lawpay-unmapped-charge','ownership','matter','matter_id','matter-south','category','consultation_payment','matched_entry_id','not-a-real-entry','matched_entry_source','trust_ledger'),'00000000-0000-4000-8000-0000000000aa','ben@firm');
  if r->>'status' <> 'entry_not_found' then raise exception 'an entry that does not exist must never match, got %', r->>'status'; end if;
end $$;

-- A wrong amount, the opposite direction, or another account's ledger never matches.
do $$
declare r jsonb;
begin
  begin
    perform public.mio_match_lawpay_classification_v323(jsonb_build_object('gateway_transaction_id','lawpay-consult-south','ownership','matter','matter_id','matter-south','category','consultation_payment','matched_entry_id','opening-trust-row-6','matched_entry_source','trust_ledger'),'00000000-0000-4000-8000-0000000000aa','ben@firm');
    raise exception 'expected the mismatched amount to be refused';
  exception when others then
    if position('not the same amount' in sqlerrm) = 0 then raise; end if;
  end;
  begin
    perform public.mio_match_lawpay_classification_v323(jsonb_build_object('gateway_transaction_id','lawpay-refund-2','ownership','matter','matter_id','matter-south','category','client_refund','matched_entry_id','opening-trust-row-5','matched_entry_source','trust_ledger'),'00000000-0000-4000-8000-0000000000aa','ben@firm');
    raise exception 'expected the opposite direction to be refused';
  exception when others then
    if position('other way' in sqlerrm) = 0 then raise; end if;
  end;
  -- The ledger is looked up for the signed-in account, so another account's entry is never found.
  r := public.mio_match_lawpay_classification_v323(jsonb_build_object('gateway_transaction_id','lawpay-consult-south','ownership','matter','matter_id','matter-south','category','consultation_payment','matched_entry_id','opening-trust-row-5','matched_entry_source','trust_ledger'),'11111111-0000-4000-8000-0000000000bb','ben@firm');
  if r->>'status' <> 'entry_not_found' then raise exception 'another account''s ledger must never be matched, got %', r->>'status'; end if;
end $$;

-- 9. A refund reduces trust once, keeps an unverified original-payment relationship flagged,
-- and a refunded total on a charge never writes a ledger entry by itself.
do $$
declare r jsonb;
begin
  r := public.mio_post_lawpay_classification_v323(jsonb_build_object('gateway_transaction_id','lawpay-refund-2','ownership','matter','matter_id','matter-rooney','actual_account_key','trust','account_source','reported_by_lawpay','category','client_refund'),'ben@firm');
  if r->>'status' <> 'posted' then raise exception 'the trust refund must record, got %', r->>'status'; end if;
  if (r->>'trust_delta_cents')::bigint <> -25000 then raise exception 'a trust refund must reduce trust by the stored provider amount, got %', r->>'trust_delta_cents'; end if;
  if (select count(*) from public.mio_lawpay_ledger_entries where identity = 'lawpay-refund-2') <> 1 then raise exception 'a refund must post exactly one entry'; end if;
  if (select original_link_verified from public.mio_lawpay_classifications where identity = 'lawpay-refund-2') <> false then raise exception 'an unverified original-payment relationship must stay flagged, never guessed'; end if;
  perform public.mio_post_lawpay_classification_v323(jsonb_build_object('gateway_transaction_id','lawpay-refund-2','ownership','matter','matter_id','matter-rooney','actual_account_key','trust','account_source','reported_by_lawpay','category','client_refund'),'ben@firm');
  if (select count(*) from public.mio_lawpay_ledger_entries where identity = 'lawpay-refund-2') <> 1 then raise exception 'a repeated refund attempt must not reduce trust twice'; end if;
  if (select count(*) from public.mio_lawpay_ledger_entries where identity = 'lawpay-refunded-charge') <> 0 then raise exception 'a refunded total on a charge must never create a ledger entry by itself'; end if;
end $$;

-- 10. Concurrency, retries and webhook replays are exercised by the runner: two overlapping
-- sessions posting the same provider transaction must leave exactly one posted classification
-- and one ledger entry. The partial unique index on the posting identity is the last line of
-- defence behind the advisory lock.
select 'ALL V323 DATABASE TESTS PASSED' as result;
