# Contributing

Khone welcomes practical feedback, substantiated bug reports, feature requests,
and real-world use cases through GitHub issues.

This project does not accept unsolicited external pull requests.

## Why Pull Requests Are Limited

This is a maintainer-capacity, project-direction, and supply-chain security
boundary.

Modern coding agents make it inexpensive to generate plausible-looking code
changes, bug reports, and security claims at high volume. Careful review still
requires project context, reproduction, testing, design judgment, and trust.
Unsubstantiated reports and broad unsolicited pull requests can consume more
maintainer time than the original change took to generate.

Untrusted pull requests can also exercise CI/CD paths and increase the risk of
workflow or supply-chain abuse. Keeping implementation pull requests under
maintainer control reduces that attack surface while keeping the issue tracker
open for useful feedback.

This policy is not a rejection of AI-assisted work. AI-assisted reports are
welcome when a person has verified the claim, understands the issue, and can
provide concrete evidence.

## Accepted Contribution Channels

Please use GitHub issues for:

- Reproducible bug reports.
- Feature requests tied to a real use case.
- Design feedback about APIs, deployment model, batching behavior, docs, or
  operational tradeoffs.
- Examples of confusing documentation or unclear project boundaries.

If a bug report or feature request is accepted, a maintainer will create the
implementation pull request. The original reporter may be invited to review,
test, and comment on that pull request.

External pull requests may be considered only after explicit maintainer
invitation for a specific accepted issue.

## Bug Reports

Good bug reports include:

- The Khone version or commit tested.
- The affected component, such as gateway, bootstrap, adapter, benchmark,
  examples, docs, or website.
- Reproduction steps.
- Expected behavior.
- Actual behavior.
- Relevant logs, stack traces, configuration snippets, or minimal examples.
- Environment details such as runtime, AWS service, region, deployment mode, and
  local tool versions when relevant.

Please do not submit generated bug reports or vulnerability claims that you
cannot reproduce or explain.

## Feature Requests

Good feature requests describe:

- The problem or workflow you are trying to support.
- Why the current behavior is insufficient.
- The desired outcome.
- Operational constraints or tradeoffs, especially around latency, cost,
  batching behavior, Lambda limits, and deployment model.
- Any current workaround.

Implementation ideas are welcome, but the most valuable part of a feature
request is the problem statement and use case.

## Security-Sensitive Reports

Do not include secrets, credentials, private infrastructure details, or exploit
instructions against live systems in a public issue.

If a security report is sensitive, use GitHub private vulnerability reporting if
it is available for the repository. If no private reporting channel is visible,
open a minimal public issue asking for maintainer contact without including the
sensitive technical details.
