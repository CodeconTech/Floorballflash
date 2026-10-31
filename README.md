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

### Driftsättning med Docker (Ubuntu)

`docker-compose.yml` kör appen bakom [Caddy](https://caddyserver.com), som skaffar och förnyar
HTTPS-certifikat automatiskt. Det krävs ett domännamn vars DNS (A-post) pekar på serverns IP, och
portarna 80 och 443 måste vara öppna.

```bash
# 1. Installera Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER        # logga ut och in igen

# 2. Hämta koden och skapa inställningarna
git clone https://github.com/CodeconTech/Floorballflash.git /opt/floorballflash
cd /opt/floorballflash
cp .env.example .env && chmod 600 .env
nano .env                            # sätt DOMAIN, PUBLIC_URL och SMTP-uppgifter

# 3. Starta
docker compose up -d --build
docker compose logs -f app
```

Om brandväggen ufw används: `sudo ufw allow 80,443/tcp`.

Databasen och filmerna sparas i `./data` (bredvid `docker-compose.yml`). Säkerhetskopiera den katalogen,
t.ex. nattligt via `crontab -e`:

```
0 3 * * * tar czf /var/backups/floorballflash-$(date +\%F).tar.gz -C /opt/floorballflash data
```

Uppdatera till senaste versionen:

```bash
cd /opt/floorballflash && git pull && docker compose up -d --build
```

Utan Caddy går det också att köra bara appen (`docker build -t floorballflash . && docker run -d
-p 3000:3000 -v floorballflash-data:/data --env-file .env floorballflash`), men lägg då en
HTTPS-proxy framför och sätt `TRUST_PROXY` till antalet proxy-hopp.

### Felsökning

**Spelprogrammet är tomt.** Kör diagnosen på servern; den visar vilka API-adresser som svarar för laget
och vilka serie-ID:n som hittas:

```bash
docker compose exec app npm run ibis-check
```

Hittas inget serie-ID automatiskt anger du serierna i `.env` (`COMPETITION_IDS=45219,45220`, följt av
`docker compose up -d`) eller på adminsidan under *Lag och datakälla*.

**HTTPS-certifikatet fungerar inte.** Titta i Caddys logg: `docker compose logs caddy --tail 100`.
Vanliga orsaker:

- DNS pekar inte på servern ännu – jämför `dig +short DOMÄN` med `curl -4 ifconfig.me`. En gammal
  AAAA-post (IPv6) som pekar någon annanstans räcker för att det ska misslyckas.
- Port 80 eller 443 når inte servern – brandväggen (`sudo ufw status`), molnleverantörens
  säkerhetsgrupp eller portvidarebefordran i routern om servern står hemma.
- Domänen ligger bakom Cloudflares proxy (orange moln) – stäng av proxyn, eller sätt SSL-läget till *Full*.
- Något annat lyssnar redan på port 80/443 (t.ex. nginx eller apache) – `sudo ss -ltnp | grep -E ':(80|443) '`.

När felet är åtgärdat: `docker compose restart caddy`.

## Datakälla

Data hämtas från IBIS-API:t på `api.innebandy.se`:

- `/v2/api/public/matches/{id}` – en match. Under pågående match skickas en anonym token från
  `/StatsAppApi/api/startkit` med, annars returneras inga händelser.
- `/v2/api/public/competitions/{id}/matches` – alla matcher i en serie.

API:t saknar dokumenterad ändpunkt för ett lags spelprogram. Servern provar därför
`/v2/api/public/seasons/{seasonId}/teams/{teamId}/matches` och `/v2/api/public/teams/{teamId}/matches`.
Svarar ingen av dem läses lagets serier ut från `/v2/api/public/seasons/{seasonId}/teams/{teamId}`
(eller `/v2/api/public/teams/{teamId}`), och seriernas matcher filtreras på laget. Matcher från de
**serie-ID:n** som anges på adminsidan och eventuella extra match-ID:n läggs också till. Om spelprogrammet blir tomt: ange lagets serie-ID:n på adminsidan
(syns i adressen på seriens sida på stats.innebandy.se), eller en egen API-sökväg.

## Tester

```bash
npm test
```
