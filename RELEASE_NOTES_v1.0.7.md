# Release Notes v1.0.7

**Release Datum:** 3 mei 2026

## 🐛 Bugfixes

### Item Prijzen Fix
**Probleem:** Wanneer meerdere items van hetzelfde product werden besteld (bijv. 3x Kapsalon), toonde het bonnetje alleen de prijs per stuk in plaats van de totaalprijs van dat item.

**Voorbeeld van het probleem:**
```
3x Kapsalon              EUR 12.00  ❌ (fout)
```

**Oplossing:** Item prijzen worden nu correct berekend als `quantity × prijs per stuk`:
```
3x Kapsalon              EUR 36.00  ✅ (correct)
```

**Betroffen bestanden:**
- `agent.js` (regel ~621) - `buildEscPosTicket()` functie
- `agent.js` (regel ~768) - `printTicketToConsole()` functie

---

### Gewenste Tijd & ASAP Delivery Fix
**Probleem:** De gewenste afhaaltijd of bezorgtijd werd niet altijd correct getoond op het bonnetje, zelfs wanneer deze was ingesteld in de bestelling.

**Oorzaak:** 
- Incorrecte handling van `NULL` waarden uit de database
- `asap_delivery` boolean werd niet correct herkend als `TRUE`
- Geen expliciete check op lege strings

**Oplossing:** 
- Robuustere conditie voor het detecteren van ASAP bestellingen (ondersteunt nu `TRUE`, `true`, `"TRUE"`, `"true"`, `1`)
- Expliciete NULL-checks toegevoegd voor `preferred_time` en `preferred_date`
- Wanneer `asap_delivery = TRUE`: toont nu **"ZO SNEL MOGELIJK"** (vet, dubbele hoogte)
- Wanneer `preferred_time` bestaat: toont **"Afhaaltijd: 17:10"** of **"vrijdag 2 mei om 17:10"**

**Debug logging toegevoegd:**
```javascript
this.log('DEBUG', `Time info - preferred_time: ${order.preferred_time}, preferred_date: ${order.preferred_date}, asap: ${order.asap_delivery}`);
```

**Betroffen bestanden:**
- `agent.js` (regel ~549-575) - `buildEscPosTicket()` functie
- `agent.js` (regel ~738-757) - `printTicketToConsole()` functie

---

## 🔧 Technische Verbeteringen

### Verbeterde Database Compatibiliteit
- Betere handling van boolean velden uit de database
- NULL-safe datum parsing
- Robuustere type conversies voor verschillende database backends

### Debug & Logging
- Extra debug logging toegevoegd voor tijdgerelateerde velden
- Helpt bij troubleshooting van toekomstige issues

---

## 📋 Volledig Bonnetje Voorbeeld

```
================================================
           EETHUIS BOLES
================================================

BESTELLING #1234
03-05-2026 18:45

------------------------------------------------

>> AFHALEN <<

ZO SNEL MOGELIJK

Klant: Jan de Vries
Tel: 06-12345678

------------------------------------------------

ITEMS:

3x Kapsalon                    EUR 36.00
2x Friet groot                 EUR  9.00
  > Extra mayo
1x Cola 330ml                  EUR  2.50

------------------------------------------------

Subtotaal:                     EUR 47.50
TOTAAL:                        EUR 47.50

------------------------------------------------

** BETAALD **

================================================
     Bedankt voor uw bestelling!
================================================
```

---

## 🚀 Installatie

1. Download de nieuwe versie
2. Installeer via de update functie in de app
3. Of herstart de app - auto-update zal de nieuwe versie downloaden

---

## ✅ Getest op

- Windows 10/11
- ESC/POS thermal printers (80mm)
- Database met NULL waarden en boolean TRUE/FALSE

---

## 📞 Support

Bij problemen of vragen, neem contact op met Martis Coding.
