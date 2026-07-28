# Disaster recovery

1. Stop the process and preserve the failed data directory without editing it.
2. Locate the newest backup and its separately stored master key.
3. Run a dry-run restore and investigate any checksum or state replay failure.
4. Restore into a new directory; never restore over the damaged source.
5. Start the service with the original public URL and master key.
6. Confirm readiness, passkey login, upstream credential decryption, and call
   history before re-enabling agent traffic.
7. Rotate downstream client tokens if their plaintext may have been exposed.
8. Rotate upstream credentials if the data directory or master key was exposed.

The configuration journal fails closed on checksum errors or sequence gaps.
The call journal tolerates only an incomplete final JSONL line, which represents
a crash during append. Any earlier malformed line is treated as corruption.
