# 0002 - epoch is the whole of the state

Status: Accepted

## Context

A real observatory has sessions, caches and a "latest" reading. Those are
necessary for operations, and they are the reason a colleague cannot paste a
URL into Slack and get back the same number they were looking at.

## Decision

The observation epoch is a single integer number of seconds from a fixed start,
carried in every URL as `?epoch=`. Nothing else comprises the state: no
cookies, no server-side session, no local storage, no "last viewed".

## Consequences

- Every rendered page is a pure function of `(catalogue, seed, epoch, volcano)`,
  which is what makes the time machine possible.
- A URL can be bookmarked, shared and re-opened months later with an identical
  result.
- The trade-off is that answers are never "live" in the production sense. The
  relay daemon makes up for this by walking the year on a fixed cadence, but
  even then the numbers it shows came from a request it made, not from a sensor.
