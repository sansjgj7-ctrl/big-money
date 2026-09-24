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
  Number(process.env.TELEGRAM_AUTH_MAX_AGE || 3600);

/*
  USDT TRC20 uses 6 decimals.
  Example:
  1 USDT = 1,000,000 base units
*/
const USDT_DECIMALS = 6;


/* =========================================================
   EXPRESS
========================================================= */

app.use(
  cors({
    origin: ALLOWED_ORIGIN,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

app.use(
  express.json({
    limit: "100kb",
  })
);


/* =========================================================
   SIMPLE RATE LIMIT
========================================================= */

const rateMap = new Map();

function rateLimit(key, maxRequests, windowMs) {
  const now = Date.now();

  const item = rateMap.get(key);

  if (!item || now - item.start > windowMs) {
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
   DATABASE / JSON STORE
========================================================= */

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "big-money-data.json");

function defaultStore() {
  return {
    users: {},
    deposits: {},
    withdrawals: {},
  };
}

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, {
      recursive: true,
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
    const raw = fs.readFileSync(DATA_FILE, "utf8");

    const data = JSON.parse(raw);

    return {
      users: data.users || {},
      deposits: data.deposits || {},
      withdrawals: data.withdrawals || {},
    };
  } catch (error) {
    console.error("STORE READ ERROR:", error);

    throw new Error("Database read error");
  }
}

/*
  Atomic-ish file replacement.
  This reduces the chance of leaving a half-written JSON file.
*/
function writeStore(data) {
  ensureStore();

  const tempFile = DATA_FILE + ".tmp";

  fs.writeFileSync(
    tempFile,
    JSON.stringify(data, null, 2),
    "utf8"
  );

  fs.renameSync(tempFile, DATA_FILE);
}


/* =========================================================
   STORE LOCK
   Prevents two simultaneous deposit requests from
   crediting the same transaction twice.
========================================================= */

let storeLock = Promise.resolve();

function withStoreLock(fn) {
  const next = storeLock.then(fn, fn);

  storeLock = next.catch(() => {});

  return next;
}


/* =========================================================
   USER
========================================================= */

function getUser(store, telegramUser) {
  const id = String(telegramUser.id);

  if (!store.users[id]) {
    store.users[id] = {
      telegramUserId: id,
      username: telegramUser.username || "",
      firstName: telegramUser.first_name || "",
      lastName: telegramUser.last_name || "",
      balance: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  } else {
    store.users[id].username =
      telegramUser.username || store.users[id].username || "";

    store.users[id].firstName =
      telegramUser.first_name || store.users[id].firstName || "";

    store.users[id].lastName =
      telegramUser.last_name || store.users[id].lastName || "";

    store.users[id].updatedAt =
      new Date().toISOString();
  }

  return store.users[id];
}


/* =========================================================
   TELEGRAM INIT DATA VALIDATION
=========================================================

   IMPORTANT:
   Never trust:
   Telegram.WebApp.initDataUnsafe.user.id

   The browser can modify it.

   We validate Telegram.WebApp.initData on the server.
========================================================= */

function validateTelegramInitData(initData) {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN is not configured on the server"
    );
  }

  if (
    typeof initData !== "string" ||
    !initData.trim()
  ) {
    throw new Error("Missing Telegram initData");
  }

  const params = new URLSearchParams(initData);

  const receivedHash = params.get("hash");

  if (!receivedHash) {
    throw new Error("Telegram hash is missing");
  }

  params.delete("hash");

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  /*
    Telegram:
    secret_key = HMAC-SHA256(bot_token, "WebAppData")
  */

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(TELEGRAM_BOT_TOKEN)
    .digest();

  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  const receivedBuffer =
    Buffer.from(receivedHash, "hex");

  const calculatedBuffer =
    Buffer.from(calculatedHash, "hex");

  if (
    receivedBuffer.length !== calculatedBuffer.length ||
    !crypto.timingSafeEqual(
      receivedBuffer,
      calculatedBuffer
    )
  ) {
    throw new Error("Invalid Telegram initData");
  }

  const authDate = Number(params.get("auth_date"));

  if (!Number.isFinite(authDate)) {
    throw new Error("Invalid Telegram auth_date");
  }

  const age = Math.floor(Date.now() / 1000) - authDate;

  if (
    age < -60 ||
    age > TELEGRAM_AUTH_MAX_AGE
  ) {
    throw new Error("Telegram session expired");
  }

  const userRaw = params.get("user");

  if (!userRaw) {
    throw new Error("Telegram user data missing");
  }

  let user;

  try {
    user = JSON.parse(userRaw);
  } catch {
    throw new Error("Invalid Telegram user data");
  }

  if (
    !user ||
    !user.id
  ) {
    throw new Error("Invalid Telegram user");
  }

  return user;
}


/* =========================================================
   AUTH MIDDLEWARE
========================================================= */

function requireTelegram(req, res, next) {
  try {
    const initData =
      req.body?.initData ||
      req.headers["x-telegram-init-data"];

    const telegramUser =
      validateTelegramInitData(initData);

    req.telegramUser = telegramUser;

    next();
  } catch (error) {
    return res.status(401).json({
      ok: false,
      error: error.message,
    });
  }
}


/* =========================================================
   TRONGRID REQUEST
========================================================= */

async function tronRequest(
  endpoint,
  options = {}
) {
  const headers = {
    Accept: "application/json",
    ...(options.headers || {}),
  };

  if (TRONGRID_API_KEY) {
    headers["TRON-PRO-API-KEY"] =
      TRONGRID_API_KEY;
  }

  const response = await fetch(
    `${TRONGRID_URL}${endpoint}`,
    {
      ...options,
      headers,
    }
  );

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = {
      raw: text,
    };
  }

  if (!response.ok) {
    throw new Error(
      `TronGrid HTTP ${response.status}`
    );
  }

  return data;
}


/* =========================================================
   TXID VALIDATION
========================================================= */

function isValidTxid(txid) {
  return (
    typeof txid === "string" &&
    /^[a-fA-F0-9]{64}$/.test(txid.trim())
  );
}


/* =========================================================
   AMOUNT HELPERS
========================================================= */

function baseUnitsToUsdt(value) {
  const n = BigInt(String(value));

  const whole = n / 1000000n;
  const fraction =
    (n % 1000000n)
      .toString()
      .padStart(6, "0")
      .replace(/0+$/, "");

  if (!fraction) {
    return whole.toString();
  }

  return `${whole}.${fraction}`;
}

function usdtToBaseUnits(amount) {
  if (
    typeof amount !== "string" &&
    typeof amount !== "number"
  ) {
    throw new Error("Invalid amount");
  }

  const str = String(amount).trim();

  if (!/^\d+(\.\d{1,6})?$/.test(str)) {
    throw new Error("Invalid USDT amount");
  }

  const [whole, fraction = ""] =
    str.split(".");

  const padded =
    fraction.padEnd(6, "0");

  return (
    BigInt(whole) * 1000000n +
    BigInt(padded)
  );
}


/* =========================================================
   ADDRESS NORMALIZATION
========================================================= */

function normalizeAddress(address) {
  if (
    typeof address !== "string"
  ) {
    return "";
  }

  return address.trim();
}


/* =========================================================
   FETCH SOLIDIFIED TRANSACTION
=========================================================

   SolidityNode only returns solidified transactions.
   This is important for real confirmation.
========================================================= */

async function getSolidifiedTransaction(txid) {
  return tronRequest(
    "/walletsolidity/gettransactionbyid",
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json",
      },
      body: JSON.stringify({
        value: txid,
      }),
    }
  );
}


/* =========================================================
   FETCH SOLIDIFIED RECEIPT
========================================================= */

async function getSolidifiedReceipt(txid) {
  return tronRequest(
    "/walletsolidity/gettransactioninfobyid",
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json",
      },
      body: JSON.stringify({
        value: txid,
      }),
    }
  );
}


/* =========================================================
   FETCH CONFIRMED EVENTS FOR EXACT TXID
=========================================================

   This is much safer than:
   "give me the latest 50 transfers"

   We inspect THIS EXACT transaction ID.
========================================================= */

async function getConfirmedEvents(txid) {
  const endpoint =
    `/v1/transactions/${encodeURIComponent(
      txid
    )}/events?only_confirmed=true&event_name=Transfer&limit=200`;

  return tronRequest(endpoint);
}


/* =========================================================
   VERIFY REAL USDT TRANSFER
========================================================= */

async function verifyUsdtTransaction({
  txid,
  expectedAmount,
}) {
  /*
    1. Exact transaction must exist and be solidified.
  */

  const transaction =
    await getSolidifiedTransaction(txid);

  if (
    !transaction ||
    !transaction.txID
  ) {
    throw new Error(
      "Transaction is not confirmed yet"
    );
  }

  if (
    transaction.txID.toLowerCase() !==
    txid.toLowerCase()
  ) {
    throw new Error(
      "Transaction ID mismatch"
    );
  }

  /*
    2. Get solidified execution receipt.
  */

  const receipt =
    await getSolidifiedReceipt(txid);

  if (!receipt) {
    throw new Error(
      "Transaction receipt not available"
    );
  }

  /*
    TRON docs:
    receipt.result === SUCCESS
    means successful smart-contract execution.
  */

  if (
    receipt.receipt &&
    receipt.receipt.result &&
    String(
      receipt.receipt.result
    ).toUpperCase() !== "SUCCESS"
  ) {
    throw new Error(
      "Transaction execution failed"
    );
  }

  /*
    3. Get Transfer events from THIS exact TXID.
  */

  const eventResponse =
    await getConfirmedEvents(txid);

  const events =
    Array.isArray(eventResponse?.data)
      ? eventResponse.data
      : [];

  if (!events.length) {
    throw new Error(
      "No confirmed USDT transfer event found"
    );
  }

  /*
    4. Find an event emitted by the official
       USDT TRC20 contract and sent TO our deposit address.
  */

  const matchingEvents =
    events.filter((event) => {
      const contract =
        normalizeAddress(
          event.contract ||
          event.contract_address
        );

      const eventName =
        String(
          event.event_name ||
          event.event ||
          ""
        );

      const result =
        event.result || {};

      const to =
        normalizeAddress(
          result.to ||
          event.to
        );

      const value =
        result.value ??
        event.value;

      return (
        contract === USDT_CONTRACT &&
        eventName === "Transfer" &&
        to === DEPOSIT_ADDRESS &&
        value !== undefined &&
        value !== null
      );
    });

  if (!matchingEvents.length) {
    throw new Error(
      "This transaction does not contain a confirmed USDT transfer to the deposit address"
    );
  }

  /*
    5. If multiple matching events exist,
       reject ambiguity instead of automatically
       crediting an uncertain amount.
  */

  if (matchingEvents.length !== 1) {
    throw new Error(
      "Transaction contains multiple matching USDT transfers; manual review required"
    );
  }

  const event =
    matchingEvents[0];

  const result =
    event.result || {};

  const from =
    normalizeAddress(
      result.from ||
      event.from
    );

  const to =
    normalizeAddress(
      result.to ||
      event.to
    );

  const rawValue =
    result.value ??
    event.value;

  let amountBase;

  try {
    amountBase =
      BigInt(String(rawValue));
  } catch {
    throw new Error(
      "Invalid USDT transfer amount"
    );
  }

  if (amountBase <= 0n) {
    throw new Error(
      "Transfer amount must be greater than zero"
    );
  }

  /*
    6. Optional amount check.

    If frontend/user supplied amount,
    require exact amount.
  */

  if (
    expectedAmount !== undefined &&
    expectedAmount !== null &&
    String(expectedAmount).trim() !== ""
  ) {
    const expectedBase =
      usdtToBaseUnits(
        expectedAmount
      );

    if (amountBase !== expectedBase) {
      throw new Error(
        `Amount mismatch. Expected ${expectedAmount} USDT but blockchain shows ${baseUnitsToUsdt(
          amountBase
        )} USDT`
      );
    }
  }

  return {
    txid,
    from,
    to,
    amountBase: amountBase.toString(),
    amount: baseUnitsToUsdt(amountBase),
    contract: USDT_CONTRACT,
    confirmed: true,
  };
}


/* =========================================================
   HEALTH
========================================================= */

app.get("/", (req, res) => {
  res.json({
    ok: true,
    name: "Big Money Backend",
    network: "TRON TRC20",
    secureDepositVerification: true,
  });
});


/* =========================================================
   CONFIG
========================================================= */

app.get("/api/config", (req, res) => {
  res.json({
    network: "TRON",
    token: "USDT",
    standard: "TRC20",
    depositAddress: DEPOSIT_ADDRESS,
  });
});


/* =========================================================
   ACCOUNT
========================================================= */

app.post(
  "/api/account",
  requireTelegram,
  async (req, res) => {
    try {
      if (
        !rateLimit(
          `account:${req.telegramUser.id}`,
          30,
          60 * 1000
        )
      ) {
        return res.status(429).json({
          ok: false,
          error: "Too many requests",
        });
      }

      const store = readStore();

      const user =
        getUser(
          store,
          req.telegramUser
        );

      writeStore(store);

      return res.json({
        ok: true,
        user: {
          telegramUserId:
            user.telegramUserId,
          username:
            user.username,
          firstName:
            user.firstName,
          balance:
            user.balance,
        },
      });
    } catch (error) {
      console.error(
        "ACCOUNT ERROR:",
        error
      );

      return res.status(500).json({
        ok: false,
        error: "Server error",
      });
    }
  }
);


/* =========================================================
   CHECK BLOCKCHAIN DEPOSIT
=========================================================

   This only shows confirmed transfers.
   It NEVER adds balance.
========================================================= */

app.post(
  "/api/deposits/check",
  requireTelegram,
  async (req, res) => {
    try {
      if (
        !rateLimit(
          `check:${req.telegramUser.id}`,
          10,
          60 * 1000
        )
      ) {
        return res.status(429).json({
          ok: false,
          error: "Too many requests",
        });
      }

      const endpoint =
        `/v1/accounts/${encodeURIComponent(
          DEPOSIT_ADDRESS
        )}/transactions/trc20` +
        `?only_confirmed=true` +
        `&only_to=true` +
        `&contract_address=${encodeURIComponent(
          USDT_CONTRACT
        )}` +
        `&limit=20` +
        `&order_by=block_timestamp,desc`;

      const data =
        await tronRequest(endpoint);

      const transfers =
        Array.isArray(data?.data)
          ? data.data
          : [];

      const clean =
        transfers.map((tx) => ({
          txid: tx.transaction_id,
          from: tx.from,
          to: tx.to,
          amount:
            tx.value !== undefined
              ? baseUnitsToUsdt(tx.value)
              : "0",
          confirmed: true,
          timestamp:
            tx.block_timestamp || null,
        }));

      return res.json({
        ok: true,
        transfers: clean,
      });
    } catch (error) {
      console.error(
        "DEPOSIT CHECK ERROR:",
        error
      );

      return res.status(500).json({
        ok: false,
        error: "Blockchain check failed",
      });
    }
  }
);


/* =========================================================
   VERIFY + CREDIT DEPOSIT
========================================================= */

app.post(
  "/api/deposits/verify",
  requireTelegram,
  async (req, res) => {
    try {
      const telegramUser =
        req.telegramUser;

      if (
        !rateLimit(
          `verify:${telegramUser.id}`,
          5,
          60 * 1000
        )
      ) {
        return res.status(429).json({
          ok: false,
          error:
            "Too many verification requests. Try again later.",
        });
      }

      const txid =
        String(
          req.body?.txid || ""
        )
          .trim()
          .toLowerCase();

      const expectedAmount =
        req.body?.amount;

      /*
        TXID format.
      */

      if (!isValidTxid(txid)) {
        return res.status(400).json({
          ok: false,
          error:
            "Invalid TXID. A TRON TXID must contain 64 hexadecimal characters.",
        });
      }

      /*
        Critical section:
        check whether TXID has already been credited,
        verify blockchain,
        then write balance.
      */

      const result =
        await withStoreLock(
          async () => {
            const store =
              readStore();

            /*
              Replay protection.
            */

            if (
              store.deposits[txid]
            ) {
              return {
                alreadyProcessed: true,
                deposit:
                  store.deposits[txid],
              };
            }

            /*
              Verify exact blockchain transaction.
            */

            const verified =
              await verifyUsdtTransaction({
                txid,
                expectedAmount,
              });

            /*
              Get authenticated Telegram user.
            */

            const user =
              getUser(
                store,
                telegramUser
              );

            /*
              Credit ONLY after all blockchain checks pass.
            */

            const previousBalance =
              Number(user.balance || 0);

            const depositAmount =
              Number(
                verified.amount
              );

            if (
              !Number.isFinite(
                depositAmount
              ) ||
              depositAmount <= 0
            ) {
              throw new Error(
                "Invalid deposit amount"
              );
            }

            const newBalance =
              previousBalance +
              depositAmount;

            user.balance =
              newBalance;

            user.updatedAt =
              new Date().toISOString();

            /*
              Save immutable deposit record.
            */

            const depositRecord = {
              txid,
              telegramUserId:
                String(
                  telegramUser.id
                ),
              from:
                verified.from,
              to:
                verified.to,
              amount:
                verified.amount,
              amountBase:
                verified.amountBase,
              contract:
                verified.contract,
              status:
                "credited",
              confirmed:
                true,
              createdAt:
                new Date().toISOString(),
              creditedAt:
                new Date().toISOString(),
            };

            store.deposits[txid] =
              depositRecord;

            writeStore(store);

            return {
              alreadyProcessed: false,
              deposit:
                depositRecord,
              balance:
                newBalance,
            };
          }
        );

      if (
        result.alreadyProcessed
      ) {
        /*
          Do NOT credit again.
        */

        return res.status(409).json({
          ok: false,
          error:
            "This TXID has already been processed.",
          deposit:
            result.deposit,
        });
      }

      return res.json({
        ok: true,
        message:
          "Deposit confirmed and balance credited.",
        deposit:
          result.deposit,
        balance:
          result.balance,
      });
    } catch (error) {
      console.error(
        "VERIFY DEPOSIT ERROR:",
        error
      );

      return res.status(400).json({
        ok: false,
        error:
          error.message ||
          "Deposit verification failed",
      });
    }
  }
);


/* =========================================================
   WITHDRAWAL
=========================================================

   This version ONLY creates a pending withdrawal.

   It does NOT send USDT automatically.
   Automatic blockchain withdrawals need a properly
   secured hot wallet/private-key architecture.
========================================================= */

app.post(
  "/api/withdrawals/request",
  requireTelegram,
  async (req, res) => {
    try {
      const telegramUser =
        req.telegramUser;

      if (
        !rateLimit(
          `withdraw:${telegramUser.id}`,
          3,
          60 * 1000
        )
      ) {
        return res.status(429).json({
          ok: false,
          error:
            "Too many withdrawal requests",
        });
      }

      const amount =
        req.body?.amount;

      const address =
        String(
          req.body?.address || ""
        ).trim();

      if (!address) {
        return res.status(400).json({
          ok: false,
          error:
            "Withdrawal address is required",
        });
      }

      const amountBase =
        usdtToBaseUnits(amount);

      if (amountBase <= 0n) {
        return res.status(400).json({
          ok: false,
          error:
            "Invalid withdrawal amount",
        });
      }

      /*
        For security, use a lock for balance changes.
      */

      const result =
        await withStoreLock(
          async () => {
            const store =
              readStore();

            const user =
              getUser(
                store,
                telegramUser
              );

            const balanceBase =
              usdtToBaseUnits(
                String(
                  user.balance || 0
                )
              );

            if (
              amountBase >
              balanceBase
            ) {
              throw new Error(
                "Insufficient balance"
              );
            }

            const withdrawalId =
              crypto
                .randomBytes(16)
                .toString("hex");

            /*
              Deduct immediately and mark pending.
              An admin/manual processor can later
              approve/send it.
            */

            const newBalanceBase =
              balanceBase -
              amountBase;

            user.balance =
              Number(
                newBalanceBase
              ) /
              1000000;

            user.updatedAt =
              new Date().toISOString();

            store.withdrawals[
              withdrawalId
            ] = {
              id:
                withdrawalId,
              telegramUserId:
                String(
                  telegramUser.id
                ),
              amount:
                String(amount),
              address,
              status:
                "pending",
              createdAt:
                new Date().toISOString(),
            };

            writeStore(store);

            return {
              withdrawalId,
              balance:
                user.balance,
            };
          }
        );

      return res.json({
        ok: true,
        message:
          "Withdrawal request created and is pending review.",
        withdrawalId:
          result.withdrawalId,
        balance:
          result.balance,
      });
    } catch (error) {
      console.error(
        "WITHDRAWAL ERROR:",
        error
      );

      return res.status(400).json({
        ok: false,
        error:
          error.message ||
          "Withdrawal failed",
      });
    }
  }
);


/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
  (err, req, res, next) => {
    console.error(
      "UNHANDLED ERROR:",
      err
    );

    res.status(500).json({
      ok: false,
      error:
        "Internal server error",
    });
  }
);


/* =========================================================
   START
========================================================= */

ensureStore();

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Big Money Backend running on port ${PORT}`
    );

    console.log(
      `Network: TRON TRC20`
    );

    console.log(
      `Deposit address: ${DEPOSIT_ADDRESS}`
    );

    console.log(
      `Telegram authentication: ${
        TELEGRAM_BOT_TOKEN
          ? "ENABLED"
          : "DISABLED - CONFIGURE TELEGRAM_BOT_TOKEN"
      }`
    );

    console.log(
      `TronGrid API key: ${
        TRONGRID_API_KEY
          ? "CONFIGURED"
          : "NOT CONFIGURED"
      }`
    );
  }
);
