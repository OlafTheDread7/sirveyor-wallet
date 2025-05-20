// db.js
const path = require('path');
const Database = require('better-sqlite3');

// Connect or create the DB
const db = new Database(path.join(__dirname, 'wallets.db'));

// Create table if it doesn't exist
db.prepare(`
  CREATE TABLE IF NOT EXISTS wallets (
    id TEXT PRIMARY KEY,
    encrypted TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`).run();

module.exports = db;
