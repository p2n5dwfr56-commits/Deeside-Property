# Simulated test mailbox

These emails are **simulated test cases**, not real notifications. Every one is marked `[SIMULATED TEST]`, carries the header
`X-DPW-Simulated: 1`, and uses fictional properties with listing numbers starting 999 (the links do not lead anywhere real).

In test mode the worker "delivers" each email once `X-DPW-Deliver-After-Hours` hours have passed since test mode was first
started, so successive scheduled runs receive them in order:

| Hours | Email | What it tests |
|---|---|---|
| 0 | Rightmove: 3 new | new listings; one address with no house number |
| 0 | ASPC: 2 new | same Torphins house as Rightmove, written differently: matched into one record with two listings |
| 3 | Zoopla: 1 new | "17 Station Road" looks like Rightmove's "Station Road" house: flagged for review, not merged |
| 6 | Rightmove: reduced | second notification for an existing property: £285,000 → £275,000 recorded in its history |
| 24 | Rightmove: under offer | status change reported by the source |
| 24 | OnTheMarket: 1 new | a fourth source |
| 48 | Rightmove: back on market | Under offer → Returned to market, with a £5,000 reduction |
| 48 | ASPC: unreadable layout | reported as a collection problem, nothing invented |
| 48 | Not a property email | ignored |
