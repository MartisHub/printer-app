# Eethuis Bol'Es Printer App

## Voor de klant

### Installatie (eenmalig)
1. Dubbelklik op `Eethuis Bol'Es Printer Setup.exe`
2. App installeert zichzelf en start automatisch
3. Welkomstscherm verschijnt → plak het **Agent Token** (krijg je van ons)
4. Klik **Verbinden** → klaar!

De app draait op de achtergrond en start automatisch mee met Windows.

### Wat je ziet in de app
- **Server status** — groen = verbonden met het bestelsysteem
- **Printer status** — groen = printer is bereikbaar op het netwerk
- **Locatie** — aan welke vestiging deze printer gekoppeld is
- **Printer lijst** — welke printers geconfigureerd zijn + of ze bereikbaar zijn
- **Test Print** — stuur een testbonnetje naar de printer
- **Vandaag geprint** — hoeveel bonnetjes er vandaag geprint zijn

### Updates
Updates worden **automatisch** geïnstalleerd. Je hoeft niks te doen.
Als er een update klaarstaat zie je een banner in de app.

---

## Voor de developer

### Development
```bash
npm run dev          # Start in dev mode (localhost:3001)
npm run start        # Start in productie mode
```

### Bouwen
```bash
npm run build        # Bouw Windows .exe installer
npm run build:mac    # Bouw Mac .dmg installer
```

Output in `dist/`:
- `Eethuis Bol'Es Printer Setup x.x.x.exe` — Installer
- `latest.yml` — Update metadata

### Update uitrollen naar klant
```bash
# Eenmalig: zet je GitHub token
set GH_TOKEN=ghp_jouw_token_hier

# 1. Bump versie in package.json
npm version patch    # of: npm version minor / major

# 2. Bouw + publiceer
npm run deploy-update
```

De app bij de klant checkt elk uur op updates en installeert automatisch.

### GitHub setup (eenmalig)
1. Maak repo: `github.com/eethuis-boles/printer-releases`
2. Maak [Personal Access Token](https://github.com/settings/tokens) → scope: `repo`
3. Bewaar token veilig

### Configuratie

Bij eerste start maakt de app `config.json` aan in `%APPDATA%\eethuis-boles-printer\`.
In dev mode: `config.dev.json`.

| Setting             | Beschrijving                    | Default (prod)                     | Default (dev)        |
|---------------------|---------------------------------|------------------------------------|----------------------|
| apiBaseUrl          | Server URL                      | https://portaal.eethuisboles.nl    | http://localhost:3001|
| agentToken          | Agent authenticatie token       | (leeg — moet ingevuld)            | dev-test-token       |
| pollIntervalMs      | Hoe vaak checken voor jobs (ms) | 5000                               | 5000                 |
| heartbeatIntervalMs | Heartbeat interval (ms)         | 30000                              | 30000                |

### Architectuur
```
printer-app/
├── main.js          # Electron main process (tray, window, IPC, auto-update)
├── agent.js         # Print agent (polling, ESC/POS, heartbeat, printer check)
├── preload.js       # IPC bridge (main ↔ renderer)
├── renderer/
│   ├── index.html   # UI layout (welcome screen + dashboard)
│   ├── style.css    # Dark theme styling
│   └── app.js       # UI logic (onboarding, status, events)
├── assets/          # App icons
└── scripts/
    └── deploy-update.js  # Build + publish to GitHub Releases
```

### Bekende meldingen
De volgende GPU cache warnings in de terminal zijn **normaal** en hebben geen effect:
```
[ERROR:cache_util_win.cc] Unable to move the cache: Access is denied
[ERROR:disk_cache.cc] Unable to create cache
[ERROR:gpu_disk_cache.cc] Gpu Cache Creation failed: -2
```
Hardware acceleratie is uitgeschakeld om dit te minimaliseren.

## Eerste Installatie bij Klant

1. Stuur de `.exe` installer naar de klant
2. Klant dubbelklikt → installeert automatisch
3. App start op en verschijnt in de system tray
4. Klant opent de app → vult Server URL en Token in
5. Klaar — alles werkt automatisch vanaf nu

Latere updates? `npm version patch && npm run release` — klant krijgt het vanzelf.

---

## Troubleshooting

| Probleem | Oplossing |
|----------|-----------|
| App start niet | Check of er al een instantie draait (system tray) |
| Geen verbinding | Controleer Server URL en Token in instellingen |
| Printer print niet | Check of printer aan staat en IP correct is |
| Update werkt niet | Check GH_TOKEN en of de repo correct is in package.json |

## Logs

Logs staan in:
```
%APPDATA%\eethuis-boles-printer\agent.log
```
