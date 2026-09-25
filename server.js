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
    n <= 100000000
  );
}

function toBaseUnits(amount) {

  const str =
    String(amount).trim();

  if (!/^\d+(\.\d{1,6})?$/.test(str)) {
    throw new Error(
      "Invalid USDT amount"
    );
  }

  const parts = str.split(".");

  const whole = parts[0];

  const decimal =
    (parts[1] || "")
      .padEnd(6, "0");

  return (
    BigInt(whole) * 1000000n +
    BigInt(decimal)
  ).toString();
}

function fromBaseUnits(value) {

  const raw =
    BigInt(String(value));

  const whole =
    raw / 1000000n;

  const decimal =
    raw % 1000000n;

  return (
    whole.toString() +
    "." +
    decimal
      .toString()
      .padStart(6, "0")
  ).replace(
    /\.?0+$/,
    ""
  );
}

function isValidTronAddress(address) {

  return (
    typeof address === "string" &&
    /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(
      address
    )
  );
}

function normalizeAddress(address) {
  return String(address || "")
    .trim();
}


/* =========================================================
   USER
========================================================= */

function getUser(store, telegramUser) {

  const telegramUserId =
    String(telegramUser.id);

  let user =
    store.users[telegramUserId];

  if (!user) {

    user = {
      telegramUserId,

      username:
        telegramUser.username || "",

      firstName:
        telegramUser.first_name || "",

      lastName:
        telegramUser.last_name || "",

      balance: 0,

      points: 0,

      referralCode:
        "ref_" +
        telegramUserId,

      referredBy: "",

      referralCount: 0,

      createdAt: nowISO(),

      updatedAt: nowISO()
    };

    store.users[telegramUserId] =
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

    user.updatedAt =
      nowISO();
  }

  return user;
}


/* =========================================================
   TELEGRAM INIT DATA
========================================================= */

function validateTelegramInitData(initData) {

  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN is not configured"
    );
  }

  if (
    !initData ||
    typeof initData !== "string"
  ) {
    throw new Error(
      "Telegram initData is missing"
    );
  }

  const params =
    new URLSearchParams(initData);

  const hash =
    params.get("hash");

  if (!hash) {
    throw new Error(
      "Telegram hash is missing"
    );
  }

  params.delete("hash");

  const dataCheckString =
    Array.from(params.entries())
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
    hash.length
  ) {
    throw new Error(
      "Invalid Telegram hash"
    );
  }

  if (
    !crypto.timingSafeEqual(
      Buffer.from(calculatedHash),
      Buffer.from(hash)
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
    !Number.isFinite(authDate)
  ) {
    throw new Error(
      "Invalid auth_date"
    );
  }

  const age =
    Math.floor(
      Date.now() / 1000
    ) - authDate;

  if (
    age < 0 ||
    age > TELEGRAM_AUTH_MAX_AGE
  ) {
    throw new Error(
      "Telegram initData expired"
    );
  }

  const userRaw =
    params.get("user");

  if (!userRaw) {
    throw new Error(
      "Telegram user missing"
    );
  }

  let user;

  try {
    user =
      JSON.parse(userRaw);
  } catch {
    throw new Error(
      "Invalid Telegram user"
    );
  }

  return {
    user,
    startParam:
      params.get("start_param") || ""
  };
}


/* =========================================================
   TELEGRAM AUTH
========================================================= */

function getInitDataFromRequest(req) {

  return (
    req.headers[
      "x-telegram-init-data"
    ] ||
    req.body?.initData ||
    ""
  );
}

function requireTelegram(req, res, next) {

  try {

    const initData =
      getInitDataFromRequest(req);

    const result =
      validateTelegramInitData(
        initData
      );

    req.telegramUser =
      result.user;

    req.startParam =
      result.startParam;

    next();

  } catch (err) {

    return res.status(401).json({
      ok: false,
      error: err.message
    });
  }
}

function requireAdmin(req, res, next) {

  try {

    const initData =
      getInitDataFromRequest(req);

    const result =
      validateTelegramInitData(
        initData
      );

    const id =
      String(result.user.id);

    if (
      !ADMIN_TELEGRAM_IDS.includes(id)
    ) {
      return res.status(403).json({
        ok: false,
        error: "Admin access required"
      });
    }

    req.telegramUser =
      result.user;

    req.startParam =
      result.startParam;

    next();

  } catch (err) {

    return res.status(401).json({
      ok: false,
      error: err.message
    });
  }
}


/* =========================================================
   TRONGRID
========================================================= */

async function tronRequest(
  endpoint,
  options = {}
) {

  const headers = {
    "Accept": "application/json",
    ...(options.headers || {})
  };

  if (TRONGRID_API_KEY) {
    headers[
      "TRON-PRO-API-KEY"
    ] = TRONGRID_API_KEY;
  }

  const response =
    await fetch(
      TRONGRID_URL + endpoint,
      {
        ...options,
        headers
      }
    );

  const text =
    await response.text();

  let data;

  try {
    data =
      text ? JSON.parse(text) : {};
  } catch {
    data = {
      raw: text
    };
  }

  if (!response.ok) {

    throw new Error(
      `TronGrid error ${response.status}: ` +
      JSON.stringify(data)
    );
  }

  return data;
}


/* =========================================================
   GET INCOMING USDT TRC20 TRANSFERS
========================================================= */

async function getIncomingUSDTTransfers(
  minTimestamp = 0
) {

  const params =
    new URLSearchParams();

  params.set(
    "only_confirmed",
    "true"
  );

  params.set(
    "limit",
    "200"
  );

  params.set(
    "order_by",
    "block_timestamp,desc"
  );

  params.set(
    "contract_address",
    USDT_CONTRACT
  );

  params.set(
    "only_to",
    "true"
  );

  if (minTimestamp > 0) {
    params.set(
      "min_timestamp",
      String(minTimestamp)
    );
  }

  const endpoint =
    `/v1/accounts/${encodeURIComponent(
      DEPOSIT_ADDRESS
    )}/transactions/trc20?${params.toString()}`;

  const data =
    await tronRequest(endpoint);

  return Array.isArray(data.data)
    ? data.data
    : [];
}


/* =========================================================
   VERIFY TRANSACTION
========================================================= */

async function getSolidifiedTransaction(
  txid
) {

  return await tronRequest(
    `/walletsolidity/gettransactionbyid?value=${encodeURIComponent(
      txid
    )}`
  );
}

async function getSolidifiedTransactionInfo(
  txid
) {

  return await tronRequest(
    `/walletsolidity/gettransactioninfobyid?value=${encodeURIComponent(
      txid
    )}`
  );
}

async function verifyTransferSuccess(
  txid
) {

  const info =
    await getSolidifiedTransactionInfo(
      txid
    );

  if (
    info &&
    info.receipt &&
    info.receipt.result &&
    info.receipt.result !== "SUCCESS"
  ) {
    throw new Error(
      "Blockchain transaction failed"
    );
  }

  return true;
}


/* =========================================================
   AUTO DEPOSIT MATCH
========================================================= */

function transferContract(
  transfer
) {

  return (
    transfer?.token_info?.address ||
    transfer?.contract_address ||
    ""
  );
}

function transferValue(
  transfer
) {

  return String(
    transfer?.value ?? ""
  );
}

function transferTo(
  transfer
) {

  return normalizeAddress(
    transfer?.to
  );
}

function transferFrom(
  transfer
) {

  return normalizeAddress(
    transfer?.from
  );
}

function transferTxid(
  transfer
) {

  return (
    transfer?.transaction_id ||
    transfer?.txID ||
    ""
  );
}


/* =========================================================
   CREATE UNIQUE PAYMENT AMOUNT
========================================================= */

function createUniquePaymentAmount(
  store,
  requestedAmountBase
) {

  const requested =
    BigInt(
      requestedAmountBase
    );

  for (let i = 0; i < 500; i++) {

    /*
      Extra 1..999 micro-USDT.

      Example:
      5 USDT
      becomes:
      5.000137 USDT
    */

    const randomExtra =
      BigInt(
        crypto.randomInt(
          1,
          1000
        )
      );

    const payment =
      requested +
      randomExtra;

    const paymentString =
      payment.toString();

    let used = false;

    for (
      const id in store.pendingDeposits
    ) {

      const p =
        store.pendingDeposits[id];

      if (
        p.status === "pending" &&
        String(
          p.paymentAmountBase
        ) === paymentString
      ) {
        used = true;
        break;
      }
    }

    if (!used) {
      return paymentString;
    }
  }

  throw new Error(
    "Could not create unique payment amount"
  );
}


/* =========================================================
   PROCESS ONE TRANSFER
========================================================= */

async function processIncomingTransfer(
  transfer
) {

  const txid =
    transferTxid(transfer);

  if (!txid) {
    return false;
  }

  const to =
    transferTo(transfer);

  if (
    to !== DEPOSIT_ADDRESS
  ) {
    return false;
  }

  const contract =
    transferContract(transfer);

  if (
    contract &&
    contract !== USDT_CONTRACT
  ) {
    return false;
  }

  const value =
    transferValue(transfer);

  if (!/^\d+$/.test(value)) {
    return false;
  }

  const success =
    transfer.success;

  if (
    success === false
  ) {
    return false;
  }

  const blockTimestamp =
    Number(
      transfer.block_timestamp || 0
    );

  /*
    Find matching pending payment.
  */

  return await withStoreLock(
    async () => {

      const store =
        readStore();

      /*
        Already credited?
      */

      if (
        store.deposits[txid]
      ) {
        return false;
      }

      let matched = null;

      for (
        const id in store.pendingDeposits
      ) {

        const pending =
          store.pendingDeposits[id];

        if (
          pending.status !==
          "pending"
        ) {
          continue;
        }

        if (
          String(
            pending.paymentAmountBase
          ) !== value
        ) {
          continue;
        }

        const created =
          new Date(
            pending.createdAt
          ).getTime();

        /*
          Don't match an old transfer
          from before the request.
          10-minute safety window.
        */

        if (
          blockTimestamp &&
          blockTimestamp <
          created - 10 * 60 * 1000
        ) {
          continue;
        }

        matched = pending;
        break;
      }

      if (!matched) {
        return false;
      }

      /*
        Extra blockchain confirmation check.
      */

      try {
        await verifyTransferSuccess(
          txid
        );
      } catch (err) {

        console.error(
          "Transfer verification failed:",
          err.message
        );

        return false;
      }

      const amount =
        fromBaseUnits(value);

      const telegramUserId =
        String(
          matched.telegramUserId
        );

      const user =
        store.users[
          telegramUserId
        ];

      if (!user) {
        console.error(
          "User not found:",
          telegramUserId
        );

        return false;
      }

      /*
        Credit exactly once.
      */

      user.balance =
        Number(user.balance || 0) +
        Number(amount);

      user.updatedAt =
        nowISO();

      const deposit = {
        id:
          generateId("dep"),

        txid,

        telegramUserId,

        from:
          transferFrom(transfer),

        to:
          DEPOSIT_ADDRESS,

        amount,

        amountBase:
          value,

        requestedAmount:
          matched.requestedAmount,

        requestedAmountBase:
          matched.requestedAmountBase,

        paymentAmount:
          matched.paymentAmount,

        paymentAmountBase:
          matched.paymentAmountBase,

        status:
          "confirmed",

        createdAt:
          matched.createdAt,

        confirmedAt:
          nowISO(),

        blockTimestamp
      };

      store.deposits[txid] =
        deposit;

      matched.status =
        "confirmed";

      matched.txid =
        txid;

      matched.from =
        transferFrom(transfer);

      matched.confirmedAt =
        nowISO();

      matched.updatedAt =
        nowISO();

      writeStore(store);

      console.log(
        "AUTO DEPOSIT CONFIRMED:",
        JSON.stringify(
          deposit
        )
      );

      return true;
    }
  );
}


/* =========================================================
   AUTOMATIC BLOCKCHAIN SCANNER
========================================================= */

let autoScanRunning = false;

async function autoScanDeposits() {

  if (autoScanRunning) {
    return;
  }

  autoScanRunning = true;

  try {

    const store =
      readStore();

    const pending =
      Object.values(
        store.pendingDeposits
      ).filter(
        p => p.status === "pending"
      );

    if (
      pending.length === 0
    ) {
      return;
    }

    let oldest =
      Date.now();

    for (
      const p of pending
    ) {

      const t =
        new Date(
          p.createdAt
        ).getTime();

      if (
        Number.isFinite(t) &&
        t < oldest
      ) {
        oldest = t;
      }
    }

    /*
      Scan from 10 minutes before
      oldest request.
    */

    const minTimestamp =
      Math.max(
        0,
        oldest - 10 * 60 * 1000
      );

    const transfers =
      await getIncomingUSDTTransfers(
        minTimestamp
      );

    for (
      const transfer of transfers
    ) {

      try {

        await processIncomingTransfer(
          transfer
        );

      } catch (err) {

        console.error(
          "Deposit processing error:",
          err.message
        );
      }
    }

  } catch (err) {

    console.error(
      "AUTO SCAN ERROR:",
      err.message
    );

  } finally {

    autoScanRunning = false;
  }
}


/* =========================================================
   REFERRALS
========================================================= */

function processReferral(
  store,
  newUser,
  startParam
) {

  if (!startParam) {
    return;
  }

  if (
    newUser.referredBy
  ) {
    return;
  }

  if (
    !startParam.startsWith("ref_")
  ) {
    return;
  }

  const inviterId =
    startParam.substring(4);

  if (
    !inviterId ||
    inviterId ===
    String(newUser.telegramUserId)
  ) {
    return;
  }

  const inviter =
    store.users[inviterId];

  if (!inviter) {
    return;
  }

  newUser.referredBy =
    inviterId;

  inviter.points =
    Number(inviter.points || 0) +
    REFERRAL_POINTS;

  inviter.referralCount =
    Number(
      inviter.referralCount || 0
    ) + 1;

  store.referrals[
    generateId("ref")
  ] = {
    inviterTelegramUserId:
      inviterId,

    invitedTelegramUserId:
      String(
        newUser.telegramUserId
      ),

    points:
      REFERRAL_POINTS,

    createdAt:
      nowISO()
  };
}


/* =========================================================
   ROOT
========================================================= */

app.get("/", (req, res) => {

  res.json({
    ok: true,
    app: "Big Money",
    status: "online",
    time: nowISO()
  });

});


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

      decimals:
        USDT_DECIMALS,

      minWithdrawal:
        MIN_WITHDRAWAL,

      telegramBotUsername:
        TELEGRAM_BOT_USERNAME
    });

  }
);


/* =========================================================
   ACCOUNT
========================================================= */

app.post(
  "/api/account",
  requireTelegram,
  async (req, res) => {

    try {

      const result =
        await withStoreLock(
          async () => {

            const store =
              readStore();

            const user =
              getUser(
                store,
                req.telegramUser
              );

            processReferral(
              store,
              user,
              req.startParam
            );

            user.updatedAt =
              nowISO();

            writeStore(store);

            return user;
          }
        );

      res.json({
        ok: true,
        user: result
      });

    } catch (err) {

      console.error(err);

      res.status(500).json({
        ok: false,
        error:
          "Account error"
      });
    }
  }
);


/* =========================================================
   REFERRAL
========================================================= */

app.post(
  "/api/referral",
  requireTelegram,
  async (req, res) => {

    try {

      const result =
        await withStoreLock(
          async () => {

            const store =
              readStore();

            const user =
              getUser(
                store,
                req.telegramUser
              );

            writeStore(store);

            return user;
          }
        );

      const referralLink =
        `https://t.me/${TELEGRAM_BOT_USERNAME}?start=ref_${result.telegramUserId}`;

      res.json({
        ok: true,

        referralCode:
          result.referralCode,

        referralLink,

        referralCount:
          result.referralCount || 0,

        points:
          result.points || 0
      });

    } catch (err) {

      res.status(500).json({
        ok: false,
        error:
          "Referral error"
      });
    }
  }
);


/* =========================================================
   CREATE DEPOSIT REQUEST
========================================================= */

app.post(
  "/api/deposits/request",
  requireTelegram,
  async (req, res) => {

    try {

      const amount =
        String(
          req.body?.amount || ""
        ).trim();

      if (
        !isValidAmount(amount)
      ) {

        return res.status(400).json({
          ok: false,
          error:
            "Invalid deposit amount"
        });
      }

      const requestedAmountBase =
        toBaseUnits(amount);

      const result =
        await withStoreLock(
          async () => {

            const store =
              readStore();

            const user =
              getUser(
                store,
                req.telegramUser
              );

            const paymentAmountBase =
              createUniquePaymentAmount(
                store,
                requestedAmountBase
              );

            const paymentAmount =
              fromBaseUnits(
                paymentAmountBase
              );

            const depositId =
              generateId("pending");

            const pending = {

              id:
                depositId,

              telegramUserId:
                String(
                  user.telegramUserId
                ),

              requestedAmount:
                fromBaseUnits(
                  requestedAmountBase
                ),

              requestedAmountBase,

              paymentAmount,

              paymentAmountBase,

              depositAddress:
                DEPOSIT_ADDRESS,

              status:
                "pending",

              txid: "",

              from: "",

              to:
                DEPOSIT_ADDRESS,

              createdAt:
                nowISO(),

              updatedAt:
                nowISO()
            };

            store.pendingDeposits[
              depositId
            ] = pending;

            writeStore(store);

            return pending;
          }
        );

      res.json({
        ok: true,

        deposit: result,

        message:
          `Send exactly ${result.paymentAmount} USDT TRC20 to the deposit address.`
      });

    } catch (err) {

      console.error(
        "Deposit request error:",
        err
      );

      res.status(500).json({
        ok: false,
        error:
          err.message ||
          "Could not create deposit request"
      });
    }
  }
);


/* =========================================================
   CHECK DEPOSIT AUTOMATICALLY
========================================================= */

app.post(
  "/api/deposits/check",
  requireTelegram,
  async (req, res) => {

    try {

      const depositId =
        String(
          req.body?.depositId || ""
        ).trim();

      const telegramUserId =
        String(
          req.telegramUser.id
        );

      const before =
        readStore();

      let pending = null;

      if (depositId) {

        pending =
          before.pendingDeposits[
            depositId
          ];

      } else {

        const list =
          Object.values(
            before.pendingDeposits
          )
          .filter(
            p =>
              String(
                p.telegramUserId
              ) === telegramUserId &&
              p.status === "pending"
          )
          .sort(
            (a, b) =>
              new Date(b.createdAt) -
              new Date(a.createdAt)
          );

        pending =
          list[0] || null;
      }

      if (!pending) {

        return res.json({
          ok: true,
          found: false,
          error:
            "No pending deposit found"
        });
      }

      const minTimestamp =
        Math.max(
          0,
          new Date(
            pending.createdAt
          ).getTime() -
          10 * 60 * 1000
        );

      const transfers =
        await getIncomingUSDTTransfers(
          minTimestamp
        );

      let matched = null;

      for (
        const transfer of transfers
      ) {

        const txid =
          transferTxid(
            transfer
          );

        const to =
          transferTo(
            transfer
          );

        const value =
          transferValue(
            transfer
          );

        const contract =
          transferContract(
            transfer
          );

        if (!txid) continue;

        if (
          to !==
          DEPOSIT_ADDRESS
        ) {
          continue;
        }

        if (
          contract &&
          contract !==
          USDT_CONTRACT
        ) {
          continue;
        }

        if (
          value !==
          String(
            pending.paymentAmountBase
          )
        ) {
          continue;
        }

        if (
          transfer.success === false
        ) {
          continue;
        }

        matched =
          transfer;

        break;
      }

      if (!matched) {

        return res.json({
          ok: true,
          found: false,

          pending: {
            id:
              pending.id,

            requestedAmount:
              pending.requestedAmount,

            paymentAmount:
              pending.paymentAmount,

            depositAddress:
              DEPOSIT_ADDRESS,

            status:
              pending.status
          }
        });
      }

      await processIncomingTransfer(
        matched
      );

      const after =
        readStore();

      const confirmed =
        after.deposits[
          transferTxid(matched)
        ];

      const user =
        after.users[
          telegramUserId
        ];

      if (!confirmed) {

        return res.json({
          ok: true,
          found: false,
          error:
            "Transaction found but confirmation is still pending"
        });
      }

      res.json({
        ok: true,

        found: true,

        deposit:
          confirmed,

        balance:
          Number(
            user?.balance || 0
          )
      });

    } catch (err) {

      console.error(
        "Deposit check error:",
        err
      );

      res.status(500).json({
        ok: false,
        error:
          err.message ||
          "Deposit check failed"
      });
    }
  }
);


/* =========================================================
   OLD TXID VERIFY ENDPOINT
   Kept for compatibility.
========================================================= */

app.post(
  "/api/deposits/verify",
  requireTelegram,
  async (req, res) => {

    try {

      const txid =
        String(
          req.body?.txid || ""
        ).trim();

      if (
        !/^[a-fA-F0-9]{64}$/.test(
          txid
        )
      ) {

        return res.status(400).json({
          ok: false,
          error:
            "Invalid TXID"
        });
      }

      const existing =
        readStore().deposits[
          txid
        ];

      if (existing) {

        return res.json({
          ok: true,
          alreadyConfirmed: true,
          deposit: existing
        });
      }

      /*
        For old/manual compatibility,
        expected amount must be supplied.
      */

      const amount =
        String(
          req.body?.amount || ""
        ).trim();

      if (
        !isValidAmount(amount)
      ) {

        return res.status(400).json({
          ok: false,
          error:
            "Amount is required"
        });
      }

      const expectedBase =
        toBaseUnits(amount);

      const transfers =
        await getIncomingUSDTTransfers(
          Date.now() -
          24 * 60 * 60 * 1000
        );

      let transfer = null;

      for (
        const item of transfers
      ) {

        if (
          transferTxid(item) ===
          txid &&
          transferTo(item) ===
          DEPOSIT_ADDRESS &&
          transferValue(item) ===
          expectedBase
        ) {
          transfer = item;
          break;
        }
      }

      if (!transfer) {

        return res.status(400).json({
          ok: false,
          error:
            "Matching USDT deposit was not found"
        });
      }

      await verifyTransferSuccess(
        txid
      );

      const result =
        await withStoreLock(
          async () => {

            const store =
              readStore();

            if (
              store.deposits[txid]
            ) {
              return store.deposits[
                txid
              ];
            }

            const user =
              getUser(
                store,
                req.telegramUser
              );

            user.balance =
              Number(user.balance || 0) +
              Number(amount);

            user.updatedAt =
              nowISO();

            const deposit = {

              id:
                generateId("dep"),

              txid,

              telegramUserId:
                String(
                  user.telegramUserId
                ),

              from:
                transferFrom(transfer),

              to:
                DEPOSIT_ADDRESS,

              amount,

              amountBase:
                expectedBase,

              status:
                "confirmed",

              createdAt:
                nowISO(),

              confirmedAt:
                nowISO(),

              blockTimestamp:
                Number(
                  transfer.block_timestamp ||
                  0
                )
            };

            store.deposits[txid] =
              deposit;

            writeStore(store);

            return deposit;
          }
        );

      res.json({
        ok: true,
        deposit: result
      });

    } catch (err) {

      res.status(400).json({
        ok: false,
        error:
          err.message
      });
    }
  }
);


/* =========================================================
   WITHDRAWAL REQUEST
========================================================= */

app.post(
  "/api/withdrawals/request",
  requireTelegram,
  async (req, res) => {

    try {

      const amount =
        String(
          req.body?.amount || ""
        ).trim();

      const address =
        normalizeAddress(
          req.body?.address
        );

      if (
        !isValidAmount(amount)
      ) {

        return res.status(400).json({
          ok: false,
          error:
            "Invalid amount"
        });
      }

      if (
        Number(amount) <
        MIN_WITHDRAWAL
      ) {

        return res.status(400).json({
          ok: false,
          error:
            `Minimum withdrawal is ${MIN_WITHDRAWAL} USDT`
        });
      }

      if (
        !isValidTronAddress(address)
      ) {

        return res.status(400).json({
          ok: false,
          error:
            "Invalid TRON address"
        });
      }

      const result =
        await withStoreLock(
          async () => {

            const store =
              readStore();

            const user =
              getUser(
                store,
                req.telegramUser
              );

            const balance =
              Number(
                user.balance || 0
              );

            if (
              balance <
              Number(amount)
            ) {

              throw new Error(
                "Insufficient balance"
              );
            }

            user.balance =
              balance -
              Number(amount);

            user.updatedAt =
              nowISO();

            const id =
              generateId("wd");

            const withdrawal = {

              id,

              telegramUserId:
                String(
                  user.telegramUserId
                ),

              amount,

              amountBase:
                toBaseUnits(amount),

              address,

              status:
                "pending",

              txid: "",

              createdAt:
                nowISO(),

              updatedAt:
                nowISO()
            };

            store.withdrawals[id] =
              withdrawal;

            writeStore(store);

            return withdrawal;
          }
        );

      res.json({
        ok: true,
        withdrawal: result
      });

    } catch (err) {

      res.status(400).json({
        ok: false,
        error:
          err.message
      });
    }
  }
);


/* =========================================================
   MY WITHDRAWALS
========================================================= */

app.post(
  "/api/withdrawals/my",
  requireTelegram,
  async (req, res) => {

    try {

      const store =
        readStore();

      const id =
        String(
          req.telegramUser.id
        );

      const withdrawals =
        Object.values(
          store.withdrawals
        )
        .filter(
          w =>
            String(
              w.telegramUserId
            ) === id
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

    } catch (err) {

      res.status(500).json({
        ok: false,
        error:
          "Could not load withdrawals"
      });
    }
  }
);


/* =========================================================
   ADMIN STATUS
========================================================= */

app.post(
  "/api/admin/status",
  requireAdmin,
  (req, res) => {

    const store =
      readStore();

    res.json({
      ok: true,

      users:
        Object.keys(
          store.users
        ).length,

      deposits:
        Object.keys(
          store.deposits
        ).length,

      pendingDeposits:
        Object.values(
          store.pendingDeposits
        ).filter(
          x =>
            x.status === "pending"
        ).length,

      withdrawals:
        Object.keys(
          store.withdrawals
        ).length,

      depositAddress:
        DEPOSIT_ADDRESS
    });
  }
);


/* =========================================================
   ADMIN WITHDRAWALS
========================================================= */

app.post(
  "/api/admin/withdrawals",
  requireAdmin,
  (req, res) => {

    const store =
      readStore();

    const withdrawals =
      Object.values(
        store.withdrawals
      ).sort(
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
   ADMIN APPROVE WITHDRAWAL
========================================================= */

app.post(
  "/api/admin/withdrawals/:id/approve",
  requireAdmin,
  async (req, res) => {

    try {

      const result =
        await withStoreLock(
          async () => {

            const store =
              readStore();

            const withdrawal =
              store.withdrawals[
                req.params.id
              ];

            if (!withdrawal) {
              throw new Error(
                "Withdrawal not found"
              );
            }

            if (
              withdrawal.status !==
              "pending"
            ) {
              throw new Error(
                "Withdrawal is not pending"
              );
            }

            withdrawal.status =
              "approved";

            withdrawal.approvedAt =
              nowISO();

            withdrawal.updatedAt =
              nowISO();

            writeStore(store);

            return withdrawal;
          }
        );

      res.json({
        ok: true,
        withdrawal: result
      });

    } catch (err) {

      res.status(400).json({
        ok: false,
        error:
          err.message
      });
    }
  }
);


/* =========================================================
   ADMIN REJECT WITHDRAWAL
========================================================= */

app.post(
  "/api/admin/withdrawals/:id/reject",
  requireAdmin,
  async (req, res) => {

    try {

      const result =
        await withStoreLock(
          async () => {

            const store =
              readStore();

            const withdrawal =
              store.withdrawals[
                req.params.id
              ];

            if (!withdrawal) {
              throw new Error(
                "Withdrawal not found"
              );
            }

            if (
              withdrawal.status ===
              "completed"
            ) {
              throw new Error(
                "Completed withdrawal cannot be rejected"
              );
            }

            /*
              Return money to user
              only if it was previously
              deducted and not already returned.
            */

            if (
              withdrawal.status !==
              "rejected"
            ) {

              const user =
                store.users[
                  withdrawal.telegramUserId
                ];

              if (user) {

                user.balance =
                  Number(
                    user.balance || 0
                  ) +
                  Number(
                    withdrawal.amount
                  );

                user.updatedAt =
                  nowISO();
              }
            }

            withdrawal.status =
              "rejected";

            withdrawal.rejectedAt =
              nowISO();

            withdrawal.reason =
              String(
                req.body?.reason ||
                "Rejected by admin"
              );

            withdrawal.updatedAt =
              nowISO();

            writeStore(store);

            return withdrawal;
          }
        );

      res.json({
        ok: true,
        withdrawal: result
      });

    } catch (err) {

      res.status(400).json({
        ok: false,
        error:
          err.message
      });
    }
  }
);


/* =========================================================
   ADMIN COMPLETE WITHDRAWAL
========================================================= */

app.post(
  "/api/admin/withdrawals/:id/complete",
  requireAdmin,
  async (req, res) => {

    try {

      const txid =
        String(
          req.body?.txid || ""
        ).trim();

      if (
        !/^[a-fA-F0-9]{64}$/.test(
          txid
        )
      ) {

        return res.status(400).json({
          ok: false,
          error:
            "Valid TXID is required"
        });
      }

      const result =
        await withStoreLock(
          async () => {

            const store =
              readStore();

            const withdrawal =
              store.withdrawals[
                req.params.id
              ];

            if (!withdrawal) {
              throw new Error(
                "Withdrawal not found"
              );
            }

            if (
              withdrawal.status ===
              "completed"
            ) {
              return withdrawal;
            }

            withdrawal.status =
              "completed";

            withdrawal.txid =
              txid;

            withdrawal.completedAt =
              nowISO();

            withdrawal.updatedAt =
              nowISO();

            writeStore(store);

            return withdrawal;
          }
        );

      res.json({
        ok: true,
        withdrawal: result
      });

    } catch (err) {

      res.status(400).json({
        ok: false,
        error:
          err.message
      });
    }
  }
);


/* =========================================================
   ADMIN USER
========================================================= */

app.post(
  "/api/admin/user",
  requireAdmin,
  (req, res) => {

    const telegramUserId =
      String(
        req.body?.telegramUserId ||
        ""
      ).trim();

    if (!telegramUserId) {

      return res.status(400).json({
        ok: false,
        error:
          "telegramUserId is required"
      });
    }

    const store =
      readStore();

    const user =
      store.users[
        telegramUserId
      ];

    if (!user) {

      return res.status(404).json({
        ok: false,
        error:
          "User not found"
      });
    }

    res.json({
      ok: true,
      user
    });
  }
);


/* =========================================================
   ADMIN REFERRALS
========================================================= */

app.post(
  "/api/admin/referrals",
  requireAdmin,
  (req, res) => {

    const store =
      readStore();

    res.json({
      ok: true,

      referrals:
        Object.values(
          store.referrals
        ).sort(
          (a, b) =>
            new Date(b.createdAt) -
            new Date(a.createdAt)
        )
    });
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
        "Route not found"
    });
  }
);


/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
  (err, req, res, next) => {

    console.error(
      "SERVER ERROR:",
      err
    );

    res.status(500).json({
      ok: false,
      error:
        err.message ||
        "Internal server error"
    });
  }
);


/* =========================================================
   START SERVER
========================================================= */

app.listen(
  PORT,
  () => {

    console.log(
      "===================================="
    );

    console.log(
      "BIG MONEY SERVER STARTED"
    );

    console.log(
      "PORT:",
      PORT
    );

    console.log(
      "DEPOSIT ADDRESS:",
      DEPOSIT_ADDRESS
    );

    console.log(
      "USDT CONTRACT:",
      USDT_CONTRACT
    );

    console.log(
      "AUTO DEPOSIT SCAN:",
      `${AUTO_SCAN_MS / 1000}s`
    );

    console.log(
      "===================================="
    );

    /*
      Start automatic scanner.
    */

    setTimeout(
      () => {

        autoScanDeposits();

        setInterval(
          autoScanDeposits,
          AUTO_SCAN_MS
        );

      },
      5000
    );
  }
);
