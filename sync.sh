#!/bin/bash

# Konfiguracija
LOCAL_DIR="/home/djuric/works/irigacija"
REMOTE_HOST="irigacija" # Koristi SSH config alias
REMOTE_DIR="/var/www/html"

echo "=========================================================="
echo "Raspberry Pi Auto-Sync v1.0"
echo "=========================================================="
echo "Lokalni folder: $LOCAL_DIR"
echo "Udaljeni folder: $REMOTE_HOST:$REMOTE_DIR"
echo "----------------------------------------------------------"

# Provera da li SSH master veza postoji
if ! ssh -O check "$REMOTE_HOST" >/dev/null 2>&1; then
    echo "[UPOZORENJE] SSH master konekcija nije aktivna!"
    echo "Molimo te da u drugom terminalu pokreneš: ssh $REMOTE_HOST"
    echo "i uneseš lozinku kako bi se uspostavila brza i automatska sinhronizacija."
    echo "----------------------------------------------------------"
fi

echo "Nadzor pokrenut. Pratim izmene u realnom vremenu (svake sekunde)..."
echo "Za zaustavljanje pritisni Ctrl+C."
echo "----------------------------------------------------------"

last_hash=""
while true; do
    # Generišemo hash na osnovu vremena poslednje izmene (mtime) i naziva svih fajlova
    # Isključujemo skrivene fajlove/foldere i samu sync.sh skriptu
    current_hash=$(find "$LOCAL_DIR" -type f -not -path '*/.*' -not -name 'sync.sh' -exec stat -c '%Y %n' {} + 2>/dev/null | sha256sum)
    
    if [ "$current_hash" != "$last_hash" ]; then
        if [ "$last_hash" != "" ]; then
            echo "[$(date '+%H:%M:%S')] Detektovana izmena. Sinhronizujem..."
            rsync -avz --exclude '.*' --exclude 'sync.sh' "$LOCAL_DIR/" "$REMOTE_HOST:$REMOTE_DIR/"
            if [ $? -eq 0 ]; then
                echo "[$(date '+%H:%M:%S')] Sinhronizacija uspešna."
            else
                echo "[$(date '+%H:%M:%S')] Greška prilikom sinhronizacije!"
            fi
            echo "----------------------------------------------------------"
        fi
        last_hash="$current_hash"
    fi
    sleep 1
done
