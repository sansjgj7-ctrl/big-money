const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();

/* =========================================================
   CONFIG
========================================================= */

const PORT = process.env.PORT || 10000;

const DEPOSIT_ADDRESS =
  process.env.DEPOSIT_ADDRESS ||
  "TAmkXMpkcqSZmG9oRvtXfBvpLWr53wXEdx";

const USDT_CONTRACT =
  process.env.USDT_CONTRACT ||
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const TRONGRID_URL =
  process.env.TRONGRID_URL ||
  "https://api.trongrid.io";

const TRONGRID_API_KEY =
  process.env.TRONGRID_API_KEY || "";

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || "";

const TELEGRAM_BOT_USERNAME =
  process.env.TELEGRAM_BOT_USERNAME ||
  "bigmoney2026bot";

const ALLOWED_ORIGIN =
  process.env.ALLOWED_ORIGIN ||
  "https://sansjgj7-ctrl.github.io";

const TELEGRAM_AUTH_MAX_AGE =
  Number(process.env.TELEGRAM_AUTH_MAX_AGE || 3600);

const ADMIN_TELEGRAM_IDS =
  String(process.env.ADMIN_TELEGRAM_IDS || "")
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);

const WITHDRAWAL_SOURCE_ADDRESS =
  process.env.WITHDRAWAL_SOURCE_ADDRESS || "";

const USDT_DECIMALS = 6;
const MIN_WITHDRAWAL = 1;
const REFERRAL_POINTS = 3;

/*
  How often automatic blockchain scanning runs.
*/
const AUTO_SCAN_MS = 15000;


/* =========================================================
   EXPRESS
========================================================= */

app.use(cors({
  origin: ALLOWED_ORIGIN,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "X-Telegram-Init-Data"
  ]
}));

app.use(express.json({
  limit: "100kb"
}));


/* =========================================================
   RATE LIMIT
========================================================= */

const rateMap = new Map();

function rateLimit(key, maxRequests, windowMs) {
  const now = Date.now();

  const item = rateMap.get(key);

  if (!item || now - item.start > windowMs) {
    rateMap.set(key, {
      start: now,
      count: 1
    });
    return true;
  }

  item.count++;

  if (item.count > maxRequests) {
    return false;
  }

  return true;
}


/* =========================================================
   DATABASE
========================================================= */

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(
  DATA_DIR,
  "big-money-data.json"
);

function defaultStore() {
  return {
    users: {},
    deposits: {},
    pendingDeposits: {},
    withdrawals: {},
    referrals: {}
  };
}

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, {
      recursive: true
    });
  }

  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(defaultStore(), null, 2),
      "utf8"
    );
  }
}

function readStore() {
  ensureStore();

  try {
    const raw = fs.readFileSync(
      DATA_FILE,
      "utf8"
    );

    const data = JSON.parse(raw);

    return {
      users: data.users || {},
      deposits: data.deposits || {},
      pendingDeposits: data.pendingDeposits || {},
      withdrawals: data.withdrawals || {},
      referrals: data.referrals || {}
    };

  } catch (err) {

    console.error(
      "Database read error:",
      err.message
    );

    return defaultStore();
  }
}

function writeStore(data) {
  ensureStore();

  const tempFile =
    DATA_FILE + ".tmp";

  fs.writeFileSync(
    tempFile,
    JSON.stringify(data, null, 2),
    "utf8"
  );

  fs.renameSync(
    tempFile,
    DATA_FILE
  );
}


/* =========================================================
   STORE LOCK
========================================================= */

let storeLock = Promise.resolve();

function withStoreLock(fn) {

  const next =
    storeLock.then(fn, fn);

  storeLock =
    next.catch(() => {});

  return next;
}


/* =========================================================
   HELPERS
========================================================= */

function nowISO() {
  return new Date().toISOString();
}

function generateId(prefix = "id") {
  return (
    prefix +
    "_" +
    Date.now().toString(36) +
    "_" +
    crypto.randomBytes(6).toString("hex")
  );
}

function isValidAmount(value) {

  const n = Number(value);

  return (
    Number.isFinite(n) &&
    n > 0 &&
    n <= 
