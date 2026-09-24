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

const ALLOWED_ORIGIN =
  process.env.ALLOWED_ORIGIN ||
  "https://sansjgj7-ctrl.github.io";

const TELEGRAM_AUTH_MAX_AGE =
  Number(
    process.env.TELEGRAM_AUTH_MAX_AGE || 3600
  );

/*
  Telegram IDs of administrators.

  Example:
  ADMIN_TELEGRAM_IDS=123456789,987654321
*/

const ADMIN_TELEGRAM_IDS = String(
  process.env.ADMIN_TELEGRAM_IDS || ""
)
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

/*
  Wallet from which administrator sends
  withdrawal USDT.

  IMPORTANT:
  NEVER put a private key here.
*/

const WITHDRAWAL_SOURCE_ADDRESS =
  process.env.WITHDRAWAL_SOURCE_ADDRESS || "";

const USDT_DECIMALS = 6;


/* =========================================================
   EXPRESS
========================================================= */

app.use(
  cors({
    origin: ALLOWED_ORIGIN,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "X-Telegram-Init-Data",
    ],
  })
);

app.use(
  express.json({
    limit: "100kb",
  })
);


/* =========================================================
   RATE LIMIT
========================================================= */

const rateMap = new Map();

function rateLimit(
  key,
  maxRequests,
  windowMs
) {
  const now = Date.now();

  const item = rateMap.get(key);

  if (
    !item ||
    now - item.start > windowMs
  ) {
    rateMap.set(key, {
      start: now,
      count: 1,
    });

    return true;
  }

  if (item.count >= maxRequests) {
    return false;
  }

  item.count++;

  return true;
}


/* =========================================================
   JSON DATABASE
========================================================= */

const DATA_DIR =
  path.join(__dirname, "data");

const DATA_FILE =
  path.join(
    DATA_DIR,
    "big-money-data.json"
  );

function defaultStore() {
  return {
    users: {},
    deposits: {},
    withdrawals: {},
  };
}

function ensureStore() {
  if (
    !fs.existsSync(DATA_DIR)
  ) {
    fs.mkdirSync(
      DATA_DIR,
      {
        recursive: true,
      }
    );
  }

  if (
    !fs.existsSync(DATA_FILE)
  ) {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(
        defaultStore(),
        null,
        2
      ),
      "utf8"
    );
  }
}

function readStore() {
  ensureStore();

  try {
    const raw =
      fs.readFileSync(
        DATA_FILE,
        "utf8"
      );

    const data =
      JSON.parse(raw);

    return {
      users: data.users || {},
      deposits:
        data.deposits || {},
      withdrawals:
        data.withdrawals || {},
    };
  } catch (error) {
    console.error(
      "STORE READ ERROR:",
      error
    );

    throw new Error(
      "Database read error"
    );
  }
}

function writeStore(data) {
  ensureStore();

  const tempFile =
    DATA_FILE + ".tmp";

  fs.writeFileSync(
    tempFile,
    JSON.stringify(
      data,
      null,
      2
    ),
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

let storeLock =
  Promise.resolve();

function withStoreLock(fn) {
  const next =
    storeLock.then(
      fn,
      fn
    );

  storeLock =
    next.catch(() => {});

  return next;
}


/* =========================================================
   USER
========================================================= */

function getUser(
  store,
  telegramUser
) {
  const id =
    String(
      telegramUser.id
    );

  if (!store.users[id]) {
    store.users[id] = {
      telegramUserId: id,

      username:
        telegramUser.username ||
        "",

      firstName:
        telegramUser.first_name ||
        "",

      lastName:
        telegramUser.last_name ||
        "",

      balance: 0,

      createdAt:
        new Date().toISOString(),

      updatedAt:
        new Date().toISOString(),
    };
  } else {
    store.users[id].username =
      telegramUser.username ||
      store.users[id].username ||
      "";

    store.users[id].firstName =
      telegramUser.first_name ||
      store.users[id].firstName ||
      "";

    store.users[id].lastName =
      telegramUser.last_name ||
      store.users[id].lastName ||
      "";

    store.users[id].updatedAt =
      new Date().toISOString();
  }

  return store.users[id];
}


/* =========================================================
   TELEGRAM INIT DATA VALIDATION
========================================================= */

function validateTelegramInitData(
  initData
) {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN is not configured on the server"
    );
  }

  if (
    typeof initData !== "string" ||
    !initData.trim()
  ) {
    throw new Error(
      "Missing Telegram initData"
    );
  }

  const params =
    new URLSearchParams(
      initData
    );

  const receivedHash =
    params.get("hash");

  if (!receivedHash) {
    throw new Error(
      "Telegram hash is missing"
    );
  }

  params.delete("hash");

  const dataCheckString =
    Array.from(
      params.entries()
    )
      .sort(
        ([a], [b]) =>
          a.localeCompare(b)
      )
      .map(
        ([key, value]) =>
          `${key}=${value}`
      )
      .join("\n");

  const secretKey =
    crypto
      .createHmac(
        "sha256",
        "WebAppData"
      )
      .update(
        TELEGRAM_BOT_TOKEN
      )
      .digest();

  const calculatedHash =
    crypto
      .createHmac(
        "sha256",
        secretKey
      )
      .update(
        dataCheckString
      )
      .digest("hex");

  const receivedBuffer =
    Buffer.from(
      receivedHash,
      "hex"
    );

  const calculatedBuffer =
    Buffer.from(
      calculatedHash,
      "hex"
    );

  if (
    receivedBuffer.length !==
      calculatedBuffer.length ||
    !crypto.timingSafeEqual(
      receivedBuffer,
      calculatedBuffer
    )
  ) {
    throw new Error(
      "Invalid Telegram initData"
    );
  }

  const authDate =
    Number(
      params.get("auth_date")
    );

  if (
    !Number.isFinite(
      authDate
    )
  ) {
    throw new Error(
      "Invalid Telegram auth_date"
    );
  }

  const age =
    Math.floor(
      Date.now() / 1000
    ) - authDate;

  if (
    age < -60 ||
    age > TELEGRAM_AUTH_MAX_AGE
  ) {
    throw new Error(
      "Telegram session expired"
    );
  }

  const userRaw =
    params.get("user");

  if (!userRaw) {
    throw new Error(
      "Telegram user data missing"
    );
  }

  let user;

  try {
    user =
      JSON.parse(userRaw);
  } catch {
    throw new Error(
      "Invalid Telegram user data"
    );
  }

  if (
    !user ||
    !user.id
  ) {
    throw new Error(
      "Invalid Telegram user"
    );
  }

  return user;
}


/* =========================================================
  
