# FCBot

Discord bot + web scraper with MySQL backend.

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

Commands:
- `!ping`
- `!daily` to claim daily currency reward
