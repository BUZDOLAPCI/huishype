-- Read-only aggregate audit. Run with default_transaction_read_only=on.
-- This matches the final source bootstrap's conservative NL address identity.
WITH duplicate_ids AS (
  SELECT global_id FROM listings
  WHERE global_id IS NOT NULL AND global_id <> ''
  GROUP BY global_id HAVING count(*) > 1
), normalized AS (
  SELECT l.global_id, l.address_id,
    upper(regexp_replace(coalesce(a.postal_code,''), '\s', '', 'g')) AS postal,
    btrim(coalesce(a.house_number,'')) AS house,
    regexp_replace(upper(regexp_replace(coalesce(a.house_number_addition,''), '\s', '', 'g')), '^-', '') AS addition,
    nullif(btrim(a.street),'') IS NOT NULL AND nullif(btrim(a.city),'') IS NOT NULL AS named_address,
    CASE lower(btrim(l.price_type)) WHEN 'buy' THEN 'sale' ELSE lower(btrim(l.price_type)) END AS transaction_type,
    l.price_type AS raw_transaction_type,
    l.status IN ('available','under_bid','in_onderhandeling','conditional','under_negotiation')
      AND l.last_seen_at > statement_timestamp() - interval '30 days' AS current_eligible
  FROM listings l JOIN duplicate_ids d ON d.global_id=l.global_id
  LEFT JOIN addresses a ON a.id=l.address_id
), rows AS (
  SELECT *, nullif(regexp_replace(addition, '^([A-Z]+)-?([0-9]+)$', '\1-\2'),'') AS canonical_addition,
    postal ~ '^[1-9][0-9]{3}[A-Z]{2}$' AND house <> '' AND named_address AS complete_address
  FROM normalized
), groups AS (
  SELECT global_id, count(*) AS row_count,
    count(DISTINCT address_id) AS address_id_count,
    bool_and(address_id IS NOT NULL) AS all_address_ids_present,
    bool_and(complete_address) AS all_addresses_complete,
    count(DISTINCT (postal,house,canonical_addition)) AS property_tuple_count,
    count(DISTINCT transaction_type) AS transaction_count,
    bool_and(coalesce(transaction_type IN ('sale','rent'),false)) AS all_transactions_known,
    count(DISTINCT raw_transaction_type) AS raw_transaction_count,
    count(*) FILTER (WHERE current_eligible) AS current_eligible_rows,
    bool_or(current_eligible) AS has_current_eligible
  FROM rows GROUP BY global_id
), classified AS (
  SELECT *, CASE
    WHEN NOT all_addresses_complete OR NOT all_address_ids_present THEN 'incomplete_address'
    WHEN property_tuple_count > 1 THEN 'distinct_complete_addresses'
    WHEN NOT all_transactions_known OR transaction_count <> 1 THEN 'different_or_unknown_transaction'
    ELSE 'same_complete_property_and_transaction'
  END AS classification
  FROM groups
)
SELECT jsonb_build_object(
  'observed_at', statement_timestamp(),
  'duplicate_global_id_groups', count(*),
  'duplicate_rows', sum(row_count),
  'different_address_id_groups', count(*) FILTER (WHERE address_id_count > 1),
  'safe_same_property_groups', count(*) FILTER (WHERE classification='same_complete_property_and_transaction'),
  'safe_same_property_rows', coalesce(sum(row_count) FILTER (WHERE classification='same_complete_property_and_transaction'),0),
  'safe_different_address_id_groups', count(*) FILTER (WHERE classification='same_complete_property_and_transaction' AND address_id_count > 1),
  'safe_different_address_id_rows', coalesce(sum(row_count) FILTER (WHERE classification='same_complete_property_and_transaction' AND address_id_count > 1),0),
  'safe_groups_rejected_by_old_502', count(*) FILTER (WHERE classification='same_complete_property_and_transaction' AND (address_id_count <> 1 OR raw_transaction_count <> 1)),
  'safe_old_rejected_current_eligible_groups', count(*) FILTER (WHERE classification='same_complete_property_and_transaction' AND (address_id_count <> 1 OR raw_transaction_count <> 1) AND has_current_eligible),
  'safe_old_rejected_current_eligible_rows', coalesce(sum(current_eligible_rows) FILTER (WHERE classification='same_complete_property_and_transaction' AND (address_id_count <> 1 OR raw_transaction_count <> 1)),0),
  'safe_buy_sale_alias_groups', count(*) FILTER (WHERE classification='same_complete_property_and_transaction' AND raw_transaction_count > 1),
  'distinct_complete_address_groups', count(*) FILTER (WHERE classification='distinct_complete_addresses'),
  'incomplete_address_groups', count(*) FILTER (WHERE classification='incomplete_address'),
  'different_or_unknown_transaction_groups', count(*) FILTER (WHERE classification='different_or_unknown_transaction')
) FROM classified;
