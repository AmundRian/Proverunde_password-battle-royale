# Password length ranking update

This update adds password-length ranking after every round and changes the final winner logic.

## New behavior
- After each closed round, submitted passwords are sorted from shortest to longest.
- Each submitted password shows its character count and rank.
- Players who did not submit are shown last and are not ranked.
- The host sees the same ranking, plus the shortest submitted password length in round statistics and history.
- After the final round, only players who passed all active rules are eligible to win.
- The eligible player(s) with the shortest password win.
- Equal shortest lengths result in joint winners.
- A lone surviving player before the final round must still continue through the remaining rounds; the game only ends early if no players remain.

## Files changed
- api/game.js
- src/main.js
