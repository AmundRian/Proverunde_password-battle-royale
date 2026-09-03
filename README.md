# Prøverunde – Passordleken

Dette er en **helt separat treningsversjon** av Passord Battle Royale. Den er laget for å lære gjestene hvordan hovedleken fungerer uten å avsløre eller endre bryllupsreglene.

## Treningsregler
1. Minst 4 tegn
2. Minst ett tall
3. Minst én stor bokstav
4. En av fargene rød/blå/grønn (norsk eller engelsk)
5. Passordet må slutte med `!`

Reglene er kumulative. Fra runde 3 må passordet altså oppfylle regel 1, 2 og 3 samtidig.

## Hva deltakerne øver på
- skrive inn kallenavn
- skrive og sende passord
- vente på resultatet til runden er avsluttet
- se hvem som går videre
- se passordlengde
- kopiere en annen spillers passord mellom rundene
- forstå at identiske passord ikke kan brukes av to spillere i samme runde; den som leverer først beholder det

## Sikkerhet mot bryllupsleken
Dette prosjektet bruker Redis-nøkler med prefix `pbr-practice:v1:`. Den eksisterende bryllupsleken bruker andre nøkler (`pbr:*`). Dermed kan treningsspillet **ikke overskrive bryllupsspillets spillstatus**, selv om samme Redis-database ved en feil skulle kobles til.

Likevel anbefales det å opprette:
- et nytt GitHub-repository, f.eks. `password-battle-royale-practice`
- et nytt Vercel-prosjekt
- helst en egen Upstash Redis-database

**Ikke last disse filene inn i det eksisterende `password-battle-royale`-repositoryet.**

## Oppsett
1. Lag et helt nytt GitHub-repository: `password-battle-royale-practice`.
2. Last opp innholdet i denne mappen til det nye repositoryet.
3. I Vercel: **Add New → Project** og importer det nye practice-repositoryet.
4. Deploy.
5. Koble en Upstash Redis-database til det nye Vercel-prosjektet (helst en ny database).
6. Legg til `HOST_KEY` under Vercel → Environment Variables.
7. Redeploy.

Spilleradresse:
`https://DITT-PRACTICE-PROSJEKT.vercel.app/`

Hostadresse:
`https://DITT-PRACTICE-PROSJEKT.vercel.app/?host=1`

## Praktisk bruk i bryllupet
1. Vis QR-kode/lenke til prøvespillet.
2. Alle skriver inn et kallenavn.
3. Host starter runde 1 med f.eks. 30 sekunder.
4. Kjør 3–5 korte prøverunder.
5. Vis hvordan «Kopier» fungerer mellom rundene.
6. Nullstill eller avslutt practice-spillet.
7. Del deretter lenken til den ekte bryllupsleken.

Treningsspillet og bryllupsspillet er to separate Vercel-prosjekter og kan være åpne samtidig.
