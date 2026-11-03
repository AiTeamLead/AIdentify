# ZAP baseline

Run OWASP ZAP against a staging URL, never production.

```bash
docker run --rm -t zaproxy/zap-stable zap-baseline.py -t https://YOUR-PREVIEW.vercel.app -r zap-baseline.html
```

Review the HTML report. Treat new high alerts as release blockers. The baseline does not replace a lawyer’s review of the privacy pages or a full penetration test.

Do not point ZAP at `aidentify` or `aidentify-demo`.
