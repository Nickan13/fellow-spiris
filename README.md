# Fellow Spiris Integration

## Översikt

`fellow-spiris` är en integrationsservice mellan:

* **HighLevel (Fellow)** – CRM, fakturor, produkter
* **Spiris (Visma eAccounting)** – bokföring, fakturor, betalningar
* **Shopify (valfritt flöde)** – orderkälla

Systemet hanterar:

* Synk av produkter (Spiris → Fellow)
* Synk av kunder (Spiris → Fellow)
* Fakturor (Fellow → Spiris)
* Betalningar (Fellow → Spiris)
* (Optional) Orderflöde (Shopify → Spiris via Fellow)

---

## Arkitektur

Systemet består av två huvuddelar:

### 1. Integration API (denna repo)

Körs på:

```
/home/fellow/fellow-spiris
```

Teknik:

* Node.js + Express
* SQLite
* PM2 (process manager)

Ansvar:

* API-endpoints (`/api2/...`)
* Job queue (invoice_jobs, shopify_order_jobs)
* Orkestrering av fakturor och betalningar
* UI (embedded i HighLevel)

---

### 2. Spiris OAuth / Token Service

Körs separat på:

```
https://integrations.fellow.se
```

Ansvar:

* OAuth login mot Spiris
* Token refresh
* Token storage per `locationId`

---

## Viktiga flöden

### 1. Fakturaflöde (Fellow → Spiris)

Trigger:

* Webhook: `InvoiceSent` från HighLevel

Flöde:

1. Webhook tas emot
2. Invoice job skapas (`invoice_jobs`)
3. Worker plockar jobbet
4. Orchestrator kör:

   * Matchar/skapar kund i Spiris
   * Matchar artiklar
   * Skapar faktura i Spiris
   * Skapar betalning

Betalning:

* Bokas mot konto **1941 (kortbetalning)**

---

### 2. Shopify-flöde (valfritt)

Trigger:

* Shopify webhook → `/api2/webhooks/shopify/orders/create`

Flöde:

1. Job skapas (`shopify_order_jobs`)
2. Worker hämtar order från Shopify API
3. Kund matchas
4. Faktura skapas i Spiris
5. Betalning skapas (1941)

⚠️ Viktigt:

* Detta ska inte köras parallellt med Sharespine

---

### 3. Produktimport (Spiris → Fellow)

Trigger:

* UI → "Importera produkter"

Flöde:

1. Job skapas (`product_import_jobs`)
2. Worker hämtar artiklar från Spiris
3. Skapar produkter i HighLevel
4. Skapar priser
5. Sparar mapping

---

## Databas

SQLite:

```
/home/fellow/fellow-spiris/database/fellow_spiris.db
```

### Viktiga tabeller

#### Integration

* `platform_app_tokens` – HL OAuth tokens
* `integration_settings` – invoice mode (draft/booked)

#### Spiris

* `spiris_tokens`
* `spiris_articles`
* `spiris_customer_mappings`
* `spiris_invoice_mappings`

#### Jobs

* `invoice_jobs`
* `shopify_order_jobs`
* `product_import_jobs`

#### Shopify

* `shopify_order_mappings`
* `shopify_customer_mappings`

---

## Invoice Mode

Styrs per location:

* `draft` → skapar utkast i Spiris
* `booked` → bokför direkt

API:

```
GET  /api2/settings/:locationId
POST /api2/settings/:locationId/invoice-mode
```

---

## UI (HighLevel)

Custom page:

```
/api2/app/spiris?locationId=XXX
```

Visar:

* Status
* Mapping counts
* Errors
* Importfunktioner

---

## Status endpoints

### Integration status

```
GET /api2/integration/status/:locationId
```

### Requires action

```
GET /api2/integration/requires-action/:locationId
```

### Shopify debug

```
GET /api2/shopify/status/:locationId
```

Visar:

* Jobs
* Mapping
* Retry-status

---

## Retry-logik

### invoice_jobs

* max_attempts: 5
* retry delay:

  * 5 min
  * 15 min
  * 60 min
  * 180 min
  * 720 min

Status:

* pending
* processing
* retry
* requires-action
* failed
* completed

---

## Felsökning

### 1. Kolla loggar

```bash
pm2 logs fellow-spiris --lines 100
```

Fel logg:

```
/home/fellow/.pm2/logs/fellow-spiris-error.log
```

---

### 2. Kontrollera job-status

```sql
SELECT * FROM invoice_jobs ORDER BY id DESC LIMIT 20;
SELECT * FROM shopify_order_jobs ORDER BY id DESC LIMIT 20;
```

---

### 3. Kontrollera mapping

```sql
SELECT * FROM spiris_invoice_mappings;
SELECT * FROM shopify_order_mappings;
```

---

### 4. Vanliga fel

#### ❌ "Invalid token"

* Problem: HL token expired
* Lösning: reinstall app

#### ❌ "Customer not found"

* Problem: mapping saknas
* Lösning: skapa kund i Spiris

#### ❌ "Article not found"

* Problem: produkt ej synkad
* Lösning: kör produktimport

#### ❌ Payment mismatch

* Problem: fel konto / valuta
* lösning: kontrollera payload

---

## Deployment

### Codespaces → Produktion

```bash
git add .
git commit -m "update"
git push
```

På servern:

```bash
cd /home/fellow/fellow-spiris
git pull
pm2 restart fellow-spiris
```

---

## Viktiga miljövariabler

* `PLATFORM_APP_CLIENT_ID`
* `PLATFORM_APP_CLIENT_SECRET`
* `PLATFORM_APP_REDIRECT_URI`
* `GHL_API_BASE`
* `SHOPIFY_TOKEN`
* `SHOPIFY_SHOP_DOMAIN`

---

## Viktiga principer

* **Idempotency**: samma order ska aldrig skapa dubbel faktura
* **Retry first**: systemet försöker igen automatiskt
* **Requires action**: endast när människa behövs
* **Separation**: varje locationId isoleras

---

## Framtida förbättringar

* UI för retry av specifik order
* UI för att åtgärda mapping direkt
* Email alerts vid failed jobs
* Payout reconciliation (1941 → 1940)

---

## Sammanfattning

Systemet är byggt för att:

* automatisera hela flödet från order → bokföring
* vara robust (retry + mapping)
* vara transparent (UI + status endpoints)
* minimera manuellt arbete

---


