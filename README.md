# Floorballflash

Webbsida med lagets spelprogram och resultat från innebandyförbundets API (samma data som
[stats.innebandy.se/sasong/44/lag/120879/spelprogram](https://stats.innebandy.se/sasong/44/lag/120879/spelprogram)),
liveuppdateringar under matcherna och filmklipp som godkända användare laddar upp och alla kan titta på.

## Funktioner

- **Spelprogram och resultat** – kommande matcher, pågående matcher och resultat.
- **Live** – servern hämtar pågående matcher var 20:e sekund och skickar ändringar direkt till
  webbläsaren (Server-Sent Events). Matchsidan visar ställning, periodresultat, mål och utvisningar.
- **Livesändning via VDO.Ninja** – på varje matchsida kan en inloggad användare koppla en länk från
  [vdo.ninja](https://vdo.ninja) (eller låta sidan skapa en ny sändning). Sändningen bäddas in på
  matchsidan för alla besökare och startsidan markerar matchen med *📹 Video*. Både visningslänk
  (`?view=…`) och sändningslänk (`?push=…`) går att klistra in – besökarna får alltid bara
  visningslänken. Den som kopplat sändningen (och admin) ser länken för kameran och kan byta eller
  ta bort sändningen.
- **Filmklipp** – inloggade användare laddar upp klipp (mp4, mov, m4v, webm, ogv) till en match.
  Alla besökare kan titta, utan inloggning.
- **Inloggning med e-post och pinkod** – pinkoden är exakt 8 tecken (bokstäver/siffror).
  Nya konton måste godkännas: ett mejl med knapparna *Godkänn användare* och *Neka användare* skickas
  till administratören (`ADMIN_EMAIL`, standard andreas.wallin@gmail.com). Användaren får besked via mejl.
- **Adminsida** (`/admin.html`) – administratören loggar in med samma e-postadress och ett starkt
  lösenord (minst 12 tecken, tre teckentyper). Lösenordet skapas/återställs via en engångslänk
  som mejlas till administratörsadressen, så ingen annan kan ta över kontot. På adminsidan kan man
  godkänna, neka, spärra och ta bort användare, ge ny pinkod, ta bort klipp, ändra lag/säsong och
  se skickad e-post.
- **Databas** – allt sparas i SQLite (`data/floorballflash.db`), filmerna i `data/uploads/`.

## Kom igång

Kräver Node.js 22.13 eller senare.

```bash
npm install
cp .env.example .env    # fyll i PUBLIC_URL och SMTP-uppgifter
node --env-file=.env --disable-warning=ExperimentalWarning src/server.js
```

Demo utan internet/SMTP (påhittade matcher, en pågående match som uppdateras live):

```bash
npm run dev    # http://localhost:3000
```

Utan SMTP skrivs mejlen till serverloggen, där godkännande- och lösenordslänkarna går att kopiera.

### Första inloggningen som admin

1. Gå till `/admin.html` och klicka **Skapa / glömt lösenord**.
2. Öppna länken i mejlet till administratörsadressen och välj ett starkt lösenord.
3. Logga in med administratörens e-postadress och lösenordet.

### Docker

```bash
docker build -t floorballflash .
docker run -d -p 3000:3000 -v floorballflash-data:/data --env-file .env floorballflash
```

Kör bakom HTTPS (t.ex. Caddy eller nginx) i produktion; sätt `PUBLIC_URL=https://…` så får
sessionscookien `Secure`. Om proxyn begränsar storleken på uppladdningar (nginx `client_max_body_size`)
måste den höjas till `MAX_UPLOAD_MB`.

## Datakälla

Data hämtas från IBIS-API:t på `api.innebandy.se`:

- `/v2/api/public/matches/{id}` – en match. Under pågående match skickas en anonym token från
  `/StatsAppApi/api/startkit` med, annars returneras inga händelser.
- `/v2/api/public/competitions/{id}/matches` – alla matcher i en serie.

API:t saknar dokumenterad ändpunkt för ett lags spelprogram. Servern provar därför
`/v2/api/public/seasons/{seasonId}/teams/{teamId}/matches` och `/v2/api/public/teams/{teamId}/matches`,
och kompletterar med matcher från de **serie-ID:n** som anges på adminsidan (filtrerade på laget)
samt eventuella extra match-ID:n. Om spelprogrammet blir tomt: ange lagets serie-ID:n på adminsidan
(syns i adressen på seriens sida på stats.innebandy.se), eller en egen API-sökväg.

## Tester

```bash
npm test
```
