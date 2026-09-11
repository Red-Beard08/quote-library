# Current-vault regression fixtures

These fixtures capture the public shapes observed during the Quote Library compatibility freeze on 2026-09-09. They are representative copies, not a migration source and not a substitute for the user's vault.

- `active-pinned.md` represents an active pinned quote.
- `archived-duplicate.md` represents a retained archived secondary with a duplicate link.
- `legacy-shape.md` represents a readable legacy quote using `last_updated` and an uppercase `Tags` field.

The fixture set intentionally does not contain private quote text beyond the minimum needed to exercise parsing and duplicate/archive behavior.
