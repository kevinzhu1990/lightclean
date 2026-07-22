# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest release | Yes |
| Older versions | No |

We recommend always running the latest version of Kudu.

## Reporting a Vulnerability

If you discover a security vulnerability in Kudu, **please do not open a public issue.**

Instead, report it privately via [GitHub Security Advisories](https://github.com/adventdevinc/kudu/security/advisories/new).

Please include:

- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will acknowledge your report within 48 hours and aim to release a fix as quickly as possible. You will be credited in the release notes unless you prefer otherwise.

## Scope

This policy covers the Kudu desktop application and its source code. It does not cover third-party dependencies — please report those to the respective maintainers.

## Security Design

Kudu is a system cleaner that operates with elevated permissions. We take this responsibility seriously:

- **No telemetry** — Kudu does not phone home or collect any user data.
- **No network requests** — Scans and cleaning operations are entirely local. Network access is only used for update checks and optional cloud features you explicitly enable.
- **Open source** — Every operation is auditable. We encourage security researchers to review our code.
- **VirusTotal scanned** — Every release binary is automatically submitted to VirusTotal and results are linked in the release notes.
- **Signed binaries** — Windows releases are code-signed.
