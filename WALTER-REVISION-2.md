# Walter revision 2

This update changes only Walter presentation/wording and the digit-sum wording.

## Changes

- Rule 8 now explicitly says Walter must be fed in every round from round 8 onward.
- During round 8, Walter is shown and clickable inside the Rule 8 card.
- From round 9 onward, Rule 8 is hidden from the visible active-rules list so the newest rule remains at the bottom.
- From round 9 onward, Walter appears beside the password entry field, with no visible reminder text before he is fed.
- Clicking Walter still makes him jump and shows `Walter er matet 🦴`; repeated clicks add more bones.
- Rule 12 now explains that digits are summed individually, with the example `2018 → 2 + 0 + 1 + 8 = 11`.

## Files to replace

- `api/_lib/game.js`
- `api/game.js`
- `src/main.js`
- `src/style.css`

No image files need to be replaced for this revision.
