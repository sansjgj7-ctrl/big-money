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

const ADMIN_TELEGRAM_IDS = String(
  process.env.ADMIN_TELEGRAM_IDS || ""
)
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

const WITHDRAWAL_SOURCE_ADDRESS =
  process.env.WITHDRAWAL_SOURCE_ADDRESS || "";

const USDT_DECIMALS = 6;
const MIN_WITHDRAWAL = 1;


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
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, {
      recursive: true,
    });
  }

  if (!fs.existsSync(DATA_FILE)) {
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
      deposits: data.deposits || {},
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
   HELPERS
========================================================= */

function nowISO() {
  return new Date().toISOString();
}

function generateId(prefix) {
  return (
    prefix +
    "_" +
    crypto.randomBytes(12).toString("hex")
  );
}

function isValidAmount(amount) {
  return (
    typeof amount === "number" &&
    Number.isFinite(amount) &&
    amount > 0
  );
}

function toBaseUnits(amount) {
  const value = Number(amount);

  if (!isValidAmount(value)) {
    throw new Error("Invalid amount");
  }

  const scaled =
    Math.round(
      value * 10 ** USDT_DECIMALS
    );

  if (!Number.isSafeInteger(scaled)) {
    throw new Error("Amount is too large");
  }

  return scaled;
}

function fromBaseUnits(amountBase) {
  return (
    Number(amountBase) /
    10 ** USDT_DECIMALS
  );
}

function isValidTronAddress(address) {
  return (
    typeof address === "string" &&
    /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(
      address.trim()
    )
  );
}

function normalizeAddress(address) {
  return String(address || "").trim();
}


/* =========================================================
   USER
========================================================= */

function getUser(store, telegramUser) {
  const id =
    String(telegramUser.id);

  if (!store.users[id]) {
    store.users[id] = {
      telegramUserId: id,

      username:
        telegramUser.username || "",

      firstName:
        telegramUser.first_name || "",

      lastName:
        telegramUser.last_name || "",

      balance: 0,

      createdAt: nowISO(),
      updatedAt: nowISO(),
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
      nowISO();
  }

  return store.users[id];
}


/* =========================================================
   TELEGRAM INIT DATA VALIDATION
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
    throw new Error(
      "Missing Telegram initData"
    );
  }

  const params =
    new URLSearchParams(initData);

  const receivedHash =
    params.get("hash");

  if (!receivedHash) {
    throw new Error(
      "Telegram hash is missing"
    );
  }

  params.delete("hash");

  const dataCheckString =
    Array.from(params.entries())
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

  if (!Number.isFinite(authDate)) {
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

  if (!user || !user.id) {
    throw new Error(
      "Invalid Telegram user"
    );
  }

  return user;
}


/* =========================================================
   AUTH MIDDLEWARE
========================================================= */

function getInitDataFromRequest(req) {
  return (
    req.headers["x-telegram-init-data"] ||
    req.body?.initData ||
    ""
  );
}

function requireTelegram(req, res, next) {
  try {
    const initData =
      getInitDataFromRequest(req);

    const telegramUser =
      validateTelegramInitData(
        initData
      );

    req.telegramUser =
      telegramUser;

    next();
  } catch (error) {
    return res.status(401).json({
      ok: false,
      error: error.message,
    });
  }
}

function requireAdmin(req, res, next) {
  try {
    const initData =
      getInitDataFromRequest(req);

    const telegramUser =
      validateTelegramInitData(
        initData
      );

    const telegramId =
      String(telegramUser.id);

    if (
      !ADMIN_TELEGRAM_IDS.includes(
        telegramId
      )
    ) {
      return res.status(403).json({
        ok: false,
        error: "Admin access required",
      });
    }

    req.telegramUser =
      telegramUser;

    next();
  } catch (error) {
    return res.status(401).json({
      ok: false,
      error: error.message,
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
    Accept: "application/json",
    ...(options.headers || {}),
  };

  if (TRONGRID_API_KEY) {
    headers[
      "TRON-PRO-API-KEY"
    ] = TRONGRID_API_KEY;
  }

  const response =
    await fetch(
      TRONGRID_URL +
        endpoint,
      {
        ...options,
        headers,
      }
    );

  const text =
    await response.text();

  let data;

  try {
    data =
      JSON.parse(text);
  } catch {
    data = {
      raw: text,
    };
  }

  if (!response.ok) {
    throw new Error(
      `TRON API error ${response.status}`
    );
  }

  return data;
}


/* =========================================================
   TRON TX HELPERS
========================================================= */

async function getSolidifiedTransaction(txid) {
  return tronRequest(
    `/walletsolidity/gettransactionbyid?value=${encodeURIComponent(
      txid
    )}`
  );
}

async function getSolidifiedTransactionInfo(txid) {
  return tronRequest(
    `/walletsolidity/gettransactioninfobyid?value=${encodeURIComponent(
      txid
    )}`
  );
}

async function getTransferEvents(txid) {
  const data =
    await tronRequest(
      `/v1/transactions/${encodeURIComponent(
        txid
      )}/events?only_confirmed=true&limit=200`
    );

  return Array.isArray(data.data)
    ? data.data
    : [];
}


/* =========================================================
   VERIFY DEPOSIT
========================================================= */

async function verifyDepositTransaction(
  txid,
  expectedAmount
) {
  const transaction =
    await getSolidifiedTransaction(
      txid
    );

  if (
    !transaction ||
    !transaction.txID
  ) {
    throw new Error(
      "Transaction not found"
    );
  }

  if (
    transaction.txID.toLowerCase() !==
    txid.toLowerCase()
  ) {
    throw new Error(
      "Invalid transaction"
    );
  }

  const info =
    await getSolidifiedTransactionInfo(
      txid
    );

  if (
    info.receipt &&
    info.receipt.result &&
    info.receipt.result !==
      "SUCCESS"
  ) {
    throw new Error(
      "Transaction failed"
    );
  }

  const events =
    await getTransferEvents(
      txid
    );

  const expectedBase =
    expectedAmount != null
      ? toBaseUnits(
          Number(expectedAmount)
        )
      : null;

  for (const event of events) {
    if (
      event.event_name !==
      "Transfer"
    ) {
      continue;
    }

    const result =
      event.result || {};

    const contract =
      event.contract_address ||
      event.address ||
      "";

    const from =
      result.from ||
      result._from ||
      "";

    const to =
      result.to ||
      result._to ||
      "";

    const valueRaw =
      result.value ||
      result._value;

    const value =
      Number(valueRaw);

    if (
      contract.toLowerCase() !==
      USDT_CONTRACT.toLowerCase()
    ) {
      continue;
    }

    if (
      to !== DEPOSIT_ADDRESS
    ) {
      continue;
    }

    if (
      !Number.isFinite(value)
    ) {
      continue;
    }

    if (
      expectedBase !== null &&
      value !== expectedBase
    ) {
      continue;
    }

    return {
      txid,
      from,
      to,
      amountBase: value,
      amount: fromBaseUnits(value),
    };
  }

  throw new Error(
    "Matching USDT deposit was not found"
  );
}


/* =========================================================
   VERIFY WITHDRAWAL TX
========================================================= */

async function verifyWithdrawalTransaction(
  txid,
  expectedTo,
  expectedAmountBase
) {
  if (
    !WITHDRAWAL_SOURCE_ADDRESS
  ) {
    throw new Error(
      "WITHDRAWAL_SOURCE_ADDRESS is not configured"
    );
  }

  const transaction =
    await getSolidifiedTransaction(
      txid
    );

  if (
    !transaction ||
    !transaction.txID
  ) {
    throw new Error(
      "Withdrawal transaction not found"
    );
  }

  const info =
    await getSolidifiedTransactionInfo(
      txid
    );

  if (
    info.receipt &&
    info.receipt.result &&
    info.receipt.result !==
      "SUCCESS"
  ) {
    throw new Error(
      "Withdrawal transaction failed"
    );
  }

  const events =
    await getTransferEvents(
      txid
    );

  for (const event of events) {
    if (
      event.event_name !==
      "Transfer"
    ) {
      continue;
    }

    const result =
      event.result || {};

    const contract =
      event.contract_address ||
      event.address ||
      "";

    const from =
      result.from ||
      result._from ||
      "";

    const to =
      result.to ||
      result._to ||
      "";

    const value =
      Number(
        result.value ||
        result._value
      );

    if (
      contract.toLowerCase() !==
      USDT_CONTRACT.toLowerCase()
    ) {
      continue;
    }

    if (
      from !==
      WITHDRAWAL_SOURCE_ADDRESS
    ) {
      continue;
    }

    if (
      to !== expectedTo
    ) {
      continue;
    }

    if (
      value !==
      Number(expectedAmountBase)
    ) {
      continue;
    }

    return true;
  }

  throw new Error(
    "Matching confirmed USDT withdrawal was not found"
  );
}


/* =========================================================
   BASIC ROUTES
========================================================= */

app.get("/", (req, res) => {
  res.json({
    ok: true,
    name: "Big Money Backend",
    network: "TRON TRC20",
    version: "withdraw-v1",
  });
});


app.get("/api/config", (req, res) => {
  res.json({
    ok: true,
    network: "TRON",
    token: "USDT",
    standard: "TRC20",
    depositAddress:
      DEPOSIT_ADDRESS,
    usdtContract:
      USDT_CONTRACT,
    decimals:
      USDT_DECIMALS,
    minWithdrawal:
      MIN_WITHDRAWAL,
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

            return {
              telegramUserId:
                user.telegramUserId,
              username:
                user.username,
              firstName:
                user.firstName,
              balance:
                Number(
                  user.balance || 0
                ),
            };
          }
        );

      res.json({
        ok: true,
        account: result,
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        ok: false,
        error:
          "Could not load account",
      });
    }
  }
);


/* =========================================================
   CHECK DEPOSIT
========================================================= */

app.post(
  "/api/deposits/check",
  requireTelegram,
  async (req, res) => {
    try {
      const txid =
        String(
          req.body?.txid || ""
        ).trim();

      const amount =
        Number(
          req.body?.amount
        );

      if (
        !txid ||
        !/^[a-fA-F0-9]{64}$/.test(
          txid
        )
      ) {
        return res.status(400).json({
          ok: false,
          error: "Invalid TXID",
        });
      }

      if (
        !isValidAmount(amount)
      ) {
        return res.status(400).json({
          ok: false,
          error: "Invalid amount",
        });
      }

      const userId =
        String(
          req.telegramUser.id
        );

      if (
        !rateLimit(
          `deposit:${userId}`,
          10,
          60 * 1000
        )
      ) {
        return res.status(429).json({
          ok: false,
          error:
            "Too many requests",
        });
      }

      const result =
        await withStoreLock(
          async () => {
            const store =
              readStore();

            if (
              store.deposits[txid]
            ) {
              return {
                alreadyProcessed: true,
                deposit:
                  store.deposits[txid],
              };
            }

            const verified =
              await verifyDepositTransaction(
                txid,
                amount
              );

            const user =
              getUser(
                store,
                req.telegramUser
              );

            const deposit = {
              id: generateId("dep"),
              txid,
              telegramUserId:
                user.telegramUserId,
              amount:
                verified.amount,
              amountBase:
                verified.amountBase,
              from:
                verified.from,
              to:
                verified.to,
              status:
                "confirmed",
              createdAt:
                nowISO(),
            };

            store.deposits[txid] =
              deposit;

            user.balance =
              Number(
                user.balance || 0
              ) +
              verified.amount;

            user.updatedAt =
              nowISO();

            writeStore(store);

            return {
              alreadyProcessed: false,
              deposit,
              balance:
                user.balance,
            };
          }
        );

      res.json({
        ok: true,
        ...result,
      });
    } catch (error) {
      console.error(
        "DEPOSIT CHECK ERROR:",
        error
      );

      res.status(400).json({
        ok: false,
        error: error.message,
      });
    }
  }
);


/* =========================================================
   DEPOSIT VERIFY ALIAS
========================================================= */

app.post(
  "/api/deposits/verify",
  requireTelegram,
  async (req, res) => {
    req.url =
      "/api/deposits/check";

    try {
      const txid =
        String(
          req.body?.txid || ""
        ).trim();

      const amount =
        Number(
          req.body?.amount
        );

      if (
        !txid ||
        !/^[a-fA-F0-9]{64}$/.test(
          txid
        )
      ) {
        return res.status(400).json({
          ok: false,
          error: "Invalid TXID",
        });
      }

      if (
        !isValidAmount(amount)
      ) {
        return res.status(400).json({
          ok: false,
          error: "Invalid amount",
        });
      }

      const result =
        await withStoreLock(
          async () => {
            const store =
              readStore();

            if (
              store.deposits[txid]
            ) {
              return {
                alreadyProcessed: true,
                deposit:
                  store.deposits[txid],
              };
            }

            const verified =
              await verifyDepositTransaction(
                txid,
                amount
              );

            const user =
              getUser(
                store,
                req.telegramUser
              );

            const deposit = {
              id: generateId("dep"),
              txid,
              telegramUserId:
                user.telegramUserId,
              amount:
                verified.amount,
              amountBase:
                verified.amountBase,
              from:
                verified.from,
              to:
                verified.to,
              status:
                "confirmed",
              createdAt:
                nowISO(),
            };

            store.deposits[txid] =
              deposit;

            user.balance =
              Number(
                user.balance || 0
              ) +
              verified.amount;

            user.updatedAt =
              nowISO();

            writeStore(store);

            return {
              alreadyProcessed: false,
              deposit,
              balance:
                user.balance,
            };
          }
        );

      res.json({
        ok: true,
        ...result,
      });
    } catch (error) {
      console.error(
        "DEPOSIT VERIFY ERROR:",
        error
      );

      res.status(400).json({
        ok: false,
        error: error.message,
      });
    }
  }
);


/* =========================================================
   CREATE WITHDRAWAL
========================================================= */

app.post(
  "/api/withdrawals/request",
  requireTelegram,
  async (req, res) => {
    try {
      const address =
        normalizeAddress(
          req.body?.address
        );

      const amount =
        Number(
          req.body?.amount
        );

      if (
        !isValidTronAddress(
          address
        )
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Invalid TRON USDT address",
        });
      }

      if (
        !isValidAmount(amount)
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Invalid withdrawal amount",
        });
      }

      if (
        amount < MIN_WITHDRAWAL
      ) {
        return res.status(400).json({
          ok: false,
          error:
            `Minimum withdrawal is ${MIN_WITHDRAWAL} USDT`,
        });
      }

      const amountBase =
        toBaseUnits(amount);

      const userId =
        String(
          req.telegramUser.id
        );

      if (
        !rateLimit(
          `withdraw:${userId}`,
          5,
          60 * 1000
        )
      ) {
        return res.status(429).json({
          ok: false,
          error:
            "Too many withdrawal requests",
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

            const currentBalance =
              Number(
                user.balance || 0
              );

            if (
              currentBalance <
              amount
            ) {
              throw new Error(
                "Insufficient balance"
              );
            }

            /*
              Reserve the money immediately.
              It will be returned if admin rejects.
            */

            user.balance =
              currentBalance -
              amount;

            user.updatedAt =
              nowISO();

            const withdrawal = {
              id: generateId("wd"),

              telegramUserId:
                user.telegramUserId,

              username:
                user.username,

              firstName:
                user.firstName,

              address,

              amount,

              amountBase,

              status:
                "pending",

              txid: "",

              rejectReason: "",

              createdAt:
                nowISO(),

              updatedAt:
                nowISO(),

              approvedAt: null,

              rejectedAt: null,

              completedAt: null,

              adminTelegramId: "",
            };

            store.withdrawals[
              withdrawal.id
            ] = withdrawal;

            writeStore(store);

            return {
              withdrawal,
              balance:
                user.balance,
            };
          }
        );

      res.json({
        ok: true,
        message:
          "Withdrawal request created",
        withdrawal:
          result.withdrawal,
        balance:
          result.balance,
      });
    } catch (error) {
      console.error(
        "WITHDRAW REQUEST ERROR:",
        error
      );

      res.status(400).json({
        ok: false,
        error: error.message,
      });
    }
  }
);


/* =========================================================
   USER WITHDRAWAL HISTORY
========================================================= */

app.post(
  "/api/withdrawals/my",
  requireTelegram,
  async (req, res) => {
    try {
      const userId =
        String(
          req.telegramUser.id
        );

      const store =
        readStore();

      const withdrawals =
        Object.values(
          store.withdrawals
        )
          .filter(
            (item) =>
              String(
                item.telegramUserId
              ) === userId
          )
          .sort(
            (a, b) =>
              new Date(b.createdAt) -
              new Date(a.createdAt)
          )
          .map((item) => ({
            id: item.id,
            address: item.address,
            amount: item.amount,
            status: item.status,
            txid: item.txid,
            rejectReason:
              item.rejectReason,
            createdAt:
              item.createdAt,
            approvedAt:
              item.approvedAt,
            rejectedAt:
              item.rejectedAt,
            completedAt:
              item.completedAt,
          }));

      res.json({
        ok: true,
        withdrawals,
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        ok: false,
        error:
          "Could not load withdrawals",
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
  async (req, res) => {
    res.json({
      ok: true,
      admin: true,
      adminTelegramId:
        String(
          req.telegramUser.id
        ),
      sourceAddress:
        WITHDRAWAL_SOURCE_ADDRESS,
      configured:
        Boolean(
          WITHDRAWAL_SOURCE_ADDRESS
        ),
    });
  }
);


/* =========================================================
   ADMIN LIST WITHDRAWALS
========================================================= */

app.post(
  "/api/admin/withdrawals",
  requireAdmin,
  async (req, res) => {
    try {
      const store =
        readStore();

      const status =
        String(
          req.body?.status || ""
        ).trim();

      let withdrawals =
        Object.values(
          store.withdrawals
        );

      if (status) {
        withdrawals =
          withdrawals.filter(
            (item) =>
              item.status ===
              status
          );
      }

      withdrawals.sort(
        (a, b) =>
          new Date(b.createdAt) -
          new Date(a.createdAt)
      );

      res.json({
        ok: true,
        withdrawals,
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        ok: false,
        error:
          "Could not load withdrawals",
      });
    }
  }
);


/* =========================================================
   ADMIN APPROVE
========================================================= */

app.post(
  "/api/admin/withdrawals/:id/approve",
  requireAdmin,
  async (req, res) => {
    try {
      const id =
        String(
          req.params.id || ""
        );

      const result =
        await withStoreLock(
          async () => {
            const store =
              readStore();

            const withdrawal =
              store.withdrawals[id];

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
                `Cannot approve withdrawal in status ${withdrawal.status}`
              );
            }

            withdrawal.status =
              "approved";

            withdrawal.approvedAt =
              nowISO();

            withdrawal.updatedAt =
              nowISO();

            withdrawal.adminTelegramId =
              String(
                req.telegramUser.id
              );

            writeStore(store);

            return withdrawal;
          }
        );

      res.json({
        ok: true,
        message:
          "Withdrawal approved",
        withdrawal: result,
      });
    } catch (error) {
      console.error(
        "ADMIN APPROVE ERROR:",
        error
      );

      res.status(400).json({
        ok: false,
        error: error.message,
      });
    }
  }
);


/* =========================================================
   ADMIN REJECT + REFUND
========================================================= */

app.post(
  "/api/admin/withdrawals/:id/reject",
  requireAdmin,
  async (req, res) => {
    try {
      const id =
        String(
          req.params.id || ""
        );

      const reason =
        String(
          req.body?.reason ||
          "Withdrawal rejected"
        ).trim();

      const result =
        await withStoreLock(
          async () => {
            const store =
              readStore();

            const withdrawal =
              store.withdrawals[id];

            if (!withdrawal) {
              throw new Error(
                "Withdrawal not found"
              );
            }

            if (
              withdrawal.status !==
              "pending" &&
              withdrawal.status !==
              "approved"
            ) {
              throw new Error(
                `Cannot reject withdrawal in status ${withdrawal.status}`
              );
            }

            const user =
              store.users[
                String(
                  withdrawal.telegramUserId
                )
              ];

            if (!user) {
              throw new Error(
                "User not found"
              );
            }

            /*
              Return the reserved funds.
            */

            user.balance =
              Number(
                user.balance || 0
              ) +
              Number(
                withdrawal.amount
              );

            user.updatedAt =
              nowISO();

            withdrawal.status =
              "rejected";

            withdrawal.rejectReason =
              reason;

            withdrawal.rejectedAt =
              nowISO();

            withdrawal.updatedAt =
              nowISO();

            withdrawal.adminTelegramId =
              String(
                req.telegramUser.id
              );

            writeStore(store);

            return {
              withdrawal,
              balance:
                user.balance,
            };
          }
        );

      res.json({
        ok: true,
        message:
          "Withdrawal rejected and refunded",
        withdrawal:
          result.withdrawal,
        balance:
          result.balance,
      });
    } catch (error) {
      console.error(
        "ADMIN REJECT ERROR:",
        error
      );

      res.status(400).json({
        ok: false,
        error: error.message,
      });
    }
  }
);


/* =========================================================
   ADMIN COMPLETE WITH TXID
========================================================= */

app.post(
  "/api/admin/withdrawals/:id/complete",
  requireAdmin,
  async (req, res) => {
    try {
      const id =
        String(
          req.params.id || ""
        );

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
            "Invalid TRON TXID",
        });
      }

      if (
        !WITHDRAWAL_SOURCE_ADDRESS
      ) {
        return res.status(500).json({
          ok: false,
          error:
            "WITHDRAWAL_SOURCE_ADDRESS is not configured",
        });
      }

      const result =
        await withStoreLock(
          async () => {
            const store =
              readStore();

            const withdrawal =
              store.withdrawals[id];

            if (!withdrawal) {
              throw new Error(
                "Withdrawal not found"
              );
            }

            if (
              withdrawal.status !==
              "approved"
            ) {
              throw new Error(
                "Withdrawal must be approved before completion"
              );
            }

            /*
              Do not allow the same TXID
              to complete another withdrawal.
            */

            for (
              const item of Object.values(
                store.withdrawals
              )
            ) {
              if (
                item.txid &&
                item.txid.toLowerCase() ===
                txid.toLowerCase()
              ) {
                throw new Error(
                  "This TXID is already used"
                );
              }
            }

            await verifyWithdrawalTransaction(
              txid,
              withdrawal.address,
              Number(
                withdrawal.amountBase
              )
            );

            withdrawal.status =
              "completed";

            withdrawal.txid =
              txid;

            withdrawal.completedAt =
              nowISO();

            withdrawal.updatedAt =
              nowISO();

            withdrawal.adminTelegramId =
              String(
                req.telegramUser.id
              );

            writeStore(store);

            return withdrawal;
          }
        );

      res.json({
        ok: true,
        message:
          "Withdrawal completed",
        withdrawal: result,
      });
    } catch (error) {
      console.error(
        "ADMIN COMPLETE ERROR:",
        error
      );

      res.status(400).json({
        ok: false,
        error: error.message,
      });
    }
  }
);


/* =========================================================
   ADMIN GET USER
========================================================= */

app.post(
  "/api/admin/user",
  requireAdmin,
  async (req, res) => {
    try {
      const telegramUserId =
        String(
          req.body?.telegramUserId ||
          ""
        ).trim();

      if (!telegramUserId) {
        return res.status(400).json({
          ok: false,
          error:
            "telegramUserId is required",
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
            "User not found",
        });
      }

      res.json({
        ok: true,
        user,
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        ok: false,
        error:
          "Could not load user",
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
      error: "Not found",
    });
  }
);


/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
  (error, req, res, next) => {
    console.error(
      "SERVER ERROR:",
      error
    );

    res.status(500).json({
      ok: false,
      error:
        "Internal server error",
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
      `Big Money Backend running on port ${PORT}`
    );

    console.log(
      `Deposit address: ${DEPOSIT_ADDRESS}`
    );

    console.log(
      `USDT contract: ${USDT_CONTRACT}`
    );

    console.log(
      `Withdrawal source configured: ${Boolean(
        WITHDRAWAL_SOURCE_ADDRESS
      )}`
    );

    console.log(
      `Admin count: ${ADMIN_TELEGRAM_IDS.length}`
    );

    console.log(
      "===================================="
    );
  }
);
