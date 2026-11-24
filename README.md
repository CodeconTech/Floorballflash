# Floorballflash

Webbsida med lagets spelprogram och resultat från innebandyförbundets API (samma data som
[stats.innebandy.se/sasong/44/lag/120879/spelprogram](https://stats.innebandy.se/sasong/44/lag/120879/spelprogram)),
liveuppdateringar under matcherna och filmklipp som godkända användare laddar upp och alla kan titta på.

## Funktioner

- **Spelprogram och resultat** – kommande matcher, pågående matcher och resultat.
- **Live** – servern hämtar pågående matcher var 20:e sekund och skickar ändringar direkt till
  webbläsaren (Server-Sent Events). Matchsidan visar ställning, periodresultat, mål och utvisningar.
- **Automatiska resultat och liveställning** från lagets kanal på play.innebandy.se (`SOLIDSPORT_CHANNEL`).
- **Liverapportering** – under matchen kan inloggade användare rapportera start, mål (med målskytt),
  periodpauser och slut direkt från matchsidan i mobilen. Ställning och händelser uppdateras live för
  alla som följer matchen. Rapportering är öppen från två timmar före start till sex timmar efter.
- **Livesändning via VDO.Ninja** – på varje matchsida kan en inloggad användare koppla en länk från
  [vdo.ninja](https://vdo.ninja) (eller låta sidan skapa en ny sändning). Sändningen bäddas in på
  matchsidan för alla besökare och startsidan markerar matchen med *📹 Video*. Både visningslänk
  (`?view=…`) och sändningslänk (`?push=…`) går att klistra in – besökarna får alltid bara
  visningslänken. Den som kopplat sändningen (och admin) ser länken för kameran och kan byta eller
  ta bort sändningen.
- **Filmklipp** – inloggade användare laddar upp klipp (mp4, mov, m4v, webm, ogv) till en match,
  fram till 12 timmar efter matchen (`UPLOAD_WINDOW_HOURS`; admin kan alltid ladda upp).
  Alla besökare kan titta, utan inloggning.
- **Tidigare matcher** – spelade matcher listas med resultat och klipp. Matcher sparas i databasen,
  så matcher med klipp finns kvar även när de inte längre ingår i spelprogrammet (t.ex. förra säsongen).
- **Inloggning med e-post och pinkod** – pinkoden är exakt 8 tecken (bokstäver/siffror).
  Nya konton måste godkännas: ett mejl med knapparna *Godkänn användare* och *Neka användare* skickas
  till administratören (`ADMIN_EMAIL`, standard andreas.wallin@gmail.com). Länken gäller i 90 dagar
  (`APPROVAL_LINK_DAYS`); därefter godkänns användaren på adminsidan. Användaren får besked via mejl.
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
git clone https://github.com/CodeconTech/Floorballflash.git /raid_storage/floorballflash
cd /raid_storage/floorballflash
cp .env.example .env && chmod 600 .env
nano .env                            # sätt DOMAIN, PUBLIC_URL och SMTP-uppgifter

# 3. Starta
docker compose up -d --build
docker compose logs -f app
```

Om brandväggen ufw används: `sudo ufw allow 80,443/tcp`.

### Egen Caddy-konfiguration och fler tjänster

Ändra inte `Caddyfile` eller `docker-compose.yml` på servern – då krockar `git pull` med ändringarna.
Lägg i stället egna inställningar i filer som git ignorerar:

- **Fler sajter i Caddy** (t.ex. ownCloud på samma server): kopiera `Caddyfile` till `Caddyfile.local`,
  lägg till sajterna där och sätt `CADDYFILE=./Caddyfile.local` i `.env`. Tjänster som körs direkt på
  servern nås som `host.docker.internal:PORT`:

  ```
  floorballflash.codecon.se {
  	encode gzip
  	reverse_proxy app:3000
  }

  owncloud.codecon.se {
  	encode gzip
  	reverse_proxy host.docker.internal:4433
  }
  ```

- **Andra Docker-ändringar** (t.ex. öppna en port): skriv dem i `docker-compose.override.yml`, som
  `docker compose` läser in automatiskt.

Ta inte bort `DATA_DIR: /data` ur `docker-compose.yml` och sätt inte `DATA_DIR` i `.env` – då hamnar
databasen och klippen inuti containern och försvinner när den byggs om (appen varnar i loggen).

### Uppdatera utan att förlora data

Databasen och filmklippen ligger i datakatalogen (`DATA_PATH`, standard `./data`). Uppdateringar
rör bara koden och containern, aldrig datakatalogen. Uppdatera med skriptet:

```bash
cd /raid_storage/floorballflash && ./scripts/update.sh
```

Det tar en säkerhetskopia av databasen (i `DATA_PATH/backups`), avbryter om koden har lokala
ändringar, hämtar ny kod med `git pull --ff-only`, bygger om och kontrollerar sedan att appen svarar
och att inga klippfiler har försvunnit. Nya versioner ändrar databasen bara genom att lägga till
tabeller och kolumner, aldrig genom att ta bort.

**Lägg datakatalogen utanför kodmappen** så kan ingenting som görs med koden (`git clean`, en ny
`git clone`, att kodmappen tas bort) nå klippen. En gång:

```bash
cd /raid_storage/floorballflash
docker compose down
sudo mv data /raid_storage/floorballflash-data
echo "DATA_PATH=/raid_storage/floorballflash-data" >> .env
docker compose up -d
```

**Kommandon som raderar data** – kör dem inte i kodmappen så länge datan ligger där:

| Kommando | Vad som försvinner |
|---|---|
| `git clean -x`, `git clean -fdx` | `data/` (den är ignorerad av git och räknas som skräp) |
| `rm -rf` på kodmappen eller ny `git clone` över den | allt i `data/` |
| `docker compose down -v` | Caddys certifikat (inte klippen, men nya certifikat måste hämtas) |

Vanliga `git pull`, `docker compose up -d --build`, `docker compose down`, `restart` och
`docker system prune` rör inte datakatalogen.

### Säkerhetskopiering

`docker compose exec app npm run backup` tar en säker kopia av databasen medan appen körs (de 20
senaste sparas i `DATA_PATH/backups`). Filmklippen ändras aldrig efter uppladdning och kopieras enklast
med `rsync`. Kopiera till en annan disk eller maskin, t.ex. nattligt via `crontab -e`:

```
0 3 * * * cd /raid_storage/floorballflash && docker compose exec -T app npm run -s backup && rsync -a /raid_storage/floorballflash-data/ /mnt/backup/floorballflash/
```

`rsync` utan `--delete` behåller även klipp som tagits bort på sidan. RAID skyddar mot en trasig disk,
men inte mot att något raderas – därför en kopia på ett annat ställe.

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

**play.innebandy.se (automatiskt).** Med `SOLIDSPORT_CHANNEL` i `.env` (lagets kanal, t.ex.
`holmsund-city-ibc-p14` från play.innebandy.se/holmsund-city-ibc-p14) hämtas spelprogram, resultat och
liveställning automatiskt från förbundets sändningssajt (Solidsport). Kanalen listar alla lagets matcher
med resultat, även de som inte sänds. Den läses var tionde minut och var trettionde sekund när en match
pågår eller snart börjar; ändringar skickas direkt till besökarna.

**Import från stats.innebandy.se.** Lagets spelprogram kan också klistras in på adminsidan
(*Importera spelprogram*). Det är förbundets officiella data: tider och lagnamn därifrån behålls, och
ett slutresultat därifrån ändras inte av play.innebandy.se. Samma match från båda källorna slås ihop.

**Liverapportering och manuella ändringar.** Saknar play.innebandy.se liveställning för en match kan
den rapporteras från matchsidan; resultat kan rättas på adminsidan under *Matcher*.

**IBIS-API:t.** Sedan november 2026 kräver förbundets API (`api.innebandy.se`) signerade anrop från
stats.innebandy.se och kan inte användas av andra sidor. Koden finns kvar och används om det går att
nå (t.ex. med ett avtal om [iBIS API-tjänst](https://www.innebandy.se/ibis-play/ibis-api-tjanst)).

## Tester

```bash
npm test
```
