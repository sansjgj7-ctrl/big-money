const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();

/* =========================================================
   BASIC SETTINGS
========================================================= */

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
  process.env.ALLOWED_ORIGIN ||
  "https://sansjgj7-ctrl.github.io";

const TELEGRAM_AUTH_MAX_AGE =
  Number(process.env.TELEGRAM_AUTH_MAX_AGE || 3600);


/* =========================================================
   DEPOSIT / REWARD SETTINGS
========================================================= */

const MIN_DEPOSIT =
  Number(process.env.MIN_DEPOSIT || 5);

const QUALIFYING_DEPOSIT =
  Number(process.env.QUALIFYING_DEPOSIT || 10);


/*
  DAILY REWARD
  5 USDT
  Available every 24 hours
*/

const DAILY_REWARD_USDT =
  Number(
    process.env.DAILY_REWARD_USDT ||
    process.env.DAILY_REWARD ||
    5
  );

const DAILY_REWARD_INTERVAL_MS =
  24 * 60 * 60 * 1000;


const MIN_WITHDRAWAL =
  Number(process.env.MIN_WITHDRAWAL || 1);

const REQUIRED_REFERRALS =
  Number(process.env.REQUIRED_REFERRALS || 0);

const REFERRAL_REWARD =
  Number(process.env.REFERRAL_REWARD || 3);

const USDT_DECIMALS =
  Number(process.env.USDT_DECIMALS || 6);


const DEPOSIT_ADDRESS =
  process.env.DEPOSIT_ADDRESS ||
  "TAmkXMpkcqSZmG9oRvtXfBvpLWr53wXEdx";


const USDT_CONTRACT =
  process.env.USDT_CONTRACT ||
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";


const WITHDRAWAL_SOURCE_ADDRESS =
  process.env.WITHDRAWAL_SOURCE_ADDRESS || "";


const ADMIN_TELEGRAM_IDS =
  String(process.env.ADMIN_TELEGRAM_IDS || "")
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);


/* =========================================================
   CORS
========================================================= */

app.use(cors({
  origin: function(origin, callback) {

    if (!origin) {
      return callback(null, true);
    }

    const allowed = [
      ALLOWED_ORIGIN,
      "https://sansjgj7-ctrl.github.io",
      "http://localhost:3000",
      "http://localhost:5173"
    ];

    if (allowed.includes(origin)) {
      return callback(null, true);
    }

    return callback(null, false);
  },

  methods: [
    "GET",
    "POST",
    "PUT",
    "DELETE",
    "OPTIONS"
  ],

  allowedHeaders: [
    "Content-Type",
    "X-Telegram-Init-Data"
  ]
}));


app.use(
  express.json({
    limit: "2mb"
  })
);


/* =========================================================
   LOCAL DATABASE
========================================================= */

const DATA_DIR =
  path.join(__dirname, "data");

const DATA_FILE =
  path.join(DATA_DIR, "big-money-data.json");


if (!fs.existsSync(DATA_DIR)) {

  fs.mkdirSync(
    DATA_DIR,
    {
      recursive: true
    }
  );
}


function emptyStore() {

  return {
    users: {},
    deposits: [],
    withdrawals: [],
    referrals: []
  };
}


function loadLocalStore() {

  try {

    if (!fs.existsSync(DATA_FILE)) {
      return emptyStore();
    }

    const raw =
      fs.readFileSync(
        DATA_FILE,
        "utf8"
      );

    if (!raw.trim()) {
      return emptyStore();
    }

    const parsed =
      JSON.parse(raw);

    return {

      users:
        parsed.users || {},

      deposits:
        Array.isArray(parsed.deposits)
          ? parsed.deposits
          : [],

      withdrawals:
        Array.isArray(parsed.withdrawals)
          ? parsed.withdrawals
          : [],

      referrals:
        Array.isArray(parsed.referrals)
          ? parsed.referrals
          : []
    };

  } catch (error) {

    console.error(
      "LOCAL DB LOAD ERROR:",
      error.message
    );

    return emptyStore();
  }
}


let store =
  loadLocalStore();


let storeLock =
  Promise.resolve();


function saveLocalStore() {

  storeLock =
    storeLock.then(
      async () => {

        const tempFile =
          DATA_FILE + ".tmp";


        fs.writeFileSync(
          tempFile,
          JSON.stringify(
            store,
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
    ).catch(
      error => {

        console.error(
          "LOCAL DB SAVE ERROR:",
          error.message
        );
      }
    );

  return storeLock;
}


/* =========================================================
   SUPABASE OPTIONAL STORAGE
========================================================= */

const SUPABASE_URL =
  process.env.SUPABASE_URL || "";

const SUPABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY || "";

const SUPABASE_TABLE =
  process.env.SUPABASE_TABLE ||
  "big_money_store";


async function supabaseRequest(
  method,
  endpoint,
  body = null,
  extraHeaders = {}
) {

  if (
    !SUPABASE_URL ||
    !SUPABASE_SECRET_KEY
  ) {
    return null;
  }

  try {

    const headers = {

      "apikey":
        SUPABASE_SECRET_KEY,

      "Authorization":
        `Bearer ${SUPABASE_SECRET_KEY}`,

      "Content-Type":
        "application/json",

      ...extraHeaders
    };


    const response =
      await fetch(
        `${SUPABASE_URL}${endpoint}`,
        {
          method,
          headers,

          body:
            body === null
              ? undefined
              : JSON.stringify(body)
        }
      );


    const text =
      await response.text();


    let data = null;


    try {

      data =
        text
          ? JSON.parse(text)
          : null;

    } catch {

      data = text;
    }


    if (!response.ok) {

      console.error(
        "SUPABASE ERROR:",
        response.status,
        data
      );

      return null;
    }


    return data;

  } catch (error) {

    console.error(
      "SUPABASE REQUEST ERROR:",
      error.message
    );

    return null;
  }
}


async function loadFromSupabase() {

  if (
    !SUPABASE_URL ||
    !SUPABASE_SECRET_KEY
  ) {
    return;
  }


  try {

    const data =
      await supabaseRequest(
        "GET",
        `/rest/v1/${SUPABASE_TABLE}?select=*`
      );


    if (
      !Array.isArray(data) ||
      data.length === 0
    ) {
      return;
    }


    const row =
      data[0];


    if (row && row.store_data) {

      let remoteStore =
        row.store_data;


      if (
        typeof remoteStore ===
        "string"
      ) {

        try {

          remoteStore =
            JSON.parse(
              remoteStore
            );

        } catch {}
      }


      if (
        remoteStore &&
        typeof remoteStore ===
        "object"
      ) {

        store = {

          users:
            remoteStore.users || {},

          deposits:
            Array.isArray(
              remoteStore.deposits
            )
              ? remoteStore.deposits
              : [],

          withdrawals:
            Array.isArray(
              remoteStore.withdrawals
            )
              ? remoteStore.withdrawals
              : [],

          referrals:
            Array.isArray(
              remoteStore.referrals
            )
              ? remoteStore.referrals
              : []
        };


        await saveLocalStore();


        console.log(
          "Supabase store loaded."
        );
      }
    }

  } catch (error) {

    console.error(
      "SUPABASE LOAD ERROR:",
      error.message
    );
  }
}


async function saveToSupabase() {

  if (
    !SUPABASE_URL ||
    !SUPABASE_SECRET_KEY
  ) {
    return;
  }


  const body = {
    store_data: store
  };


  try {

    const existing =
      await supabaseRequest(
        "GET",
        `/rest/v1/${SUPABASE_TABLE}?select=id&limit=1`
      );


    if (
      Array.isArray(existing) &&
      existing.length > 0
    ) {

      await supabaseRequest(
        "PATCH",
        `/rest/v1/${SUPABASE_TABLE}?id=eq.${existing[0].id}`,
        body,
        {
          "Prefer":
            "return=minimal"
        }
      );

    } else {

      await supabaseRequest(
        "POST",
        `/rest/v1/${SUPABASE_TABLE}`,
        body,
        {
          "Prefer":
            "return=minimal"
        }
      );
    }

  } catch (error) {

    console.error(
      "SUPABASE SAVE ERROR:",
      error.message
    );
  }
}


async function saveStore() {

  await saveLocalStore();

  await saveToSupabase();
}


/* =========================================================
   HELPERS
========================================================= */

function nowIso() {

  return new Date().toISOString();
}


function makeId(
  prefix = "id"
) {

  return (
    prefix +
    "_" +
    Date.now() +
    "_" +
    crypto
      .randomBytes(4)
      .toString("hex")
  );
}


function roundUsdt(value) {

  const factor =
    Math.pow(
      10,
      USDT_DECIMALS
    );


  return (
    Math.round(
      Number(value) *
      factor
    ) / factor
  );
}


function normalizeAddress(
  address
) {

  return String(
    address || ""
  )
    .trim()
    .toLowerCase();
}


function normalizeTxid(
  txid
) {

  return String(
    txid || ""
  )
    .trim();
}


function isValidTxid(
  txid
) {

  return /^[a-fA-F0-9]{64}$/.test(
    txid
  );
}


/* =========================================================
   TELEGRAM AUTH
========================================================= */

function parseTelegramInitData(
  initData
) {

  const params =
    new URLSearchParams(
      initData
    );


  const data = {};


  for (
    const [key, value]
    of params.entries()
  ) {

    data[key] = value;
  }


  return data;
}


function validateTelegramInitData(
  initData
) {

  if (!TELEGRAM_BOT_TOKEN) {

    return {
      ok: false,
      error:
        "TELEGRAM_BOT_TOKEN is not configured"
    };
  }


  if (!initData) {

    return {
      ok: false,
      error:
        "Missing Telegram init data"
    };
  }


  try {

    const params =
      new URLSearchParams(
        initData
      );


    const receivedHash =
      params.get("hash");


    if (!receivedHash) {

      return {
        ok: false,
        error:
          "Missing Telegram hash"
      };
    }


    params.delete("hash");


    const pairs = [];


    for (
      const [key, value]
      of params.entries()
    ) {

      pairs.push(
        `${key}=${value}`
      );
    }


    pairs.sort();


    const dataCheckString =
      pairs.join("\n");


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


    if (
      calculatedHash.length !==
      receivedHash.length
    ) {

      return {
        ok: false,
        error:
          "Invalid Telegram hash"
      };
    }


    if (
      !crypto.timingSafeEqual(
        Buffer.from(
          calculatedHash
        ),
        Buffer.from(
          receivedHash
        )
      )
    ) {

      return {
        ok: false,
        error:
          "Invalid Telegram authentication"
      };
    }


    const authDate =
      Number(
        params.get("auth_date") || 0
      );


    if (!authDate) {

      return {
        ok: false,
        error:
          "Missing auth_date"
      };
    }


    const age =
      Math.floor(
        Date.now() / 1000
      ) -
      authDate;


    if (
      age < 0 ||
      age >
      TELEGRAM_AUTH_MAX_AGE
    ) {

      return {
        ok: false,
        error:
          "Telegram authentication expired"
      };
    }


    let user = null;


    try {

      user =
        JSON.parse(
          params.get("user") ||
          "{}"
        );

    } catch {

      return {
        ok: false,
        error:
          "Invalid Telegram user data"
      };
    }


    if (
      !user ||
      !user.id
    ) {

      return {
        ok: false,
        error:
          "Telegram user not found"
      };
    }


    return {
      ok: true,
      user,
      data:
        parseTelegramInitData(
          initData
        )
    };

  } catch (error) {

    return {
      ok: false,
      error:
        error.message
    };
  }
}


/* =========================================================
   USER MANAGEMENT
========================================================= */

function getOrCreateUser(
  telegramUser,
  startParam = ""
) {

  const userId =
    String(
      telegramUser.id
    );


  let user =
    store.users[userId];


  if (!user) {

    user = {

      id: userId,

      telegramId:
        userId,

      username:
        telegramUser.username ||
        "",

      firstName:
        telegramUser.first_name ||
        "",

      lastName:
        telegramUser.last_name ||
        "",

      languageCode:
        telegramUser.language_code ||
        "",

      balance: 0,

      points: 0,

      referralCode:
        `ref_${userId}`,

      referredBy: null,

      referralCount: 0,

      createdAt:
        nowIso(),

      updatedAt:
        nowIso(),

      lastDailyRewardAt:
        null
    };


    store.users[userId] =
      user;

  } else {

    user.username =
      telegramUser.username ||
      user.username ||
      "";


    user.firstName =
      telegramUser.first_name ||
      user.firstName ||
      "";


    user.lastName =
      telegramUser.last_name ||
      user.lastName ||
      "";


    user.languageCode =
      telegramUser.language_code ||
      user.languageCode ||
      "";


    /*
      Make sure old users have
      balance field.
    */

    if (
      typeof user.balance !==
      "number"
    ) {

      user.balance =
        Number(
          user.balance || 0
        );
    }


    if (
      typeof user.points !==
      "number"
    ) {

      user.points =
        Number(
          user.points || 0
        );
    }


    if (
      typeof user.referralCount !==
      "number"
    ) {

      user.referralCount =
        Number(
          user.referralCount || 0
        );
    }


    user.updatedAt =
      nowIso();
  }


  processReferral(
    user,
    startParam
  );


  return user;
}


function processReferral(
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


  if (user.referredBy) {
    return;
  }


  if (
    code === user.referralCode
  ) {
    return;
  }


  const inviterId =
    code.substring(4);


  if (!inviterId) {
    return;
  }


  const inviter =
    store.users[inviterId];


  if (!inviter) {
    return;
  }


  const alreadyExists =
    store.referrals.some(
      r =>
        String(
          r.invitedUserId
        ) ===
        String(user.id)
    );


  if (alreadyExists) {
    return;
  }


  user.referredBy =
    inviter.id;


  inviter.referralCount =
    Number(
      inviter.referralCount || 0
    ) + 1;


  inviter.points =
    Number(
      inviter.points || 0
    ) +
    REFERRAL_REWARD;


  store.referrals.push({

    id:
      makeId("ref"),

    inviterId:
      inviter.id,

    invitedUserId:
      user.id,

    reward:
      REFERRAL_REWARD,

    createdAt:
      nowIso()
  });


  inviter.updatedAt =
    nowIso();

  user.updatedAt =
    nowIso();
}


/* =========================================================
   AUTH MIDDLEWARE
========================================================= */

function authMiddleware(
  req,
  res,
  next
) {

  const initData =
    req.header(
      "X-Telegram-Init-Data"
    ) ||
    req.body?.initData ||
    req.query?.initData ||
    "";


  const result =
    validateTelegramInitData(
      initData
    );


  if (!result.ok) {

    return res.status(401).json({

      ok: false,

      error:
        result.error
    });
  }


  req.telegramUser =
    result.user;


  req.telegramData =
    result.data;


  const startParam =
    result.data?.start_param ||
    result.data?.startapp ||
    "";


  req.user =
    getOrCreateUser(
      result.user,
      startParam
    );


  saveStore()
    .catch(() => {});


  next();
}


function adminMiddleware(
  req,
  res,
  next
) {

  const id =
    String(
      req.user?.id || ""
    );


  if (
    !ADMIN_TELEGRAM_IDS.includes(id)
  ) {

    return res.status(403).json({

      ok: false,

      error:
        "Admin access required"
    });
  }


  next();
}


/* =========================================================
   TRONGRID
========================================================= */

async function tronGridRequest(
  endpoint,
  options = {}
) {

  const headers = {

    "Accept":
      "application/json"
  };


  if (TRONGRID_API_KEY) {

    headers[
      "TRON-PRO-API-KEY"
    ] =
      TRONGRID_API_KEY;
  }


  if (options.body) {

    headers[
      "Content-Type"
    ] =
      "application/json";
  }


  const response =
    await fetch(
      `${TRONGRID_URL}${endpoint}`,
      {

        ...options,

        headers: {

          ...headers,

          ...(options.headers || {})
        }
      }
    );


  const text =
    await response.text();


  let data = null;


  try {

    data =
      text
        ? JSON.parse(text)
        : null;

  } catch {

    data = text;
  }


  if (!response.ok) {

    throw new Error(

      `TronGrid ${response.status}: ` +
      `${
        typeof data === "string"
          ? data
          : JSON.stringify(data)
      }`
    );
  }


  return data;
}


/* =========================================================
   GET CONFIRMED USDT TRANSFERS
========================================================= */

async function getConfirmedUsdtTransfers(
  txid
) {

  const endpoint =
    `/v1/transactions/${txid}/events` +
    `?only_confirmed=true&limit=200`;


  const data =
    await tronGridRequest(
      endpoint
    );


  const events =
    Array.isArray(data?.data)
      ? data.data
      : [];


  const transfers = [];


  for (
    const event
    of events
  ) {

    if (
      event?.event_name !==
      "Transfer"
    ) {
      continue;
    }


    const contract =
      event?.address ||
      event?.contract_address ||
      event?.result?.contract_address ||
      "";


    if (
      normalizeAddress(
        contract
      ) !==
      normalizeAddress(
        USDT_CONTRACT
      )
    ) {
      continue;
    }


    const result =
      event.result || {};


    const from =
      result.from ||
      event.from ||
      "";


    const to =
      result.to ||
      event.to ||
      "";


    let rawValue =
      result.value ??
      event.value ??
      0;


    if (
      typeof rawValue ===
        "string" &&
      rawValue.includes(".")
    ) {

      rawValue =
        Number(rawValue) *
        Math.pow(
          10,
          USDT_DECIMALS
        );
    }


    const numericRaw =
      Number(rawValue);


    if (
      !Number.isFinite(
        numericRaw
      ) ||
      numericRaw <= 0
    ) {
      continue;
    }


    const amount =
      numericRaw /
      Math.pow(
        10,
        USDT_DECIMALS
      );


    transfers.push({

      contract,

      from,

      to,

      rawValue:
        numericRaw,

      amount
    });
  }


  return transfers;
}


/* =========================================================
   VERIFY TXID
========================================================= */

async function verifyTransaction(
  txid
) {

  txid =
    normalizeTxid(
      txid
    );


  if (
    !isValidTxid(txid)
  ) {

    return {
      ok: false,
      error:
        "Invalid TXID"
    };
  }


  let transfers;


  try {

    transfers =
      await getConfirmedUsdtTransfers(
        txid
      );

  } catch (error) {

    console.error(
      "TRON VERIFY ERROR:",
      error.message
    );


    return {

      ok: false,

      error:
        "Could not read blockchain transaction"
    };
  }


  const matchingTransfers =
    transfers.filter(
      transfer =>
        normalizeAddress(
          transfer.to
        ) ===
        normalizeAddress(
          DEPOSIT_ADDRESS
        )
    );


  if (
    matchingTransfers.length ===
    0
  ) {

    return {

      ok: false,

      error:
        "No confirmed USDT transfer to the Big Money deposit address was found"
    };
  }


  const amount =
    roundUsdt(

      matchingTransfers.reduce(

        (sum, transfer) =>

          sum +
          Number(
            transfer.amount || 0
          ),

        0
      )
    );


  if (
    amount <
    MIN_DEPOSIT
  ) {

    return {

      ok: false,

      error:
        `Deposit amount is below minimum ${MIN_DEPOSIT} USDT`,

      amount
    };
  }


  return {

    ok: true,

    txid,

    amount,

    transfers:
      matchingTransfers
  };
}


/* =========================================================
   DEPOSIT TOTAL
========================================================= */

function getConfirmedDepositTotal(
  userId
) {

  return roundUsdt(

    store.deposits

      .filter(

        deposit =>

          String(
            deposit.userId
          ) ===
            String(userId) &&

          deposit.status ===
            "confirmed"
      )

      .reduce(

        (sum, deposit) =>

          sum +
          Number(
            deposit.amount || 0
          ),

        0
      )
  );
}


/* =========================================================
   DAILY REWARD
   5 USDT EVERY 24 HOURS
========================================================= */

function getDailyRewardStatus(
  user
) {

  const total =
    getConfirmedDepositTotal(
      user.id
    );


  const remaining =
    Math.max(

      0,

      roundUsdt(

        QUALIFYING_DEPOSIT -
        total
      )
    );


  if (
    total <
    QUALIFYING_DEPOSIT
  ) {

    return {

      qualified: false,

      claimed: false,

      canClaim: false,

      totalDeposited:
        total,

      qualifyingDeposit:
        QUALIFYING_DEPOSIT,

      remainingToQualify:
        remaining,

      reward:
        DAILY_REWARD_USDT,

      nextClaimAt:
        null,

      secondsRemaining:
        0
    };
  }


  const last =
    user.lastDailyRewardAt
      ? new Date(
          user.lastDailyRewardAt
        ).getTime()
      : 0;


  if (!last) {

    return {

      qualified: true,

      claimed: false,

      canClaim: true,

      totalDeposited:
        total,

      qualifyingDeposit:
        QUALIFYING_DEPOSIT,

      remainingToQualify:
        0,

      reward:
        DAILY_REWARD_USDT,

      nextClaimAt:
        null,

      secondsRemaining:
        0
    };
  }


  const next =
    last +
    DAILY_REWARD_INTERVAL_MS;


  const remainingMs =
    Math.max(
      0,
      next -
      Date.now()
    );


  return {

    qualified: true,

    claimed:
      remainingMs > 0,

    canClaim:
      remainingMs === 0,

    totalDeposited:
      total,

    qualifyingDeposit:
      QUALIFYING_DEPOSIT,

    remainingToQualify:
      0,

    reward:
      DAILY_REWARD_USDT,

    nextClaimAt:
      new Date(
        next
      ).toISOString(),

    secondsRemaining:
      Math.ceil(
        remainingMs / 1000
      )
  };
}


/* =========================================================
   ACCOUNT DATA
========================================================= */

function accountData(
  user
) {

  const totalDeposited =
    getConfirmedDepositTotal(
      user.id
    );


  const reward =
    getDailyRewardStatus(
      user
    );


  return {

    id:
      user.id,

    telegramId:
      user.telegramId,

    username:
      user.username || "",

    firstName:
      user.firstName || "",

    lastName:
      user.lastName || "",

    balance:
      roundUsdt(
        Number(
          user.balance || 0
        )
      ),

    points:
      Number(
        user.points || 0
      ),

    referralCode:
      user.referralCode,

    referralCount:
      Number(
        user.referralCount || 0
      ),

    referredBy:
      user.referredBy,

    totalDeposited:
      totalDeposited,

    qualifyingDeposit:
      QUALIFYING_DEPOSIT,

    remainingToQualify:
      reward.remainingToQualify,

    dailyReward:
      reward
  };
}


/* =========================================================
   ROOT / HEALTH
========================================================= */

app.get(
  "/",
  (req, res) => {

    res.json({

      ok: true,

      name:
        "Big Money Backend",

      network:
        "TRON TRC20",

      version:
        "deposit-5-usdt-v6",

      minDeposit:
        MIN_DEPOSIT,

      qualifyingDeposit:
        QUALIFYING_DEPOSIT,

      dailyReward:
        DAILY_REWARD_USDT,

      dailyRewardInterval:
        DAILY_REWARD_INTERVAL_MS
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
        "deposit-5-usdt-v6",

      minDeposit:
        MIN_DEPOSIT,

      qualifyingDeposit:
        QUALIFYING_DEPOSIT,

      dailyReward:
        DAILY_REWARD_USDT,

      dailyRewardInterval:
        DAILY_REWARD_INTERVAL_MS,

      depositAddress:
        DEPOSIT_ADDRESS,

      usdtContract:
        USDT_CONTRACT
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

      network:
        "TRON TRC20",

      minDeposit:
        MIN_DEPOSIT,

      qualifyingDeposit:
        QUALIFYING_DEPOSIT,

      dailyReward:
        DAILY_REWARD_USDT,

      dailyRewardInterval:
        DAILY_REWARD_INTERVAL_MS,

      minWithdrawal:
        MIN_WITHDRAWAL,

      requiredReferrals:
        REQUIRED_REFERRALS,

      referralReward:
        REFERRAL_REWARD,

      botUsername:
        TELEGRAM_BOT_USERNAME,

      decimals:
        USDT_DECIMALS
    });
  }
);


/* =========================================================
   ACCOUNT
   GET + POST
   IMPORTANT FOR BALANCE DISPLAY
========================================================= */

async function sendAccountResponse(
  req,
  res
) {

  try {

    const user =
      req.user;


    if (!user) {

      return res.status(401).json({

        ok: false,

        error:
          "User not authenticated"
      });
    }


    /*
      Make sure balance is always
      a valid number.
    */

    user.balance =
      roundUsdt(
        Number(
          user.balance || 0
        )
      );


    user.points =
      Number(
        user.points || 0
      );


    user.referralCount =
      Number(
        user.referralCount || 0
      );


    user.updatedAt =
      nowIso();


    await saveStore();


    const account =
      accountData(
        user
      );


    /*
      IMPORTANT:
      We return balance in TWO places.

      1. account.balance
      2. top-level balance

      This makes the backend compatible
      with different frontend versions.
    */

    return res.json({

      ok: true,

      account:

        account,

      balance:

        account.balance,

      points:

        account.points,

      referralCount:

        account.referralCount,

      successfulReferrals:

        Number(
          user.successfulReferrals || 0
        ),

      totalDeposited:

        account.totalDeposited,

      dailyReward:

        account.dailyReward
    });

  } catch (error) {

    console.error(
      "ACCOUNT ERROR:",
      error.message
    );


    return res.status(500).json({

      ok: false,

      error:
        "Could not load account"
    });
  }
}


/*
  GET account
*/

app.get(
  "/api/account",
  authMiddleware,
  sendAccountResponse
);


/*
  POST account

  This is important because
  older versions of your index.html
  use POST /api/account.
*/

app.post(
  "/api/account",
  authMiddleware,
  sendAccountResponse
);


/* =========================================================
   PROFILE
========================================================= */

app.get(
  "/api/profile",
  authMiddleware,
  (req, res) => {

    res.json({

      ok: true,

      profile: {

        telegramId:
          req.user.telegramId,

        username:
          req.user.username || "",

        firstName:
          req.user.firstName || "",

        lastName:
          req.user.lastName || "",

        referralCode:
          req.user.referralCode,

        referralLink:
          `https://t.me/${TELEGRAM_BOT_USERNAME}` +
          `?start=${req.user.referralCode}`,

        referralCount:
          req.user.referralCount || 0,

        points:
          req.user.points || 0
      }
    });
  }
);


/* =========================================================
   DAILY REWARD STATUS
========================================================= */

app.get(
  "/api/daily-reward",
  authMiddleware,
  (req, res) => {

    res.json({

      ok: true,

      ...getDailyRewardStatus(
        req.user
      )
    });
  }
);


/* =========================================================
   CLAIM DAILY REWARD
========================================================= */

app.post(
  "/api/daily-reward/claim",
  authMiddleware,
  async (req, res) => {

    const status =
      getDailyRewardStatus(
        req.user
      );


    if (
      !status.qualified
    ) {

      return res.status(400).json({

        ok: false,

        error:
          `You need at least ${QUALIFYING_DEPOSIT} USDT in confirmed deposits`,

        totalDeposited:
          status.totalDeposited,

        remainingToQualify:
          status.remainingToQualify
      });
    }


    if (
      !status.canClaim
    ) {

      return res.status(400).json({

        ok: false,

        error:
          "Daily reward is not ready yet",

        nextClaimAt:
          status.nextClaimAt,

        secondsRemaining:
          status.secondsRemaining
      });
    }


    /*
      Add 5 USDT
    */

    req.user.balance =
      roundUsdt(

        Number(
          req.user.balance || 0
        ) +

        DAILY_REWARD_USDT
      );


    req.user.lastDailyRewardAt =
      nowIso();


    req.user.updatedAt =
      nowIso();


    await saveStore();


    res.json({

      ok: true,

      message:
        `Daily reward +${DAILY_REWARD_USDT} USDT added`,

      reward:
        DAILY_REWARD_USDT,

      balance:
        roundUsdt(
          req.user.balance
        ),

      dailyReward:
        getDailyRewardStatus(
          req.user
        )
    });
  }
);


/* =========================================================
   DEPOSIT REQUEST
========================================================= */

app.post(
  "/api/deposits/request",
  authMiddleware,
  async (req, res) => {

    const requestedAmount =
      Number(
        req.body?.amount
      );


    if (
      !Number.isFinite(
        requestedAmount
      ) ||
      requestedAmount <
        MIN_DEPOSIT
    ) {

      return res.status(400).json({

        ok: false,

        error:
          `Minimum deposit is ${MIN_DEPOSIT} USDT`
      });
    }


    const deposit = {

      id:
        makeId("dep"),

      userId:
        req.user.id,

      amount:
        roundUsdt(
          requestedAmount
        ),

      requestedAmount:
        roundUsdt(
          requestedAmount
        ),

      txid:
        null,

      status:
        "pending",

      createdAt:
        nowIso(),

      updatedAt:
        nowIso()
    };


    store.deposits.push(
      deposit
    );


    await saveStore();


    res.json({

      ok: true,

      deposit: {

        id:
          deposit.id,

        amount:
          deposit.amount,

        status:
          deposit.status,

        depositAddress:
          DEPOSIT_ADDRESS
      }
    });
  }
);


/* =========================================================
   PROCESS CONFIRMED DEPOSIT
========================================================= */

async function processDeposit(
  user,
  txid,
  amount,
  blockchainData
) {

  txid =
    normalizeTxid(
      txid
    );


  amount =
    roundUsdt(
      amount
    );


  if (
    !txid ||
    !isValidTxid(txid)
  ) {

    return {

      ok: false,

      error:
        "Invalid TXID"
    };
  }


  if (
    !Number.isFinite(
      amount
    ) ||
    amount <
      MIN_DEPOSIT
  ) {

    return {

      ok: false,

      error:
        `Minimum deposit is ${MIN_DEPOSIT} USDT`
    };
  }


  /*
    Prevent same TXID from
    being credited twice.
  */

  const existing =
    store.deposits.find(

      deposit =>

        String(
          deposit.txid || ""
        ).toLowerCase() ===
        txid.toLowerCase()
    );


  if (existing) {

    if (
      String(
        existing.userId
      ) !==
      String(user.id)
    ) {

      return {

        ok: false,

        error:
          "This TXID has already been used"
      };
    }


    return {

      ok: true,

      alreadyProcessed:
        true,

      amount:
        roundUsdt(
          existing.amount
        ),

      balance:
        roundUsdt(
          user.balance
        ),

      deposit:
        existing
    };
  }


  /*
    Find pending deposit.
  */

  let deposit =
    store.deposits.find(

      d =>

        String(
          d.userId
        ) ===
          String(
            user.id
          ) &&

        d.status ===
          "pending" &&

        !d.txid
    );


  if (!deposit) {

    deposit = {

      id:
        makeId("dep"),

      userId:
        user.id,

      amount:
        0,

      requestedAmount:
        amount,

      txid:
        null,

      status:
        "pending",

      createdAt:
        nowIso(),

      updatedAt:
        nowIso()
    };


    store.deposits.push(
      deposit
    );
  }


  /*
    IMPORTANT:
    Use ACTUAL blockchain amount.
  */

  deposit.amount =
    amount;


  deposit.requestedAmount =
    deposit.requestedAmount ||
    amount;


  deposit.txid =
    txid;


  deposit.status =
    "confirmed";


  deposit.confirmedAt =
    nowIso();


  deposit.updatedAt =
    nowIso();


  deposit.blockchain =
    blockchainData ||
    null;


  /*
    ADD DEPOSIT TO BALANCE
  */

  user.balance =
    roundUsdt(

      Number(
        user.balance || 0
      ) +

      amount
    );


  user.updatedAt =
    nowIso();


  await saveStore();


  return {

    ok: true,

    alreadyProcessed:
      false,

    amount,

    balance:
      roundUsdt(
        user.balance
      ),

    deposit
  };
}


/* =========================================================
   VERIFY DEPOSIT BY TXID
========================================================= */

app.post(
  "/api/deposits/verify",
  authMiddleware,
  async (req, res) => {

    const txid =
      normalizeTxid(
        req.body?.txid
      );


    if (!txid) {

      return res.status(400).json({

        ok: false,

        error:
          "Please enter TXID"
      });
    }


    if (
      !isValidTxid(txid)
    ) {

      return res.status(400).json({

        ok: false,

        error:
          "TXID must contain 64 hexadecimal characters"
      });
    }


    const verification =
      await verifyTransaction(
        txid
      );


    if (!verification.ok) {

      return res.status(400).json({

        ok: false,

        error:
          verification.error,

        amount:
          verification.amount ||
          0
      });
    }


    const result =
      await processDeposit(

        req.user,

        txid,

        verification.amount,

        {

          transfers:
            verification.transfers,

          verifiedAt:
            nowIso()
        }
      );


    if (!result.ok) {

      return res.status(400).json({

        ok: false,

        error:
          result.error
      });
    }


    const rewardStatus =
      getDailyRewardStatus(
        req.user
      );


    res.json({

      ok: true,

      message:

        result.alreadyProcessed

          ? "This deposit was already processed"

          : "Deposit confirmed successfully",

      txid,

      amount:
        result.amount,

      balance:
        result.balance,

      totalDeposited:
        getConfirmedDepositTotal(
          req.user.id
        ),

      dailyReward:
        rewardStatus,

      deposit:
        result.deposit
    });
  }
);


/* =========================================================
   CHECK STORED DEPOSITS
========================================================= */

app.get(
  "/api/deposits/check",
  authMiddleware,
  (req, res) => {

    const deposits =
      store.deposits

        .filter(

          d =>

            String(
              d.userId
            ) ===
            String(
              req.user.id
            )
        )

        .sort(

          (a, b) =>

            new Date(
              b.createdAt
            ) -

            new Date(
              a.createdAt
            )
        );


    res.json({

      ok: true,

      deposits,

      totalDeposited:
        getConfirmedDepositTotal(
          req.user.id
        )
    });
  }
);


/* =========================================================
   TRANSACTIONS
========================================================= */

app.get(
  "/api/transactions",
  authMiddleware,
  (req, res) => {

    const deposits =
      store.deposits

        .filter(

          d =>

            String(
              d.userId
            ) ===
            String(
              req.user.id
            )
        )

        .map(
          d => ({

            type:
              "deposit",

            amount:
              Number(
                d.amount || 0
              ),

            status:
              d.status,

            txid:
              d.txid,

            createdAt:
              d.createdAt,

            confirmedAt:
              d.confirmedAt ||
              null
          })
        );


    const withdrawals =
      store.withdrawals

        .filter(

          w =>

            String(
              w.userId
            ) ===
            String(
              req.user.id
            )
        )

        .map(

          w => ({

            type:
              "withdrawal",

            amount:
              Number(
                w.amount || 0
              ),

            status:
              w.status,

            address:
              w.address,

            txid:
              w.txid ||
              null,

            createdAt:
              w.createdAt,

            completedAt:
              w.completedAt ||
              null
          })
        );


    const transactions = [

      ...deposits,

      ...withdrawals

    ].sort(

      (a, b) =>

        new Date(
          b.createdAt
        ) -

        new Date(
          a.createdAt
        )
    );


    res.json({

      ok: true,

      transactions
    });
  }
);


/* =========================================================
   WITHDRAWAL
========================================================= */

app.post(
  "/api/withdrawals/request",
  authMiddleware,
  async (req, res) => {

    const amount =
      roundUsdt(
        Number(
          req.body?.amount
        )
      );


    const address =
      String(
        req.body?.address || ""
      ).trim();


    if (
      !Number.isFinite(
        amount
      ) ||
      amount <
        MIN_WITHDRAWAL
    ) {

      return res.status(400).json({

        ok: false,

        error:
          `Minimum withdrawal is ${MIN_WITHDRAWAL} USDT`
      });
    }


    if (!address) {

      return res.status(400).json({

        ok: false,

        error:
          "Withdrawal address is required"
      });
    }


    if (
      Number(
        req.user.balance || 0
      ) <
      amount
    ) {

      return res.status(400).json({

        ok: false,

        error:
          "Insufficient balance"
      });
    }


    /*
      Reserve balance.
    */

    req.user.balance =
      roundUsdt(

        Number(
          req.user.balance
        ) -

        amount
      );


    req.user.updatedAt =
      nowIso();


    const withdrawal = {

      id:
        makeId("wd"),

      userId:
        req.user.id,

      amount,

      address,

      status:
        "pending",

      txid:
        null,

      createdAt:
        nowIso(),

      updatedAt:
        nowIso()
    };


    store.withdrawals.push(
      withdrawal
    );


    await saveStore();


    res.json({

      ok: true,

      message:
        "Withdrawal request created",

      withdrawal,

      balance:
        roundUsdt(
          req.user.balance
        )
    });
  }
);


/* =========================================================
   ADMIN USERS
========================================================= */

app.get(
  "/api/admin/users",
  authMiddleware,
  adminMiddleware,
  (req, res) => {

    res.json({

      ok: true,

      users:
        Object.values(
          store.users
        )
    });
  }
);


/* =========================================================
   ADMIN DEPOSITS
========================================================= */

app.get(
  "/api/admin/deposits",
  authMiddleware,
  adminMiddleware,
  (req, res) => {

    res.json({

      ok: true,

      deposits:
        store.deposits
    });
  }
);


/* =========================================================
   ADMIN WITHDRAWALS
========================================================= */

app.get(
  "/api/admin/withdrawals",
  authMiddleware,
  adminMiddleware,
  (req, res) => {

    res.json({

      ok: true,

      withdrawals:
        store.withdrawals
    });
  }
);


/* =========================================================
   ADMIN COMPLETE WITHDRAWAL
========================================================= */

app.post(
  "/api/admin/withdrawals/complete",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {

    const id =
      String(
        req.body?.id || ""
      );


    const txid =
      String(
        req.body?.txid || ""
      ).trim();


    const withdrawal =
      store.withdrawals.find(
        w =>
          w.id === id
      );


    if (!withdrawal) {

      return res.status(404).json({

        ok: false,

        error:
          "Withdrawal not found"
      });
    }


    withdrawal.status =
      "completed";


    withdrawal.txid =
      txid || null;


    withdrawal.completedAt =
      nowIso();


    withdrawal.updatedAt =
      nowIso();


    await saveStore();


    res.json({

      ok: true,

      withdrawal
    });
  }
);


/* =========================================================
   ADMIN REJECT WITHDRAWAL
========================================================= */

app.post(
  "/api/admin/withdrawals/reject",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {

    const id =
      String(
        req.body?.id || ""
      );


    const withdrawal =
      store.withdrawals.find(
        w =>
          w.id === id
      );


    if (!withdrawal) {

      return res.status(404).json({

        ok: false,

        error:
          "Withdrawal not found"
      });
    }


    /*
      Return reserved balance
      when pending withdrawal
      is rejected.
    */

    if (
      withdrawal.status ===
      "pending"
    ) {

      const user =
        store.users[
          String(
            withdrawal.userId
          )
        ];


      if (user) {

        user.balance =
          roundUsdt(

            Number(
              user.balance || 0
            ) +

            Number(
              withdrawal.amount ||
              0
            )
          );


        user.updatedAt =
          nowIso();
      }
    }


    withdrawal.status =
      "rejected";


    withdrawal.updatedAt =
      nowIso();


    withdrawal.rejectedAt =
      nowIso();


    await saveStore();


    res.json({

      ok: true,

      withdrawal
    });
  }
);


/* =========================================================
   BACKGROUND DEPOSIT SCANNER
========================================================= */

async function scanPendingDeposits() {

  const pending =
    store.deposits.filter(

      d =>

        d.status ===
          "pending" &&

        d.txid
    );


  if (
    !pending.length
  ) {
    return;
  }


  console.log(

    `Checking ${pending.length} pending deposits...`
  );


  for (
    const deposit
    of pending
  ) {

    try {

      const verification =
        await verifyTransaction(
          deposit.txid
        );


      if (
        !verification.ok
      ) {
        continue;
      }


      const user =
        store.users[
          String(
            deposit.userId
          )
        ];


      if (!user) {
        continue;
      }


      await processDeposit(

        user,

        deposit.txid,

        verification.amount,

        {

          transfers:
            verification.transfers,

          scanner:
            true,

          verifiedAt:
            nowIso()
        }
      );


      console.log(

        "Pending deposit confirmed:",

        deposit.txid,

        verification.amount
      );

    } catch (error) {

      console.error(

        "SCANNER ERROR:",

        error.message
      );
    }
  }
}


/* =========================================================
   START SERVER
========================================================= */

async function startServer() {

  await loadFromSupabase();


  app.listen(

    PORT,

    () => {

      console.log(
        "======================================"
      );


      console.log(
        "BIG MONEY BACKEND STARTED"
      );


      console.log(
        `PORT: ${PORT}`
      );


      console.log(
        "NETWORK: TRON TRC20"
      );


      console.log(
        `DEPOSIT ADDRESS: ${DEPOSIT_ADDRESS}`
      );


      console.log(
        `USDT CONTRACT: ${USDT_CONTRACT}`
      );


      console.log(
        `MIN DEPOSIT: ${MIN_DEPOSIT} USDT`
      );


      console.log(
        `QUALIFYING DEPOSIT: ${QUALIFYING_DEPOSIT} USDT`
      );


      console.log(
        `DAILY REWARD: ${DAILY_REWARD_USDT} USDT`
      );


      console.log(
        "DAILY REWARD INTERVAL: 24 HOURS"
      );


      console.log(

        `SUPABASE: ${
          SUPABASE_URL
            ? "ENABLED"
            : "DISABLED"
        }`
      );


      console.log(
        "======================================"
      );
    }
  );


  /*
    Check pending TXID deposits
    every 15 seconds.
  */

  setInterval(

    () => {

      scanPendingDeposits()
        .catch(
          error => {

            console.error(
              "SCANNER:",
              error.message
            );
          }
        );

    },

    15000
  );
}


startServer();
