# Eethuis Bol'Es Printer App

Desktop applicatie voor automatisch bonnetjes printen. Draait als achtergrondproces in de Windows system tray.

## Features

- **Automatisch printen** — Luistert naar nieuwe bestellingen en print bonnetjes
- **System tray** — Draait onzichtbaar op de achtergrond, dubbelklik om te openen
- **Auto-update** — Werkt zichzelf automatisch bij (net als VS Code/Discord)
- **Status dashboard** — Zie hoeveel bonnetjes geprint zijn, fouten, etc.
- **Test print** — Stuur een testbonnetje vanuit de app

## Structuur

```
printer-app/
  main.js        # Electron main process (tray, window, auto-updater)
  agent.js       # Print agent module (polling, ESC/POS, heartbeat)
  preload.js     # Secure bridge main↔renderer
  renderer/      # UI (HTML/CSS/JS)
  assets/        # Icons
```

## Development

```bash
cd printer-app
npm install
npm run dev          # Start met DevTools open
```

## Configuratie

Bij de eerste start maakt de app een `config.json` aan in:
```
%APPDATA%\eethuis-boles-printer\config.json
```

Instellingen zijn ook te wijzigen via de Settings knop in de app.

| Setting          | Beschrijving                    | Default                    |
|------------------|---------------------------------|----------------------------|
| apiBaseUrl       | Server URL                      | https://eethuisboles.nl    |
| agentToken       | Agent authenticatie token       | (leeg — moet ingevuld)    |
| pollIntervalMs   | Hoe vaak checken voor jobs (ms) | 5000                       |
| heartbeatIntervalMs | Heartbeat interval (ms)      | 30000                      |

---

## Auto-Update Workflow

### Hoe het werkt

1. De app checkt elk uur + bij opstarten of er een nieuwe versie is
2. Als er een update is, wordt deze automatisch gedownload
3. Bij de volgende herstart wordt de update geïnstalleerd
4. De gebruiker hoeft **niks** te doen

### Setup (eenmalig)

#### 1. GitHub Repository aanmaken

Maak een **private** repo aan voor releases, bijv. `boles-printer-releases`.

#### 2. GitHub Token aanmaken

1. Ga naar https://github.com/settings/tokens
2. Maak een **Fine-grained token** aan met:
   - Repository access: alleen `boles-printer-releases`
   - Permissions: `Contents: Read and write`
3. Bewaar het token veilig

#### 3. package.json updaten

In `printer-app/package.json`, update de `publish` config:

```json
"publish": [
  {
    "provider": "github",
    "owner": "JOUW-GITHUB-USERNAME",
    "repo": "boles-printer-releases",
    "private": true
  }
]
```

#### 4. Environment variable instellen

```bash
set GH_TOKEN=ghp_jouw_github_token_hier
```

Of maak een `.env` bestand in printer-app/:
```
GH_TOKEN=ghp_jouw_github_token_hier
```

### Update Publiceren (hoe je een update pusht)

```bash
cd printer-app

# 1. Verhoog de versie in package.json
#    bijv. 1.0.0 -> 1.0.1 (bugfix) of 1.1.0 (feature)
npm version patch    # of: npm version minor / npm version major

# 2. Build + upload naar GitHub Releases
npm run release
```

Dat is alles. De app bij de klant pikt de update automatisch op.

### Alternatieven voor GitHub Releases

Als je geen GitHub wilt gebruiken, kun je ook:

**Eigen server (S3/VPS):**
```json
"publish": [
  {
    "provider": "generic",
    "url": "https://updates.eethuisboles.nl/printer"
  }
]
```
Dan upload je de bestanden naar die URL. Electron-updater checkt `latest.yml` op die URL.

---

## Bouwen voor Windows

### Installer maken (lokaal)

```bash
npm run build
```

Output staat in `printer-app/dist/`:
- `Eethuis Bol'Es Printer Setup 1.0.0.exe` — Installer voor klant
- `latest.yml` — Update metadata

### Release maken (publiceert naar GitHub)

```bash
npm run release
```

---

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
