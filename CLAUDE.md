# Development guidance

Primary goal: prove a safe, non-custodial Taproot inscription-UTXO reclaim flow before expanding product scope.

Use the main session as coordinator. Delegate independent protocol research, test-vector construction, UI work, and security review when that reduces coupling; the main session must verify all merged results.

Hard rules:

- Never request, persist, log, or transmit a seed phrase/private key.
- Mainnet is disabled by default. It may be enabled only by an explicit operator flag (`NEXT_PUBLIC_ENABLE_MAINNET=true`) for the Sweep All workflow; never as a default, a silent fallback, or by treating Mainnet as a test chain. See `docs/ARCHITECTURE.md` M5.
- Signing and broadcasting remain separate operations: signing never broadcasts, and broadcasting is a separate manual action authorized for one exact verified txid.
- Mainnet broadcasting requires a second explicit operator flag (`NEXT_PUBLIC_ENABLE_MAINNET_BROADCAST=true`) on top of `NEXT_PUBLIC_ENABLE_MAINNET=true`. Never resubmit automatically after an ambiguous network response, and never sign a replacement on the app's initiative.
- Every transaction must be decoded and invariant-checked independently of the code that built it.
- Deduplicate inputs by `txid:vout`.
- Never infer asset safety from inscription count alone.
- Avoid adding app/server custody infrastructure.
- Add tests before increasing supported batch sizes.
- Keep presentation separate from the engine. The landing page, the animated hero and the simulated demo must not import from `src/lib`, and no motion effect may ever sit between a user and a wallet confirmation or a transaction review. Public marketing copy must not claim an audit, a confirmation, or a recovery that has not been verified on chain.

Current priority: M2 — get one real Mainnet inscription sweep broadcast and confirmed. Reuse the exact verified transaction when it still exists; otherwise rebuild only after confirming the previous txid is unknown and its inputs are unspent. Broadcast manually through independent nodes, compare the returned txid, and track confirmation.
