# Neste forbedringer

Denne versjonen bygger videre på Siri/Marius-versjonen og legger til:

1. **Kopier som startpassord:** Når en deltaker trykker `Kopier` på et avslørt passord, lagres det som automatisk startpassord i neste runde. Hvis deltakeren ikke kopierer noen andre, brukes eget forrige passord som før.
2. **Samlet rangering:** Mellom rundene ser både deltakere og host en samlet rangering. Spillere som fortsatt er med rangeres øverst. Eliminerte rangeres etter hvor langt de kom, deretter kortest passord innen samme elimineringsrunde.
3. **Regeltekst:** Regel 2.2 avslører ikke lenger de romerske symbolene. Regel 10 bruker ikke lenger papir/ull som eksempler og sier i stedet at ordet `bryllup` ikke må inkluderes.
4. **Siri-tema:** Kallenavnet `Siri` får et eget bryllupstema på regelkortet.
5. **Marius-tema:** Kallenavnet `Marius` får et bevisst stygt/humoristisk regeltema og en lett ertende melding mellom rundene.

Filer som må erstattes:

- `api/_lib/game.js`
- `api/game.js`
- `src/main.js`
- `src/style.css`
