# Security policy

## Supported versions

Security fixes target the latest `main` branch. OpenRound is pre-release software;
older commits and experimental branches do not have a support commitment.

## Reporting a vulnerability

Do not publish credentials, exploitable security details, or personal location
data in a public issue. Use GitHub's **Security → Report a vulnerability** when
private vulnerability reporting is enabled for this repository:
https://github.com/marcusgoll/openround-public/security/advisories/new

If that option is unavailable, open an issue containing only a request for a
private contact channel. Wait for the maintainer to establish that channel before
sending sensitive details. Reports should include affected versions, reproduction
steps using synthetic data, impact, and any suggested mitigation. No response-time
or bounty commitment is offered.

## Data and credentials

Rounds, GPS observations, vendor exports, and native journals can identify a
player and their movements. Keep backups private and sanitize shared examples.
Browser data and native app data are separate; do not uninstall an app holding the
only copy of your history.

Keep Shot Scope credentials in prompts or local environment variables. Never
commit environment files or signing material. Variables prefixed `VITE_` are
public browser configuration, not a safe place for secrets. Restrict any optional
Google Maps browser key to the intended origins and APIs in your provider account.

Map, weather, course, and vendor requests contact external providers. Review
[the privacy notes](docs/privacy.md) before using real location data.

Before publication, scan all Git history as well as the working tree. Removing a
secret from the latest revision does not remove it from history. If a real secret
is found, revoke/rotate it and review history remediation before publishing.
