# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration stores and sends:

- `/data/azuracast-state.json` holds what the integration saw of each station
  (on air or not, the play in progress, the live show, the peak of the day and
  the listener thresholds reached). No secret is written there.
- The API key lives in the Gladys configuration of the integration. It is sent
  only to the AzuraCast address configured, on `/api/station/<id>/status` and
  `/api/station/<id>/backend/skip` — never on the public routes, never
  logged — and redirects are not followed, so it never reaches another host.
- The album art is fetched from the configured address, whatever host
  AzuraCast writes in its URLs, without the key.
- The container only talks to that AzuraCast server and to Gladys.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and the AzuraCast server the integration talks to.
