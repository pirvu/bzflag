# Instalare webStats pe un server Linux

Ghidul ăsta pune pe un server Linux un server BZFlag cu plugin-ul `webStats`,
pagina web cu logul și statisticile, și notificările în Chrome când cineva
deschide un joc. Comenzile sunt pentru Debian 12 sau Ubuntu 22.04/24.04; pe
alte distribuții se schimbă doar numele pachetelor.

Totul arată așa:

```
 jucători ──► bzfs (port 5154) + plugin webStats
                         │  evenimente JSON, doar local
                         ▼
               serviciul web (Node, 127.0.0.1:8080) ──► SQLite
                         ▲                         └──► notificări push
                         │
 browser / telefon ──► Caddy (HTTPS, 443)
```

Fișierele gata de copiat sunt în `plugins/webStats/deploy/`.

## Ce îți trebuie

- Un server Linux cu acces root (`sudo`).
- Un nume de domeniu care arată spre server, de exemplu `stats.exemplu.ro`
  cu o înregistrare DNS `A` spre IP-ul serverului. **Fără HTTPS browserele
  nu permit notificări**, iar pentru HTTPS ai nevoie de un nume.
- Porturi deschise: `5154` TCP și UDP pentru joc, `80` și `443` TCP pentru
  pagină.

## 1. Pachetele pentru compilare

```sh
sudo apt update
sudo apt install -y git build-essential autoconf automake libtool pkg-config \
  libc-ares-dev libcurl4-openssl-dev zlib1g-dev
```

## 2. Compilează și instalează bzfs cu plugin-ul

Plugin-ul trebuie compilat din aceleași surse ca serverul `bzfs` care îl
încarcă. Dacă ai deja un `bzfs` instalat din pachetul distribuției, folosește-l
de acum pe cel compilat aici.

```sh
git clone -b claude/mobile-play-server-logs-qa23ih https://github.com/pirvu/bzflag.git
cd bzflag
./autogen.sh
./configure --disable-client
make -j"$(nproc)"
sudo make install
```

Verifică:

```sh
ls /usr/local/bin/bzfs /usr/local/lib/bzflag/webStats.so
```

## 3. Node.js 22

Serviciul web are nevoie de Node.js **22.13 sau mai nou** (folosește SQLite-ul
inclus în Node). Versiunea din Debian/Ubuntu e prea veche, așa că instalează-l
din NodeSource:

```sh
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version      # trebuie să fie v22.13 sau mai mare
which node          # trebuie să fie /usr/bin/node
```

Dacă `which node` arată altă cale, schimb-o în linia `ExecStart` din
`deploy/webstats.service`.

## 4. Utilizatorul și folderele

Serverul și pagina rulează sub utilizatorul `bzflag`, fără drepturi de root.
Folderele de date (`/var/lib/bzflag` și `/var/lib/bzflag-webstats`) le creează
systemd la prima pornire.

```sh
sudo useradd --system --home-dir /var/lib/bzflag --shell /usr/sbin/nologin bzflag
sudo install -d -m 755 /etc/bzflag /opt/bzflag-webstats
```

Din folderul `bzflag` în care ai compilat:

```sh
sudo cp -r plugins/webStats/web/{server.js,lib,public,package.json} /opt/bzflag-webstats/
```

## 5. Cheia secretă

Plugin-ul și serviciul web folosesc aceeași cheie, ca nimeni altcineva să nu
poată trimite evenimente false. Generează una și pune-o în ambele fișiere:

```sh
KEY=$(openssl rand -hex 24)

sed "s/replace-me/$KEY/" plugins/webStats/deploy/webstats.env | sudo tee /etc/bzflag/webstats.env >/dev/null
sed "s/replace-me/$KEY/" plugins/webStats/deploy/webStats.cfg | sudo tee /etc/bzflag/webStats.cfg >/dev/null
sudo chown root:bzflag /etc/bzflag/webstats.env /etc/bzflag/webStats.cfg
sudo chmod 640 /etc/bzflag/webstats.env /etc/bzflag/webStats.cfg
```

Apoi editează `/etc/bzflag/webstats.env` și pune adresa ta de e-mail la
`VAPID_SUBJECT`. Serviciile de push (Google, Mozilla) o folosesc dacă au
ceva de semnalat.

```sh
sudo nano /etc/bzflag/webstats.env
```

## 6. Pornește serviciul web

```sh
sudo cp plugins/webStats/deploy/webstats.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now webstats
```

Verifică:

```sh
systemctl status webstats --no-pager
curl -s http://127.0.0.1:8080/api/live
```

Trebuie să vezi `active (running)` și un răspuns JSON.

## 7. Pornește serverul bzfs

`deploy/bzfs.conf` e o configurare minimală (CTF, port 5154). Schimbă titlul
și ce mai vrei, apoi copiaz-o:

```sh
sudo cp plugins/webStats/deploy/bzfs.conf /etc/bzflag/bzfs.conf
sudo nano /etc/bzflag/bzfs.conf
```

**Ai deja o configurare de bzfs?** Atunci folosește-o pe a ta și adaugă doar
linia:

```
-loadplugin webStats,/etc/bzflag/webStats.cfg
```

În `/etc/bzflag/webStats.cfg`, `server = ...` e numele afișat în pagină.

```sh
sudo cp plugins/webStats/deploy/bzfs.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now bzfs
```

Verifică:

```sh
systemctl status bzfs --no-pager
curl -s http://127.0.0.1:8080/api/live
```

Acum în `servers` trebuie să apară serverul tău cu `"running":1`.

## 8. HTTPS cu Caddy

Caddy obține singur certificatul HTTPS de la Let's Encrypt. Pe Debian 12 și
Ubuntu 24.04 e în depozitele oficiale; pentru alte versiuni vezi
<https://caddyserver.com/docs/install>.

```sh
sudo apt install -y caddy
sudo cp plugins/webStats/deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile        # înlocuiește stats.example.org cu domeniul tău
sudo systemctl reload caddy
```

Deschide `https://domeniul-tău` în browser. Ar trebui să vezi pagina.

## 9. Firewall

Dacă folosești `ufw`:

```sh
sudo ufw allow 5154/tcp
sudo ufw allow 5154/udp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

Portul 8080 **nu** se deschide. Serviciul web ascultă doar local, iar din
afară se ajunge la el numai prin Caddy.

## 10. Activează notificările și fă un test

1. Pe telefon (Android, Chrome) deschide `https://domeniul-tău`, apoi
   **Notificări** → **Activează** → permite notificările.
2. Apasă **Trimite un test**. Trebuie să apară o notificare.
3. Intră pe server dintr-un client BZFlag ca jucător, nu ca observator.
   Ceilalți abonați primesc „BZFlag: a început un joc”.

Pe iPhone (iOS 16.4+), deschide întâi pagina în Safari, apoi **Partajează →
Adaugă pe ecranul principal**, și activează notificările din aplicația
adăugată.

## Rotirea fișierului de evenimente

Plugin-ul adaugă fiecare eveniment și în `/var/lib/bzflag/webstats.jsonl`.
E copia de rezervă, dar crește continuu. Pune-l în logrotate:

```sh
sudo tee /etc/logrotate.d/bzflag-webstats >/dev/null <<'EOF'
/var/lib/bzflag/webstats.jsonl {
  weekly
  rotate 8
  compress
  missingok
  notifempty
  copytruncate
}
EOF
```

## Backup

Tot ce contează e în `/var/lib/bzflag-webstats/`:

- `webstats.db`: istoricul, statisticile și abonații la notificări;
- `vapid.json`: cheia pentru notificări. **Dacă o pierzi, toți trebuie să
  activeze din nou notificările.**

Cel mai simplu backup:

```sh
sudo systemctl stop webstats
sudo tar czf webstats-backup-$(date +%F).tgz -C /var/lib bzflag-webstats
sudo systemctl start webstats
```

Dacă baza de date se pierde, o poți reface din fișierele de evenimente:

```sh
sudo -u bzflag env DATA_DIR=/var/lib/bzflag-webstats \
  node /opt/bzflag-webstats/server.js import /var/lib/bzflag/webstats.jsonl
```

## Actualizare

Din folderul `bzflag`:

```sh
git pull
make -j"$(nproc)" && sudo make install
sudo cp -r plugins/webStats/web/{server.js,lib,public,package.json} /opt/bzflag-webstats/
sudo systemctl restart webstats bzfs
```

## Probleme frecvente

| Ce vezi | Ce faci |
|---|---|
| Pagina nu are niciun server | `journalctl -u bzfs -n 50`: plugin-ul trebuie să fie încărcat (linia `-loadplugin`). Verifică și că aceeași cheie e în `webstats.env` și `webStats.cfg`; dacă diferă, serviciul web refuză evenimentele fără să le salveze. |
| Serviciul web nu pornește: `No such built-in module: node:sqlite` | Node e prea vechi; reinstalează Node 22 (pasul 3). |
| „Notificările au nevoie de HTTPS” | Deschizi pagina prin `http://` sau prin IP. Folosește `https://domeniul-tău`. |
| „Notificările sunt blocate” | Din setările site-ului în Chrome (lacătul de lângă adresă) → Notificări → Permite. |
| Testul de notificare eșuează | `journalctl -u webstats -n 50`. Serverul trebuie să poată ieși pe internet prin HTTPS (către `fcm.googleapis.com`). |
| Logul live nu se actualizează singur | Un proxy care ține răspunsurile în buffer. Caddy nu face asta; la nginx pune `proxy_buffering off`. |
| Nu vine notificare când intră cineva | Doar primul jucător pe un server gol declanșează notificarea, iar observatorii nu contează. Dacă jocul anterior s-a terminat de mai puțin de 10 minute, nu se trimite (vezi `NOTIFY_COOLDOWN_MIN`). |

Comenzi utile:

```sh
journalctl -u webstats -f      # logul serviciului web, live
journalctl -u bzfs -f          # logul serverului de joc, live
sudo systemctl restart webstats bzfs
```
