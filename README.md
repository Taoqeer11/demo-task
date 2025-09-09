# Polling Task Demo (Mobile ↔ POS)

A full-stack demo showcasing a card-transaction flow with API polling, POS inverse polling, Picture-in-Picture (PiP) preview, buyer float calculations, and a simple state machine.

- Frontend: React 19 + Vite 7 (`frontend/`)
- Backend: Node.js + Express + Mongoose + JWT (`server/`)

## Features

- Mobile creates a transaction and polls status until it’s ready/authorized/settled
- POS inverse polling to list WAITING transactions, confirm, and authorize
- Buyer Float % added to grand total (with simulated SoJOR percent)
- Picture-in-Picture preview using a self-contained SVG (no CORS issues)
- Clear UI state and optional server-side transaction clear (CLS)
- Self-documenting API index at `GET /api`

## Folder Structure

```
client/
├─ frontend/
│  ├─ public/
│  │  └─ index.html
│  ├─ src/
│  │  ├─ App.jsx           # Main UI with Mobile & POS flows
│  │  ├─ api.js            # Axios API layer
│  │  ├─ main.jsx          # App bootstrap
│  │  ├─ styles.css        # Styling
│  │  └─ ...
│  ├─ package.json         # React + Vite project
│  ├─ vite.config.js
│  └─ eslint.config.js
└─ server/
   ├─ models/
   │  └─ Transaction.js    # Mongoose schema & indexes
   ├─ server.js            # Express server & routes
   ├─ package.json
   └─ .env                 # Environment variables (not committed)
```

## Prerequisites

- Node.js 18+
- MongoDB (Atlas or local). If using Atlas, allow your current IP in Network Access.

## Environment

Create `server/.env` with the following variables:

```
PORT=5000
MONGO_URI=mongodb+srv://<user>:<pass>@<cluster>/<db>?retryWrites=true&w=majority
JWT_SECRET=replace-with-strong-secret
TOKEN_TTL_SECONDS=300
# Comma-separated list of allowed frontend origins
CORS_ORIGIN=http://localhost:5173
```

Optional `frontend/.env`:

```
VITE_API_BASE=http://localhost:5000/api
```

## Install & Run

- Backend
  - `cd server`
  - `npm install`
  - `npm run start`
  - Expected: `🚀 Backend listening on http://localhost:5000` and `✅ MongoDB connected`

- Frontend
  - `cd frontend`
  - `npm install`
  - `npm run dev`
  - Open the Vite URL (typically `http://localhost:5173`)

## Usage Flow

1) Mobile (left card)
- Fill `Source`, `Destination`, `Amount`, `Buyer Float %`
- Click `Start Transaction (Mobile)`
- Mobile obtains a token, creates a transaction (status `WAITING`), and starts polling status
- Preview image shows; you can use `Open Image in PiP` or `Print Receipt`

2) POS (right card)
- Click `Load Pending (POS poll)` to list `WAITING` transactions
- Click `POS Confirm (Ready for Auth)` to move to `READY_FOR_AUTH`
- Click `Authorize & Settle` to simulate authorization and final settlement

3) CLS (clear)
- `CLS (clear UI)`: resets the UI and stops polling
- `CLS + Clear Server`: also deletes the transaction on the server

Status legend: `WAITING` → `READY_FOR_AUTH` → `AUTHORIZED` → `SETTLED`

## API Reference (server)

- `GET /` — Health: `✅ Polling Task Backend Up`
- `GET /api` — API index (self-documenting)
- `POST /api/token`
  - Body: `{ "userId": "mobile-user" }`
  - Returns: `{ token, ttlSeconds }`
- `POST /api/transactions`
  - Body: `{ token, source, destination, amount, buyerFloatPercent }`
  - Returns: `{ txId, txToken, imageUrl, grandTotal, ttlSeconds, status }`
- `GET /api/transactions/:id/status`
  - Headers: `Authorization: Bearer <txToken or POS token>`
  - Returns: `{ tx }`
- `GET /api/transactions/pending`
  - Headers: `Authorization: Bearer <POS token>`
  - Returns: `{ transactions: [WAITING...] }`
- `GET /api/transactions/ready`
  - Headers: `Authorization: Bearer <POS token>`
  - Returns: `{ transactions: [READY_FOR_AUTH...] }`
- `POST /api/transactions/:id/pos-confirm`
  - Headers: `Authorization: Bearer <POS token>`
  - Moves `WAITING → READY_FOR_AUTH`
- `POST /api/transactions/:id/authorize`
  - Headers: `Authorization: Bearer <POS token>`
  - Moves `READY_FOR_AUTH → AUTHORIZED → SETTLED`
- `POST /api/transactions/:id/clear`
  - Deletes the transaction (demo helper)

## Calculations

- `floatCharge = amount * (buyerFloatPercent / 100)`
- `sojorCharge = amount * (sojorPercent / 100)` (simulated `sojorPercent = 1.5`)
- `grandTotal = amount + floatCharge + sojorCharge`

## Security & Reliability

- CORS restricted via `CORS_ORIGIN`
- JWT-based auth for mobile (create transaction) and POS (pending/confirm/authorize)
- Distinguishes JWT errors from other server errors; returns `503` when DB unavailable
- TTL index to auto-expire transactions (`ttlExpiresAt`)

## Troubleshooting

- `Cannot GET /api` — expected; use `GET /api` for index or root `/` for health
- `401 Invalid token / Token expired` — regenerate token via `POST /api/token`
- `503 Database unavailable` — ensure Mongo is reachable, IP is allowed in Atlas
- PiP not showing — create a fresh transaction; `imageUrl` is embedded at creation time

## Customization

- Change PiP image: modify the embedded SVG in `server/server.js` (transaction creation route)
- Update color palette & styles: edit CSS variables in `frontend/src/styles.css`
- Add Ready list in POS UI: use `GET /api/transactions/ready` and `api.posReady()`
- Switch to robust validation: plug in Zod/Joi in `server/server.js`
- Add Docker Compose: define services for frontend, backend, and Mongo or use Atlas

## License

This project is provided for demonstration purposes.
