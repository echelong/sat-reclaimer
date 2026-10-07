# Development guidance

Primary goal: prove a safe, non-custodial Taproot inscription-UTXO reclaim flow before expanding product scope.

Use the main session as coordinator. Delegate independent protocol research, test-vector construction, UI work, and security review when that reduces coupling; the main session must verify all merged results.

Hard rules:

- Never request, persist, log, or transmit a seed phrase/private key.
- Keep Mainnet disabled until the milestone gates in `docs/ARCHITECTURE.md` pass.
- Signing and broadcasting remain separate operations during development.
- Every transaction must be decoded and invariant-checked independently of the code that built it.
- Deduplicate inputs by `txid:vout`.
- Never infer asset safety from inscription count alone.
- Avoid adding app/server custody infrastructure.
- Add tests before increasing supported batch sizes.

Current priority: M1 signer compatibility proof on Signet/Testnet.
