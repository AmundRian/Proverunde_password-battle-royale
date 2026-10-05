# Walter layout + rule 14 update

This revision contains two gameplay/UI changes:

1. From round 9 onward, Walter is shown below the password field instead of beside it. He keeps the same compact size, jump animation and bone counter. The password field gets the full card width and its font shrinks automatically for long passwords.
2. New rule 14: the password must contain exactly one choice category: stein/rock, saks/scissors or papir/paper. When the round closes, the choice category/categories with the highest count advance. Lower-count categories are eliminated. If two categories tie for the highest count, both advance; if all three tie, all advance.

The group comparison is applied from round 14 onward because the game's rules are cumulative. Only players who are otherwise valid for the round (including Walter and duplicate checks) are counted in the majority calculation.
