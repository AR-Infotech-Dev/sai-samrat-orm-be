# Node Setup

This folder contains a standard Node.js + Express scaffold for migrating the legacy PHP CodeIgniter API.

## What is already done

- Express app bootstrap with sessions, JSON parsing, logging, and error handling
- MySQL connection layer using the same database defaults found in `application/config/database.php`
- Legacy route loader that reads:
  - `application/config/routes.php`
  - `application/config/routes_custom.php`
  - `application/config/routes_integration.php`
- Auto-registration of the legacy routes in Express so the public route surface stays the same
- A migrated `Login` controller for:
  - `POST /login`
  - `GET|POST /salt`
  - `POST /logout`

## Current migration behavior

- Routes with a migrated Node controller execute real logic
- Routes without a migrated Node controller return `501 Not Implemented` with the original PHP mapping details

This makes the migration visible and incremental instead of losing route parity.

## Run

1. Create `.env` from `.env.example`
2. Install packages with `npm install`
3. Start the server with `npm run dev`

## Suggested next migration order

1. `SearchAdmin`
2. `CustomerMaster`
3. `MenuMaster`
4. `Dashboard`
5. `systems/*`
