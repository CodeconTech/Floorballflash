#!/usr/bin/env bash
# Uppdaterar Floorballflash till senaste versionen utan att röra databasen eller filmklippen.
#
#   cd /raid_storage/floorballflash && ./scripts/update.sh
#
# Skriptet tar en säkerhetskopia av databasen, hämtar ny kod, bygger om och kontrollerar
# efteråt att alla klipp och databasen finns kvar. Det kör aldrig något som raderar data.
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "AVBRYTER: $*" >&2; exit 1; }

[ -f .env ] || fail "hittar inte .env i $(pwd)"
DATA_PATH=$(grep -E '^DATA_PATH=' .env | tail -n 1 | cut -d= -f2- || true)
DATA_PATH=${DATA_PATH:-./data}
DB="$DATA_PATH/floorballflash.db"
UPLOADS="$DATA_PATH/uploads"

[ -f "$DB" ] || fail "hittar inte databasen $DB – kontrollera DATA_PATH i .env"
[ -d "$UPLOADS" ] || fail "hittar inte klippmappen $UPLOADS"

# Lokala ändringar i koden skulle kunna skrivas över eller stoppa git pull.
if ! git diff --quiet || ! git diff --cached --quiet; then
  git status --short
  fail "det finns lokala ändringar i koden (se ovan). Spara eller ta bort dem först."
fi

clips_before=$(find "$UPLOADS" -type f | wc -l)
echo "Data: $DATA_PATH  ($clips_before klippfiler)"

echo "== 1/4 Säkerhetskopierar databasen"
if docker compose exec -T app npm run -s backup 2>/dev/null; then
  :
else
  # Appen körs inte: då är databasfilen i vila och kan kopieras rakt av.
  mkdir -p "$DATA_PATH/backups"
  stamp=$(date +%Y%m%d-%H%M%S)
  cp -p "$DB" "$DATA_PATH/backups/floorballflash-$stamp.db"
  echo "Säkerhetskopia: $DATA_PATH/backups/floorballflash-$stamp.db"
fi

echo "== 2/4 Hämtar senaste versionen ($(git branch --show-current))"
git pull --ff-only

echo "== 3/4 Bygger och startar om"
docker compose up -d --build

echo "== 4/4 Kontrollerar"
ok=""
for _ in $(seq 1 30); do
  if docker compose exec -T app node -e "fetch('http://localhost:3000/api/me').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))" 2>/dev/null; then
    ok=1
    break
  fi
  sleep 2
done
[ -n "$ok" ] || fail "appen svarar inte. Se: docker compose logs app --tail 50"

clips_after=$(find "$UPLOADS" -type f | wc -l)
[ "$clips_after" -ge "$clips_before" ] || fail "antalet klippfiler minskade ($clips_before -> $clips_after)!"
[ -f "$DB" ] || fail "databasen saknas efter uppdateringen!"

echo "Klart: appen svarar och alla $clips_after klippfiler finns kvar."
