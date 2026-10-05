# Password Battle Royale – improvements update

This update keeps the existing wedding rules and adds four gameplay improvements:

1. Host round statistics, including elimination counts and the rule(s) each eliminated player broke.
2. All players can see every participant's submitted game password after a round closes.
3. Submissions are neutral while a round is open; pass/fail is only revealed after the host closes the round.
4. A surviving player's previous submitted password is pre-filled in the next round on the same browser/device.

## Files changed

Only these two files need to be replaced in GitHub:

- `api/game.js`
- `src/main.js`

No Redis, Vercel environment variable, wedding-rule-list, or HOST_KEY changes are required.

## Important

Because submitted passwords are revealed to other players after each round, players are warned in the lobby not to use a real password from any account.
