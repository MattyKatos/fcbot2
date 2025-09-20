# FCBot2

FC Bot 2 is a rewrite of my old FC bot using an MySQL database.

## Features
- FC Member & Rank Sync via Lodestone Scraper
- FC Character Management via self service lodestone scraper
- FC Rank to Discord Role Mapping and auto application
- Discord Channel Management
- Discord Currency System

## In progress
- Gambling System

## Prerequisites
- Node.js 18+
- Access to MySQL at 100.65.234.32:3316

## Setup
1. Copy `.env` and ensure the following are set:
   - `DB_HOST=100.65.234.32`
   - `DB_PORT=3316`
   - `DB_USER=root`
   - `DB_PASSWORD=...`
   - `DB_NAME=fcbot`
   - `DISCORD_BOT_TOKEN=...`
2. Edit `config.json` to set your FC and currency settings.

## Install
```sh
npm install
```

## Initialize Database
```sh
npm run init-db
```

## Run the bot
```sh
npm run dev
```

## Run the Web Server
```sh
npm run start-web
```

Commands:
- `/fc` - Self actions
- - See self details
- - Register/Unregister Discord
- - Claim Daily
- - Register/Delete Characters & Set Primary
- `/fcuser` - Other user actions (WIP)
- - Check Balance
- - See Registered Characters
- - Challenge to Deathroll
- - Give Currency
- `/fcadmin` - Admin actions
- - Sync FC members from Lodestone
- - Register Character for another user
- - Sync Roles from Discord
- - Apply Rank/Role relations to FC members

## Change log
- 2025-09-19: Initial release
- 2025-09-20: Sync is_admin based on manage server permissions.
