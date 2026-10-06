const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();

const PORT = Number(process.env.PORT || 10000);

const TRONGRID_URL =
  process.env.TRONGRID_URL || "https://api.trongrid.io";

const TRONGRID_API_KEY =
  process.env.TRONGRID_API_KEY || "";

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || "";

const TELEGRAM_BOT_USERNAME =
  process.env.TELEGRAM_BOT_USERNAME || "bigmoney2026bot";

const ALLOWED_ORIGIN =
  process.env.ALLOWED_ORIGIN || "*";

const TELEGRAM_AUTH_MAX_AGE =
  Number(process.env.TELEGRAM_AUTH_MAX_AGE || 3600);

const ADMIN_TELEGRAM_IDS =
  String(process.env.ADMIN_TELEGRAM_IDS || "")
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);

const DEPOSIT_ADDRESS =
  process.env.DEPOSIT_ADDRESS ||
  "TAmkXMpkcqSZmG9oRvtXfBvpLWr53wXEdx";

const USDT_CONTRACT =
  process.env.USDT_CONTRACT ||
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const USDT_DECIMALS =
  Number(process.env.USDT_DECIMALS || 6);

const MIN_DEPOSIT =
  Number(process.env.MIN_DEPOSIT || 1);

const MIN_WITHDRAWAL =
  Number(process.env.MIN_WITHDRAWAL || 1);

const DAILY_REWARD =
  Number(process.env.DAILY_REWARD || 5);

const REQUIRED_REFERRALS =
  Number(process.env.REQUIRED_REFERRALS || 5);

const REFERRAL_REWARD =
  Number(process.env.REFERRAL_REWARD || 0);

const DATA_DIR =
  path.join(__dirname, "data");

const LOCAL_DB_FILE =
  path.join(DATA_DIR, "big-money-data.json");

const SUPABASE_URL =
  String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");

const SUPABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY || "";

const SUPABASE_TABLE =
  process.env.SUPABASE_TABLE || "big_money_store";

let storeLock = Promise.resolve();

function emptyDatabase() {
  return {
    users: {},
    deposits: {},
    withdrawals: {},
    referrals: {}
  };
}

function ensureDatabaseShape(db) {
  if (!db || typeof db !== "object") {
    db = emptyDatabase();
  }

  if (!db.users || typeof db.users !== "object") {
    db.users = {};
  }

  if (!db.deposits || typeof db.deposits !== "object") {
    db.deposits = {};
  }

  if (!db.withdrawals || typeof db.withdrawals !== "object") {
    db.withdrawals = {};
  }

  if (!db.referrals || typeof db.referrals !== "object") {
    db.referrals = {};
  }

  return db;
}

let database = emptyDatabase();

function nowISO() {
  return new Date().toISOString();
}

function randomId(prefix) {
  return (
    prefix +
    "_" +
    Date.now().toString(36) +
    "_" +
    crypto.randomBytes(5).toString("hex")
  );
}

function normalizeAmount(value) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return 0;
  }

  return Math.round(n * 1000000) / 1000000;
}

function rawToAmount(raw) {
  return Number(raw) / Math.pow(10, USDT_DECIMALS);
}

function amountToRaw(amount) {
  return Math.round(
    Number(amount) * Math.pow(10, USDT_DECIMALS)
  );
}

function supabaseConfigured() {
  return Boolean(
    SUPABASE_URL &&
    SUPABASE_SECRET_KEY
  );
}

function supabaseHeaders() {
  return {
    apikey: SUPABASE_SECRET_KEY,
    Authorization:
      `Bearer ${SUPABASE_SECRET_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json"
  };
}

/* =========================================================
   LOCAL DATABASE
   ========================================================= */

async function loadLocalDatabase() {
  try {
    await fs.promises.mkdir(
      DATA_DIR,
      { recursive: true }
    );

    if (!fs.existsSync(LOCAL_DB_FILE)) {
      database = emptyDatabase();

      await fs.promises.writeFile(
        LOCAL_DB_FILE,
        JSON.stringify(database, null, 2),
        "utf8"
      );

      return database;
    }

    const text =
      await fs.promises.readFile(
        LOCAL_DB_FILE,
        "utf8"
      );

    database =
      ensureDatabaseShape(
        JSON.parse(text)
      );

    return database;

  } catch (error) {
    console.error(
      "Local database load error:",
      error.message
    );

    database = emptyDatabase();

    return database;
  }
}

async function saveLocalDatabase() {
  await fs.promises.mkdir(
    DATA_DIR,
    { recursive: true }
  );

  const temp =
    LOCAL_DB_FILE + ".tmp";

  await fs.promises.writeFile(
    temp,
    JSON.stringify(database, null, 2),
    "utf8"
  );

  await fs.promises.rename(
    temp,
    LOCAL_DB_FILE
  );
}

/* =========================================================
   SUPABASE
   ========================================================= */

async function supabaseGetDatabase() {
  if (!supabaseConfigured()) {
    throw new Error(
      "SUPABASE_URL or SUPABASE_SECRET_KEY is missing"
    );
  }

  const url =
    `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}` +
    `?id=eq.1&select=id,data,updated_at`;

  const response =
    await fetch(url, {
      method: "GET",
      headers: supabaseHeaders()
    });

  if (!response.ok) {
    throw new Error(
      `Supabase GET ${response.status}: ${await response.text()}`
    );
  }

  const result =
    await response.json();

  if (
    !Array.isArray(result) ||
    result.length === 0
  ) {
    return null;
  }

  return ensureDatabaseShape(
    result[0].data
  );
}

async function supabaseSaveDatabase() {
  if (!supabaseConfigured()) {
    return;
  }

  const url =
    `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}`;

  const response =
    await fetch(url, {
      method: "POST",
      headers: {
        ...supabaseHeaders(),
        Prefer:
          "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify({
        id: 1,
        data: database,
        updated_at: nowISO()
      })
    });

  if (!response.ok) {
    throw new Error(
      `Supabase SAVE ${response.status}: ${await response.text()}`
    );
  }
}

async function saveDatabase() {
  storeLock =
    storeLock.then(async () => {
      await saveLocalDatabase();

      if (supabaseConfigured()) {
        try {
          await supabaseSaveDatabase();
        } catch (error) {
          console.error(
            "Supabase save error:",
            error.message
          );
        }
      }
    });

  return storeLock;
}

async function initializeDatabase() {
  await loadLocalDatabase();

  if (!supabaseConfigured()) {
    console.log(
      "Supabase persistence: DISABLED"
    );
    return;
  }

  try {
    const remote =
      await supabaseGetDatabase();

    if (remote) {
      database = remote;

      await saveLocalDatabase();

      console.log(
        "Big Money database loaded from Supabase."
      );
    } else {
      await supabaseSaveDatabase();

      console.log(
        "Big Money database created in Supabase."
      );
    }

  } catch (error) {
    console.error(
      "Supabase database load error:",
      error.message
    );

    console.log(
      "Using local backup database."
    );
  }

  console.log(
    "Supabase persistence: ENABLED"
  );
}

/* =========================================================
   TELEGRAM AUTHENTICATION
   ========================================================= */

function telegramAuthValid(initData) {
  if (!TELEGRAM_BOT_TOKEN) {
    return false;
  }

  if (!initData) {
    return false;
  }

  const params =
    new URLSearchParams(initData);

  const hash =
    params.get("hash");

  if (!hash) {
    return false;
  }

  params.delete("hash");

  const dataCheckString =
    [...params.entries()]
      .sort(([a], [b]) =>
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
      .update(TELEGRAM_BOT_TOKEN)
      .digest();

  const calculated =
    crypto
      .createHmac(
        "sha256",
        secretKey
      )
      .update(dataCheckString)
      .digest("hex");

  if (calculated !== hash) {
    return false;
  }

  const authDate =
    Number(
      params.get("auth_date") || 0
    );

  if (!authDate) {
    return false;
  }

  const age =
    Math.floor(Date.now() / 1000) -
    authDate;

  if (
    age < 0 ||
    age > TELEGRAM_AUTH_MAX_AGE
  ) {
    return false;
  }

  return true;
}

function getTelegramUserFromInitData(initData) {
  if (!telegramAuthValid(initData)) {
    return null;
  }

  const params =
    new URLSearchParams(initData);

  const userText =
    params.get("user");

  if (!userText) {
    return null;
  }

  try {
    return JSON.parse(userText);
  } catch {
    return null;
  }
}

function getStartParam(initData) {
  if (!initData) {
    return "";
  }

  const params =
    new URLSearchParams(initData);

  return (
    params.get("start_param") ||
    params.get("startapp") ||
    ""
  );
}

function authMiddleware(req, res, next) {
  const initData =
    req.headers["x-telegram-init-data"] ||
    "";

  const user =
    getTelegramUserFromInitData(
      initData
    );

  if (
    !user ||
    !user.id
  ) {
    return res.status(401).json({
      ok: false,
      error:
        "Telegram authentication required"
    });
  }

  req.telegramUser = user;
  req.initData = initData;

  next();
}

/* =========================================================
   TELEGRAM PROFILE
   ========================================================= */

async function getTelegramProfileFromBot(
  telegramId
) {
  if (
    !TELEGRAM_BOT_TOKEN ||
    !telegramId
  ) {
    return null;
  }

  try {
    const url =
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getChat` +
      `?chat_id=${encodeURIComponent(
        String(telegramId)
      )}`;

    const response =
      await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json"
        }
      });

    if (!response.ok) {
      console.error(
        "Telegram getChat HTTP error:",
        response.status
      );

      return null;
    }

    const result =
      await response.json();

    if (
      !result.ok ||
      !result.result
    ) {
      return null;
    }

    return result.result;

  } catch (error) {
    console.error(
      "Telegram getChat failed:",
      error.message
    );

    return null;
  }
}

/* =========================================================
   USERS
   ========================================================= */

function getUser(userId) {
  const id =
    String(userId);

  if (!database.users[id]) {
    database.users[id] = {
      id,
      telegramId: id,

      username: "",
      telegramUsername: "",
      telegram_username: "",

      firstName: "",
      lastName: "",

      first_name: "",
      last_name: "",

      balance: 0,
      points: 0,

      referralCode:
        `ref_${id}`,

      referredBy: null,

      referralCount: 0,
      successfulReferralCount: 0,

      totalDeposited: 0,
      totalWithdrawn: 0,

      dailyRewardAt: null,

      createdAt: nowISO(),
      updatedAt: nowISO()
    };
  }

  return database.users[id];
}

async function updateTelegramUser(user) {
  const dbUser =
    getUser(user.id);

  let username =
    user.username || "";

  let firstName =
    user.first_name || "";

  let lastName =
    user.last_name || "";

  if (
    !username ||
    !firstName ||
    !lastName
  ) {
    const telegramProfile =
      await getTelegramProfileFromBot(
        user.id
      );

    if (telegramProfile) {
      username =
        telegramProfile.username ||
        username;

      firstName =
        telegramProfile.first_name ||
        firstName;

      lastName =
        telegramProfile.last_name ||
        lastName;
    }
  }

  dbUser.telegramId =
    String(user.id);

  dbUser.username =
    username || "";

  dbUser.telegramUsername =
    username || "";

  dbUser.telegram_username =
    username || "";

  dbUser.firstName =
    firstName || "";

  dbUser.lastName =
    lastName || "";

  dbUser.first_name =
    firstName || "";

  dbUser.last_name =
    lastName || "";

  dbUser.updatedAt =
    nowISO();

  await saveDatabase();

  return dbUser;
}

/* =========================================================
   ADMIN
   ========================================================= */

function isAdmin(userId) {
  return ADMIN_TELEGRAM_IDS.includes(
    String(userId)
  );
}

function adminMiddleware(req, res, next) {
  const initData =
    req.headers["x-telegram-init-data"] ||
    "";

  const user =
    getTelegramUserFromInitData(
      initData
    );

  if (
    !user ||
    !isAdmin(user.id)
  ) {
    return res.status(403).json({
      ok: false,
      error:
        "Admin access required"
    });
  }

  req.telegramUser = user;

  next();
}

/* =========================================================
   TRON / TRONGRID
   ========================================================= */

function tronHeaders() {
  const headers = {
    Accept: "application/json"
  };

  if (TRONGRID_API_KEY) {
    headers["TRON-PRO-API-KEY"] =
      TRONGRID_API_KEY;
  }

  return headers;
}

async function tronGet(url) {
  const response =
    await fetch(url, {
      method: "GET",
      headers: tronHeaders()
    });

  if (!response.ok) {
    throw new Error(
      `TronGrid HTTP ${response.status}: ${await response.text()}`
    );
  }

  return response.json();
}

/* =========================================================
   GET CONFIRMED USDT TRANSFERS BY TXID
   ========================================================= */

async function getConfirmedUsdtTransfers(txid) {
  const cleanTxid =
    String(txid || "").trim();

  if (!cleanTxid) {
    return [];
  }

  const url =
    `${TRONGRID_URL}/v1/transactions/${cleanTxid}/events` +
    `?only_confirmed=true&limit=200`;

  console.log(
    "Checking Tron transaction:",
    cleanTxid
  );

  const data =
    await tronGet(url);

  const rows =
    Array.isArray(data.data)
      ? data.data
      : [];

  return rows.filter(event => {
    const contract =
      String(
        event.contract_address || ""
      )
        .trim()
        .toLowerCase();

    const eventName =
      String(
        event.event_name || ""
      )
        .trim()
        .toLowerCase();

    return (
      contract ===
        USDT_CONTRACT.toLowerCase() &&
      eventName === "transfer"
    );
  });
}

function eventToTransfer(event) {
  const result =
    event.result || {};

  const from =
    String(
      result.from ||
      event.from ||
      ""
    );

  const to =
    String(
      result.to ||
      event.to ||
      ""
    );

  const value =
    String(
      result.value ||
      event.value ||
      "0"
    );

  return {
    from,
    to,
    rawValue: value,
    amount:
      normalizeAmount(
        rawToAmount(value)
      )
  };
}

/* =========================================================
   VERIFY TRANSACTION
   ========================================================= */

async function verifyTransaction(
  txid,
  expectedAmount
) {
  const cleanTxid =
    String(txid || "").trim();

  if (!cleanTxid) {
    throw new Error(
      "TXID is required"
    );
  }

  const events =
    await getConfirmedUsdtTransfers(
      cleanTxid
    );

  console.log(
    "USDT events found:",
    events.length
  );

  for (const event of events) {
    const transfer =
      eventToTransfer(event);

    if (!transfer.to) {
      continue;
    }

    console.log(
      "Transfer:",
      transfer
    );

    if (
      transfer.to.toLowerCase() !==
      DEPOSIT_ADDRESS.toLowerCase()
    ) {
      continue;
    }

    /*
     * مبلغ واقعی از بلاکچین گرفته می‌شود.
     *
     * expectedAmount فقط برای اطلاعات است.
     * بنابراین اگر کاربر 10 USDT یا 10.25 USDT
     * فرستاده باشد، همان مبلغ واقعی ثبت می‌شود.
     */

    return {
      confirmed: true,

      txid:
        cleanTxid,

      amount:
        normalizeAmount(
          transfer.amount
        ),

      from:
        transfer.from,

      to:
        transfer.to
    };
  }

  return {
    confirmed: false,
    txid: cleanTxid
  };
}

/* =========================================================
   DEPOSIT AMOUNT
   ========================================================= */

function generateUniquePaymentAmount(
  baseAmount
) {
  const base =
    normalizeAmount(
      baseAmount
    );

  for (
    let i = 0;
    i < 500;
    i++
  ) {
    const extra =
      (
        Math.floor(
          Math.random() * 9000
        ) + 1
      ) / 1000000;

    const amount =
      normalizeAmount(
        base + extra
      );

    const alreadyUsed =
      Object.values(
        database.deposits
      ).some(
        d =>
          d.status === "pending" &&
          Math.abs(
            Number(
              d.paymentAmount
            ) -
            amount
          ) < 0.000001
      );

    if (!alreadyUsed) {
      return amount;
    }
  }

  return normalizeAmount(
    base + 0.000001
  );
}

/* =========================================================
   PROCESS DEPOSIT
   ========================================================= */

async function processDeposit(
  deposit,
  transfer
) {
  if (
    deposit.status ===
    "confirmed"
  ) {
    return false;
  }

  const actualAmount =
    normalizeAmount(
      transfer.amount
    );

  if (
    actualAmount <= 0
  ) {
    return false;
  }

  const user =
    getUser(
      deposit.userId
    );

  deposit.status =
    "confirmed";

  deposit.txid =
    transfer.txid ||
    deposit.txid;

  deposit.confirmedAmount =
    actualAmount;

  /*
   * بسیار مهم:
   * paymentAmount نیز مبلغ واقعی بلاکچین می‌شود.
   */
  deposit.paymentAmount =
    actualAmount;

  deposit.confirmedAt =
    nowISO();

  user.balance =
    normalizeAmount(
      Number(user.balance) +
      actualAmount
    );

  user.totalDeposited =
    normalizeAmount(
      Number(user.totalDeposited) +
      actualAmount
    );

  /*
   * Daily Reward
   */
  if (
    actualAmount >= 10
  ) {
    if (
      !deposit.qualifyingDeposit
    ) {
      deposit.qualifyingDeposit =
        true;

      if (
        !user.dailyRewardAt
      ) {
        user.balance =
          normalizeAmount(
            Number(user.balance) +
            DAILY_REWARD
          );

        user.dailyRewardAt =
          nowISO();

        deposit.dailyReward =
          DAILY_REWARD;
      }

      await processSuccessfulReferral(
        user
      );
    }
  }

  await saveDatabase();

  console.log(
    "DEPOSIT CONFIRMED:",
    {
      userId:
        user.id,
      amount:
        actualAmount,
      txid:
        deposit.txid
    }
  );

  return true;
}

/* =========================================================
   SUCCESSFUL REFERRAL
   ========================================================= */

async function processSuccessfulReferral(
  user
) {
  if (!user.referredBy) {
    return;
  }

  const inviter =
    database.users[
      String(user.referredBy)
    ];

  if (!inviter) {
    return;
  }

  const referralKey =
    `${inviter.id}_${user.id}`;

  if (
    database.referrals[
      referralKey
    ]
  ) {
    return;
  }

  database.referrals[
    referralKey
  ] = {
    inviterId:
      String(inviter.id),

    referredUserId:
      String(user.id),

    reward:
      REFERRAL_REWARD,

    successful:
      true,

    createdAt:
      nowISO()
  };

  inviter.successfulReferralCount =
    Number(
      inviter.successfulReferralCount ||
      0
    ) + 1;

  if (
    REFERRAL_REWARD > 0
  ) {
    inviter.balance =
      normalizeAmount(
        Number(inviter.balance) +
        REFERRAL_REWARD
      );

    inviter.points =
      Number(
        inviter.points || 0
      ) +
      REFERRAL_REWARD;
  }

  await saveDatabase();
}

/* =========================================================
   REFERRAL
   ========================================================= */

async function processReferral(
  user,
  startParam
) {
  const code =
    String(
      startParam || ""
    ).trim();

  if (
    !code.startsWith("ref_")
  ) {
    return;
  }

  if (
    user.referredBy
  ) {
    return;
  }

  const inviterId =
    code.replace(
      "ref_",
      ""
    );

  if (
    !inviterId ||
    String(inviterId) ===
    String(user.id)
  ) {
    return;
  }

  const inviter =
    database.users[
      String(inviterId)
    ];

  if (!inviter) {
    return;
  }

  user.referredBy =
    String(inviterId);

  inviter.referralCount =
    Number(
      inviter.referralCount || 0
    ) + 1;

  await saveDatabase();
}

/* =========================================================
   BACKGROUND DEPOSIT SCANNER
   ========================================================= */

async function scanPendingDeposits() {
  const pending =
    Object.values(
      database.deposits
    ).filter(
      d =>
        d.status === "pending" &&
        d.txid
    );

  if (!pending.length) {
    return;
  }

  for (
    const deposit of pending
  ) {
    try {
      const verified =
        await verifyTransaction(
          deposit.txid
        );

      if (
        !verified.confirmed
      ) {
        continue;
      }

      if (
        verified.to.toLowerCase() !==
        DEPOSIT_ADDRESS.toLowerCase()
      ) {
        continue;
      }

      await processDeposit(
        deposit,
        verified
      );

    } catch (error) {
      console.error(
        "Deposit scanner error:",
        error.message
      );
    }
  }
}

/* =========================================================
   MIDDLEWARE
   ========================================================= */

app.use(
  cors({
    origin:
      function (
        origin,
        callback
      ) {
        if (
          !origin ||
          ALLOWED_ORIGIN === "*" ||
          origin === ALLOWED_ORIGIN
        ) {
          return callback(
            null,
            true
          );
        }

        return callback(
          new Error(
            "CORS blocked"
          )
        );
      },

    allowedHeaders: [
      "Content-Type",
      "X-Telegram-Init-Data"
    ],

    methods: [
      "GET",
      "POST",
      "OPTIONS"
    ]
  })
);

app.use(
  express.json({
    limit: "1mb"
  })
);

/* =========================================================
   BASIC
   ========================================================= */

app.get(
  "/",
  (req, res) => {
    res.json({
      ok: true,
      app: "Big Money",
      network: "TRON TRC20",
      token: "USDT",
      status: "online"
    });
  }
);

app.get(
  "/health",
  (req, res) => {
    res.json({
      ok: true,
      name:
        "Big Money Backend",
      network:
        "TRON TRC20",
      version:
        "deposit-txid-v4"
    });
  }
);

/* =========================================================
   CONFIG
   ========================================================= */

app.get(
  "/api/config",
  (req, res) => {
    res.json({
      ok: true,

      depositAddress:
        DEPOSIT_ADDRESS,

      usdtContract:
        USDT_CONTRACT,

      minDeposit:
        MIN_DEPOSIT,

      minWithdrawal:
        MIN_WITHDRAWAL,

      dailyReward:
        DAILY_REWARD,

      requiredReferrals:
        REQUIRED_REFERRALS,

      telegramBotUsername:
        TELEGRAM_BOT_USERNAME
    });
  }
);

/* =========================================================
   ACCOUNT
   ========================================================= */

app.get(
  "/api/account",
  authMiddleware,
  async (req, res) => {
    try {
      const user =
        await updateTelegramUser(
          req.telegramUser
        );

      await processReferral(
        user,
        getStartParam(
          req.initData
        )
      );

      res.json({
        ok: true,

        user: {
          id:
            user.id,

          telegramId:
            user.telegramId,

          username:
            user.username || "",

          telegramUsername:
            user.telegramUsername ||
            user.username ||
            "",

          telegram_username:
            user.telegram_username ||
            user.username ||
            "",

          firstName:
            user.firstName || "",

          lastName:
            user.lastName || "",

          first_name:
            user.first_name ||
            user.firstName ||
            "",

          last_name:
            user.last_name ||
            user.lastName ||
            "",

          balance:
            Number(
              user.balance || 0
            ),

          points:
            Number(
              user.points || 0
            ),

          referralCode:
            user.referralCode ||
            `ref_${user.telegramId}`,

          referralCount:
            Number(
              user.referralCount || 0
            ),

          successfulReferralCount:
            Number(
              user.successfulReferralCount ||
              0
            ),

          totalDeposited:
            Number(
              user.totalDeposited || 0
            ),

          totalWithdrawn:
            Number(
              user.totalWithdrawn || 0
            )
        }
      });

    } catch (error) {
      console.error(
        "/api/account error:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

/* =========================================================
   PROFILE
   ========================================================= */

app.get(
  "/api/profile",
  authMiddleware,
  async (req, res) => {
    try {
      const user =
        await updateTelegramUser(
          req.telegramUser
        );

      res.json({
        ok: true,

        user: {
          id:
            user.id,

          telegramId:
            user.telegramId,

          username:
            user.username,

          telegramUsername:
            user.telegramUsername ||
            user.username,

          firstName:
            user.firstName,

          lastName:
            user.lastName,

          balance:
            user.balance,

          points:
            user.points,

          referralCode:
            user.referralCode,

          referralCount:
            user.referralCount,

          successfulReferralCount:
            user.successfulReferralCount,

          totalDeposited:
            user.totalDeposited,

          totalWithdrawn:
            user.totalWithdrawn
        }
      });

    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

/* =========================================================
   REFERRALS
   ========================================================= */

app.get(
  "/api/referrals",
  authMiddleware,
  async (req, res) => {
    try {
      const user =
        getUser(
          req.telegramUser.id
        );

      const referrals =
        Object.values(
          database.referrals
        ).filter(
          r =>
            String(r.inviterId) ===
            String(user.id)
        );

      res.json({
        ok: true,

        referralCode:
          user.referralCode,

        referralLink:
          `https://t.me/${TELEGRAM_BOT_USERNAME}?startapp=${user.referralCode}`,

        referralCount:
          user.referralCount,

        successfulReferralCount:
          user.successfulReferralCount,

        referrals
      });

    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

/* =========================================================
   DEPOSIT REQUEST
   ========================================================= */

app.post(
  "/api/deposits/request",
  authMiddleware,
  async (req, res) => {
    try {
      const amount =
        normalizeAmount(
          req.body.amount
        );

      if (
        amount < MIN_DEPOSIT
      ) {
        return res.status(400).json({
          ok: false,
          error:
            `Minimum deposit is ${MIN_DEPOSIT} USDT`
        });
      }

      const user =
        await updateTelegramUser(
          req.telegramUser
        );

      const paymentAmount =
        generateUniquePaymentAmount(
          amount
        );

      const deposit = {
        id:
          randomId("dep"),

        userId:
          String(user.id),

        requestedAmount:
          amount,

        paymentAmount:
          paymentAmount,

        address:
          DEPOSIT_ADDRESS,

        status:
          "pending",

        txid:
          null,

        createdAt:
          nowISO(),

        confirmedAt:
          null,

        confirmedAmount:
          0
      };

      database.deposits[
        deposit.id
      ] = deposit;

      await saveDatabase();

      res.json({
        ok: true,
        deposit
      });

    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

/* =========================================================
   DEPOSIT CHECK
   ========================================================= */

app.post(
  "/api/deposits/check",
  authMiddleware,
  async (req, res) => {
    try {
      const depositId =
        String(
          req.body.depositId || ""
        ).trim();

      const txid =
        String(
          req.body.txid || ""
        ).trim();

      let deposit = null;

      if (depositId) {
        deposit =
          database.deposits[
            depositId
          ];
      }

      if (
        !deposit &&
        txid
      ) {
        deposit =
          Object.values(
            database.deposits
          ).find(
            d =>
              String(
                d.txid || ""
              ).toLowerCase() ===
              txid.toLowerCase()
          );
      }

      if (!deposit) {
        return res.status(404).json({
          ok: false,
          error:
            "Deposit request not found"
        });
      }

      if (
        String(deposit.userId) !==
        String(
          req.telegramUser.id
        )
      ) {
        return res.status(403).json({
          ok: false,
          error:
            "Access denied"
        });
      }

      if (
        deposit.status ===
        "confirmed"
      ) {
        return res.json({
          ok: true,
          confirmed: true,
          amount:
            Number(
              deposit.confirmedAmount ||
              deposit.paymentAmount ||
              0
            ),
          deposit
        });
      }

      if (!txid) {
        return res.json({
          ok: true,
          confirmed: false,
          deposit
        });
      }

      const verified =
        await verifyTransaction(
          txid
        );

      if (
        !verified.confirmed
      ) {
        return res.json({
          ok: true,
          confirmed: false,
          deposit,
          message:
            "Transaction not found or not confirmed yet."
        });
      }

      verified.txid =
        txid;

      await processDeposit(
        deposit,
        verified
      );

      res.json({
        ok: true,

        confirmed:
          true,

        amount:
          Number(
            verified.amount
          ),

        deposit
      });

    } catch (error) {
      console.error(
        "/api/deposits/check error:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

/* =========================================================
   DEPOSIT VERIFY BY TXID
   ========================================================= */

app.post(
  "/api/deposits/verify",
  authMiddleware,
  async (req, res) => {
    try {
      const txid =
        String(
          req.body.txid || ""
        ).trim();

      if (!txid) {
        return res.status(400).json({
          ok: false,
          error:
            "TXID is required"
        });
      }

      console.log(
        "VERIFY DEPOSIT:",
        txid
      );

      /*
       * اگر TXID قبلاً ثبت شده باشد
       */
      const existing =
        Object.values(
          database.deposits
        ).find(
          d =>
            String(
              d.txid || ""
            ).toLowerCase() ===
            txid.toLowerCase()
        );

      if (existing) {
        if (
          String(existing.userId) !==
          String(
            req.telegramUser.id
          )
        ) {
          return res.status(403).json({
            ok: false,
            error:
              "This transaction belongs to another account"
          });
        }

        if (
          existing.status ===
          "confirmed"
        ) {
          return res.json({
            ok: true,

            confirmed:
              true,

            amount:
              Number(
                existing.confirmedAmount ||
                existing.paymentAmount ||
                0
              ),

            txid,

            deposit:
              existing
          });
        }
      }

      /*
       * بررسی مستقیم TXID در TronGrid
       */
      const result =
        await verifyTransaction(
          txid
        );

      if (
        !result.confirmed
      ) {
        return res.json({
          ok: true,

          confirmed:
            false,

          txid,

          message:
            "Transaction not found, not a USDT transfer to the deposit address, or not confirmed yet."
        });
      }

      /*
       * بررسی حداقل مبلغ
       */
      if (
        Number(result.amount) <
        Number(MIN_DEPOSIT)
      ) {
        return res.json({
          ok: true,

          confirmed:
            false,

          txid,

          amount:
            Number(result.amount),

          message:
            `Deposit amount is below the minimum of ${MIN_DEPOSIT} USDT.`
        });
      }

      /*
       * کاربر فعلی
       */
      const user =
        getUser(
          req.telegramUser.id
        );

      /*
       * پیدا کردن Deposit pending
       */
      let deposit =
        Object.values(
          database.deposits
        ).find(
          d =>
            String(d.userId) ===
            String(user.id) &&
            d.status === "pending"
        );

      /*
       * اگر Deposit pending نبود،
       * یکی جدید می‌سازیم.
       */
      if (!deposit) {
        deposit = {
          id:
            randomId("dep"),

          userId:
            String(user.id),

          requestedAmount:
            Number(
              result.amount
            ),

          paymentAmount:
            Number(
              result.amount
            ),

          address:
            DEPOSIT_ADDRESS,

          status:
            "pending",

          txid:
            txid,

          createdAt:
            nowISO(),

          confirmedAt:
            null,

          confirmedAmount:
            0
        };

        database.deposits[
          deposit.id
        ] = deposit;

      } else {
        deposit.txid =
          txid;

        /*
         * مبلغ واقعی بلاکچین
         */
        deposit.paymentAmount =
          Number(
            result.amount
          );
      }

      /*
       * جلوگیری از ثبت یک TXID
       * برای دو کاربر
       */
      const txAlreadyUsed =
        Object.values(
          database.deposits
        ).find(
          d =>
            d.id !== deposit.id &&
            String(
              d.txid || ""
            ).toLowerCase() ===
            txid.toLowerCase() &&
            d.status === "confirmed"
        );

      if (txAlreadyUsed) {
        return res.status(400).json({
          ok: false,
          error:
            "This transaction has already been credited."
        });
      }

      await saveDatabase();

      /*
       * اعتباردهی مبلغ واقعی
       */
      await processDeposit(
        deposit,
        result
      );

      res.json({
        ok: true,

        confirmed:
          true,

        amount:
          Number(
            result.amount
          ),

        txid,

        deposit
      });

    } catch (error) {
      console.error(
        "/api/deposits/verify error:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

/* =========================================================
   DEPOSITS
   ========================================================= */

app.get(
  "/api/deposits",
  authMiddleware,
  async (req, res) => {
    const deposits =
      Object.values(
        database.deposits
      )
        .filter(
          d =>
            String(d.userId) ===
            String(
              req.telegramUser.id
            )
        )
        .sort(
          (a, b) =>
            new Date(b.createdAt) -
            new Date(a.createdAt)
        );

    res.json({
      ok: true,
      deposits
    });
  }
);

/* =========================================================
   WITHDRAW
   ========================================================= */

app.post(
  "/api/withdraw",
  authMiddleware,
  async (req, res) => {
    try {
      const amount =
        normalizeAmount(
          req.body.amount
        );

      const address =
        String(
          req.body.address || ""
        ).trim();

      if (
        amount < MIN_WITHDRAWAL
      ) {
        return res.status(400).json({
          ok: false,
          error:
            `Minimum withdrawal is ${MIN_WITHDRAWAL} USDT`
        });
      }

      if (
        !address ||
        !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(
          address
        )
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Invalid TRON address"
        });
      }

      const user =
        getUser(
          req.telegramUser.id
        );

      if (
        Number(
          user.successfulReferralCount
        ) <
        REQUIRED_REFERRALS
      ) {
        return res.status(400).json({
          ok: false,
          error:
            `You need ${REQUIRED_REFERRALS} successful referrals before withdrawal.`
        });
      }

      if (
        Number(user.balance) <
        amount
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Insufficient balance"
        });
      }

      user.balance =
        normalizeAmount(
          Number(user.balance) -
          amount
        );

      const withdrawal = {
        id:
          randomId("wd"),

        userId:
          String(user.id),

        amount,

        address,

        status:
          "pending",

        txid:
          null,

        createdAt:
          nowISO(),

        approvedAt:
          null,

        paidAt:
          null,

        rejectedAt:
          null
      };

      database.withdrawals[
        withdrawal.id
      ] = withdrawal;

      await saveDatabase();

      res.json({
        ok: true,
        withdrawal
      });

    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

/* =========================================================
   WITHDRAWALS
   ========================================================= */

app.get(
  "/api/withdrawals",
  authMiddleware,
  async (req, res) => {
    const withdrawals =
      Object.values(
        database.withdrawals
      )
        .filter(
          w =>
            String(w.userId) ===
            String(
              req.telegramUser.id
            )
        )
        .sort(
          (a, b) =>
            new Date(b.createdAt) -
            new Date(a.createdAt)
        );

    res.json({
      ok: true,
      withdrawals
    });
  }
);

/* =========================================================
   ADMIN WITHDRAWALS
   ========================================================= */

app.get(
  "/api/admin/withdrawals",
  adminMiddleware,
  async (req, res) => {
    const withdrawals =
      Object.values(
        database.withdrawals
      )
        .sort(
          (a, b) =>
            new Date(b.createdAt) -
            new Date(a.createdAt)
        );

    res.json({
      ok: true,
      withdrawals
    });
  }
);

/* =========================================================
   ADMIN APPROVE
   ========================================================= */

app.post(
  "/api/admin/withdrawals/:id/approve",
  adminMiddleware,
  async (req, res) => {
    try {
      const withdrawal =
        database.withdrawals[
          req.params.id
        ];

      if (!withdrawal) {
        return res.status(404).json({
          ok: false,
          error:
            "Withdrawal not found"
        });
      }

      if (
        withdrawal.status !==
        "pending"
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Withdrawal is not pending"
        });
      }

      withdrawal.status =
        "approved";

      withdrawal.approvedAt =
        nowISO();

      await saveDatabase();

      res.json({
        ok: true,
        withdrawal
      });

    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

/* =========================================================
   ADMIN REJECT
   ========================================================= */

app.post(
  "/api/admin/withdrawals/:id/reject",
  adminMiddleware,
  async (req, res) => {
    try {
      const withdrawal =
        database.withdrawals[
          req.params.id
        ];

      if (!withdrawal) {
        return res.status(404).json({
          ok: false,
          error:
            "Withdrawal not found"
        });
      }

      if (
        withdrawal.status !==
          "pending" &&
        withdrawal.status !==
          "approved"
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Withdrawal cannot be rejected"
        });
      }

      const user =
        getUser(
          withdrawal.userId
        );

      user.balance =
        normalizeAmount(
          Number(user.balance) +
          Number(withdrawal.amount)
        );

      withdrawal.status =
        "rejected";

      withdrawal.rejectedAt =
        nowISO();

      await saveDatabase();

      res.json({
        ok: true,
        withdrawal
      });

    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

/* =========================================================
   ADMIN PAID
   ========================================================= */

app.post(
  "/api/admin/withdrawals/:id/paid",
  adminMiddleware,
  async (req, res) => {
    try {
      const withdrawal =
        database.withdrawals[
          req.params.id
        ];

      if (!withdrawal) {
        return res.status(404).json({
          ok: false,
          error:
            "Withdrawal not found"
        });
      }

      const txid =
        String(
          req.body.txid || ""
        ).trim();

      if (!txid) {
        return res.status(400).json({
          ok: false,
          error:
            "TXID is required"
        });
      }

      const user =
        getUser(
          withdrawal.userId
        );

      user.totalWithdrawn =
        normalizeAmount(
          Number(
            user.totalWithdrawn
          ) +
          Number(
            withdrawal.amount
          )
        );

      withdrawal.status =
        "paid";

      withdrawal.txid =
        txid;

      withdrawal.paidAt =
        nowISO();

      await saveDatabase();

      res.json({
        ok: true,
        withdrawal
      });

    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

/* =========================================================
   ADMIN CREDIT
   ========================================================= */

app.post(
  "/api/admin/credit",
  adminMiddleware,
  async (req, res) => {
    try {
      const telegramId =
        String(
          req.body.telegramId || ""
        ).trim();

      const amount =
        normalizeAmount(
          req.body.amount
        );

      if (
        !telegramId ||
        amount <= 0
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "telegramId and positive amount are required"
        });
      }

      const user =
        getUser(
          telegramId
        );

      user.balance =
        normalizeAmount(
          Number(user.balance) +
          amount
        );

      await saveDatabase();

      res.json({
        ok: true,
        user
      });

    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

/* =========================================================
   404
   ========================================================= */

app.use(
  (req, res) => {
    res.status(404).json({
      ok: false,
      error:
        "Not found"
    });
  }
);

/* =========================================================
   START SERVER
   ========================================================= */

async function startServer() {
  try {
    await initializeDatabase();

    console.log(
      "================================="
    );

    console.log(
      "Big Money Backend"
    );

    console.log(
      "Deposit address:",
      DEPOSIT_ADDRESS
    );

    console.log(
      "USDT contract:",
      USDT_CONTRACT
    );

    console.log(
      "Minimum deposit:",
      MIN_DEPOSIT
    );

    console.log(
      "Minimum withdrawal:",
      MIN_WITHDRAWAL
    );

    console.log(
      "Daily reward:",
      DAILY_REWARD
    );

    console.log(
      "Required successful referrals:",
      REQUIRED_REFERRALS
    );

    console.log(
      "TRON deposit verification: ENABLED"
    );

    console.log(
      "TXID amount detection: ENABLED"
    );

    console.log(
      "Supabase:",
      supabaseConfigured()
        ? "ENABLED"
        : "DISABLED"
    );

    console.log(
      "================================="
    );

    app.listen(
      PORT,
      "0.0.0.0",
      () => {
        console.log(
          `Big Money API running on port ${PORT}`
        );

        console.log(
          "Network: TRON TRC20"
        );
      }
    );

    /*
     * هر 15 ثانیه Deposit های pending
     * که TXID دارند بررسی می‌شوند.
     */
    setInterval(
      async () => {
        try {
          await scanPendingDeposits();
        } catch (error) {
          console.error(
            "Background scanner error:",
            error.message
          );
        }
      },
      15000
    );

  } catch (error) {
    console.error(
      "Startup error:",
      error
    );

    process.exit(1);
  }
}

startServer();
