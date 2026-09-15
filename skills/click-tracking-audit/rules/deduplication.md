# Deduplication

Compare browser and server event names and IDs. One business event must have a
deterministic event ID and idempotency key. A successful local queue write is not
a provider receipt.