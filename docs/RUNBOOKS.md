# Runbooks

## Queue Operations
- Check queue depth and failed jobs
- Re-run failed jobs after fix; ensure idempotency

## Publishing Incidents
- Verify provider status pages
- Switch off canary flag if elevated errors
- Retry with exponential backoff enabled

## Secrets Rotation
- Generate new encryption key; re-encrypt integrations
- Rotate provider tokens via OAuth

## Backups and Restores
- Verify daily DB backups; test restore quarterly

## Alerts
- Queue latency, error rate, publish failure rate, cost anomalies
