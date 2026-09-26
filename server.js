const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const TronWeb = require("tronweb");

const app = express();

/* =========================================================
   CONFIG
========================================================= */

const PORT = Number(process.env.PORT || 10000);

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || "";

const TELEGRAM_BOT_USERNAME =
  process.env.TELEGRAM_BOT_USERNAME ||
  "bigmoney2026bot";

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

const TRONGRID_URL = (
  process.env.TRONGRID_URL ||
  "https://api.trongrid.io"
).replace(/\/$/, "");

const TRONGRID_API_KEY =
  process.env.TRONGRID_API_KEY || "";

const WITHDRAWAL_SOURCE_ADDRESS =
  process.env.WITHDRAWAL_SOURCE_ADDRESS || "";

const WITHDRAWAL_PRIVATE_KEY =
  process.env.WITHDRAWAL_PRIVATE_KEY || "";

const USDT_DECIMALS = 6;

const MIN_DEPOSIT =
  Number(process.env.MIN_DEPOSIT || 1);

const MIN_WITHDRAWAL =
  Number(process.env.MIN_WITHDRAWAL || 1);

const WITHDRAW_FEE_LIMIT =
  Number(
    process.env.WITHDRAW_FEE_LIMIT ||
    100000000
  );

/* =========================================================
   APP
========================================================= */

app.use(cors({
  origin: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "X-Telegram-Init-Data"
  ]
}));

app.use(express.json({
  limit: "1mb"
}));

/* =========================================================
   DATABASE
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
    deposits: [],
    withdrawals: [],
    referrals: []
  };
}

function ensureStore() {

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(
      DATA_DIR,
      { recursive: true }
    );
  }

  if (!fs.existsSync(DATA_FILE)) {

    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(
        defaultStore(),
        null,
        2
      )
    );

  }

}

function loadStore() {

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
      deposits: data.deposits || [],
      withdrawals:
        data.withdrawals || [],
      referrals:
        data.referrals || []
    };

  } catch (error) {

    console.error(
      "Database read error:",
      error
    );

    return defaultStore();

  }

}

function saveStore() {

  ensureStore();

  const tempFile =
    DATA_FILE + ".tmp";

  fs.writeFileSync(
    tempFile,
    JSON.stringify(
      store,
      null,
      2
    )
  );

  fs.renameSync(
    tempFile,
    DATA_FILE
  );

}

let store = loadStore();

/* Prevent two balance-changing operations
   from running at exactly the same time. */
let operationLock =
  Promise.resolve();

function withLock(fn) {

  const run =
    operationLock.then(fn);

  operationLock =
    run.catch(() => {});

  return run;

}

/* =========================================================
   HELPERS
========================================================= */

function roundUSDT(value) {

  return Math.round(
    Number(value) * 1000000
  ) / 1000000;

}

function randomId(prefix) {

  return (
    prefix +
    "_" +
    Date.now() +
    "_" +
    crypto
      .randomBytes(5)
      .toString("hex")
  );

}

function validTronAddress(address) {

  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/
    .test(
      String(address || "").trim()
    );

}

function getUser(telegramUserId) {

  const id =
    String(
      telegramUserId
    );

  if (!store.users[id]) {

    store.users[id] = {

      telegramUserId: id,

      username: "",

      firstName: "",

      balance: 0,

      reservedBalance: 0,

      points: 0,

      referralCode:
        "ref_" + id,

      referredBy: null,

      referralCount: 0,

      createdAt:
        new Date().toISOString()

    };

  }

  const user =
    store.users[id];

  /* Upgrade older database users */

  if (
    typeof user.balance !==
    "number"
  ) {
    user.balance =
      Number(user.balance || 0);
  }

  if (
    typeof user.reservedBalance !==
    "number"
  ) {
    user.reservedBalance = 0;
  }

  if (
    typeof user.points !==
    "number"
  ) {
    user.points =
      Number(user.points || 0);
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

  return user;

}

/* =========================================================
   TELEGRAM AUTH
========================================================= */

function verifyTelegramInitData(
  initData
) {

  if (!TELEGRAM_BOT_TOKEN) {

    throw new Error(
      "TELEGRAM_BOT_TOKEN is not configured."
    );

  }

  const raw =
    String(
      initData || ""
    );

  if (!raw) {

    throw new Error(
      "Telegram initData is missing."
    );

  }

  const params =
    new URLSearchParams(raw);

  const receivedHash =
    params.get("hash");

  if (!receivedHash) {

    throw new Error(
      "Telegram authentication hash is missing."
    );

  }

  params.delete("hash");

  const dataCheckString =
    Array
      .from(params.entries())
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

  const a =
    Buffer.from(
      calculatedHash,
      "hex"
    );

  const b =
    Buffer.from(
      receivedHash,
      "hex"
    );

  if (
    a.length !== b.length ||
    !crypto.timingSafeEqual(a, b)
  ) {

    throw new Error(
      "Invalid Telegram authentication."
    );

  }

  const authDate =
    Number(
      params.get("auth_date") || 0
    );

  if (!authDate) {

    throw new Error(
      "Telegram auth_date is missing."
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
      "Telegram authentication has expired. Reopen the Mini App."
    );

  }

  let user = {};

  try {

    user =
      JSON.parse(
        params.get("user") || "{}"
      );

  } catch {

    throw new Error(
      "Invalid Telegram user data."
    );

  }

  if (!user.id) {

    throw new Error(
      "Telegram user ID is missing."
    );

  }

  return user;

}

function getTelegramUserFromRequest(
  req
) {

  const initData =
    req.get(
      "X-Telegram-Init-Data"
    );

  return verifyTelegramInitData(
    initData
  );

}

function requireTelegram(
  req,
  res,
  next
) {

  try {

    const tgUser =
      getTelegramUserFromRequest(
        req
      );

    req.telegramUser =
      tgUser;

    next();

  } catch (error) {

    return res.status(401).json({
      ok: false,
      error:
        error.message ||
        "Telegram authentication failed."
    });

  }

}

function isAdminUser(
  telegramUserId
) {

  return ADMIN_TELEGRAM_IDS.includes(
    String(telegramUserId)
  );

}

function requireAdmin(
  req,
  res,
  next
) {

  try {

    const tgUser =
      getTelegramUserFromRequest(
        req
      );

    if (
      !isAdminUser(
        tgUser.id
      )
    ) {

      return res.status(403).json({
        ok: false,
        error:
          "Administrator access denied."
      });

    }

    req.telegramUser =
      tgUser;

    next();

  } catch (error) {

    return res.status(401).json({
      ok: false,
      error:
        error.message ||
        "Telegram authentication failed."
    });

  }

}

/* =========================================================
   TRONGRID
========================================================= */

function tronHeaders() {

  const headers = {
    "Content-Type":
      "application/json"
  };

  if (TRONGRID_API_KEY) {

    headers[
      "TRON-PRO-API-KEY"
    ] =
      TRONGRID_API_KEY;

  }

  return headers;

}

async function tronGet(
  url
) {

  const response =
    await fetch(
      url,
      {
        method: "GET",
        headers:
          tronHeaders()
      }
    );

  const text =
    await response.text();

  let data = {};

  try {

    data =
      text
        ? JSON.parse(text)
        : {};

  } catch {

    data = {};

  }

  if (!response.ok) {

    throw new Error(
      data?.Error ||
      data?.error ||
      `TronGrid HTTP ${response.status}`
    );

  }

  return data;

}

async function tronPost(
  url,
  body
) {

  const response =
    await fetch(
      url,
      {
        method: "POST",
        headers:
          tronHeaders(),
        body:
          JSON.stringify(body)
      }
    );

  const text =
    await response.text();

  let data = {};

  try {

    data =
      text
        ? JSON.parse(text)
        : {};

  } catch {

    data = {};

  }

  if (!response.ok) {

    throw new Error(
      data?.Error ||
      data?.error ||
      `TronGrid HTTP ${response.status}`
    );

  }

  return data;

}

/* =========================================================
   TRON WEB
========================================================= */

let tronWeb = null;

function getTronWeb() {

  if (
    !WITHDRAWAL_PRIVATE_KEY
  ) {

    throw new Error(
      "WITHDRAWAL_PRIVATE_KEY is not configured."
    );

  }

  if (
    !WITHDRAWAL_SOURCE_ADDRESS
  ) {

    throw new Error(
      "WITHDRAWAL_SOURCE_ADDRESS is not configured."
    );

  }

  if (!tronWeb) {

    tronWeb =
      new TronWeb({
        fullHost:
          TRONGRID_URL,
        privateKey:
          WITHDRAWAL_PRIVATE_KEY
      });

  }

  return tronWeb;

}

/* =========================================================
   BASIC
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
        "admin-withdraw-v2"
    });

  }
);

app.get(
  "/api/config",
  (req, res) => {

    res.json({
      ok: true,
      network:
        "TRON",
      token:
        "USDT",
      standard:
        "TRC20",
      depositAddress:
        DEPOSIT_ADDRESS,
      usdtContract:
        USDT_CONTRACT,
      minDeposit:
        MIN_DEPOSIT,
      minWithdrawal:
        MIN_WITHDRAWAL
    });

  }
);

/* =========================================================
   ACCOUNT
========================================================= */

app.get(
  "/api/account",
  requireTelegram,
  (req, res) => {

    const tgUser =
      req.telegramUser;

    const user =
      getUser(
        tgUser.id
      );

    user.username =
      tgUser.username ||
      user.username ||
      "";

    user.firstName =
      tgUser.first_name ||
      user.firstName ||
      "";

    saveStore();

    res.json({

      ok: true,

      account: {

        telegramUserId:
          user.telegramUserId,

        username:
          user.username ||
          user.firstName ||
          "User",

        firstName:
          user.firstName,

        availableBalance:
          roundUSDT(
            user.balance
          ),

        reservedBalance:
          roundUSDT(
            user.reservedBalance
          ),

        referralPoints:
          Number(
            user.points || 0
          ),

        referralCount:
          Number(
            user.referralCount || 0
          )

      }

    });

  }
);

/* =========================================================
   OLD USER ROUTE
========================================================= */

app.get(
  "/api/user/:telegramUserId",
  requireTelegram,
  (req, res) => {

    const requestedId =
      String(
        req.params.telegramUserId
      );

    if (
      requestedId !==
      String(
        req.telegramUser.id
      )
    ) {

      return res.status(403).json({
        ok: false,
        error:
          "You can only access your own account."
      });

    }

    const user =
      getUser(
        requestedId
      );

    saveStore();

    res.json({
      ok: true,
      user: {
        telegramUserId:
          user.telegramUserId,
        balance:
          roundUSDT(
            user.balance
          ),
        points:
          user.points,
        referralCode:
          user.referralCode,
        referralCount:
          user.referralCount
      }
    });

  }
);

/* =========================================================
   REFERRAL
========================================================= */

app.get(
  "/api/referral",
  requireTelegram,
  (req, res) => {

    const user =
      getUser(
        req.telegramUser.id
      );

    const link =
      `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${user.referralCode}`;

    res.json({

      ok: true,

      referralLink:
        link,

      referralCode:
        user.referralCode,

      referralCount:
        Number(
          user.referralCount || 0
        ),

      points:
        Number(
          user.points || 0
        )

    });

  }
);

/* =========================================================
   DEPOSIT REQUEST
========================================================= */

function generatePaymentAmount(
  baseAmount
) {

  const base =
    Number(baseAmount);

  for (
    let attempt = 0;
    attempt < 100;
    attempt++
  ) {

    const random =
      Math.floor(
        Math.random() * 900
      ) + 100;

    const paymentAmount =
      roundUSDT(
        base +
        random / 1000000
      );

    const exists =
      store.deposits.some(
        d =>
          d.status === "pending" &&
          Number(
            d.paymentAmount
          ) === paymentAmount
      );

    if (!exists) {

      return paymentAmount;

    }

  }

  return roundUSDT(
    base +
    0.000999
  );

}

app.post(
  "/api/deposits/request",
  requireTelegram,
  (req, res) => {

    const amount =
      Number(
        req.body?.amount
      );

    if (
      !Number.isFinite(amount) ||
      amount < MIN_DEPOSIT
    ) {

      return res.status(400).json({
        ok: false,
        error:
          `Minimum deposit is ${MIN_DEPOSIT} USDT.`
      });

    }

    const paymentAmount =
      generatePaymentAmount(
        amount
      );

    const deposit = {

      id:
        randomId("dep"),

      telegramUserId:
        String(
          req.telegramUser.id
        ),

      requestedAmount:
        roundUSDT(amount),

      paymentAmount,

      address:
        DEPOSIT_ADDRESS,

      status:
        "pending",

      createdAt:
        new Date().toISOString()

    };

    store.deposits.push(
      deposit
    );

    saveStore();

    res.json({
      ok: true,
      deposit
    });

  }
);

/* =========================================================
   FIND CONFIRMED USDT TRANSFER
========================================================= */

async function findDepositTransfer(
  paymentAmount,
  afterTimestamp
) {

  const url =
    `${TRONGRID_URL}/v1/accounts/${DEPOSIT_ADDRESS}` +
    `/transactions/trc20` +
    `?limit=200` +
    `&only_confirmed=true` +
    `&contract_address=${encodeURIComponent(
      USDT_CONTRACT
    )}` +
    `&only_to=true`;

  const data =
    await tronGet(url);

  const expected =
    roundUSDT(
      Number(paymentAmount)
    );

  const after =
    new Date(
      afterTimestamp
    ).getTime();

  const transfers =
    (data.data || [])
      .filter(
        tx =>
          String(
            tx.to || ""
          ).toLowerCase() ===
          DEPOSIT_ADDRESS.toLowerCase()
      )
      .filter(
        tx =>
          String(
            tx.token_info?.address ||
            USDT_CONTRACT
          ).toLowerCase() ===
          USDT_CONTRACT.toLowerCase()
      )
      .filter(
        tx =>
          tx.success !== false
      )
      .filter(
        tx =>
          roundUSDT(
            Number(tx.value || 0) /
            1000000
          ) === expected
      )
      .filter(
        tx =>
          !after ||
          Number(
            tx.block_timestamp || 0
          ) >= after
      );

  return transfers[0] || null;

}

/* =========================================================
   CHECK DEPOSIT
========================================================= */

app.post(
  "/api/deposits/check",
  requireTelegram,
  async (req, res) => {

    try {

      const userId =
        String(
          req.telegramUser.id
        );

      const depositId =
        String(
          req.body?.depositId || ""
        );

      if (!depositId) {

        return res.status(400).json({
          ok: false,
          error:
            "depositId is required."
        });

      }

      const deposit =
        store.deposits.find(
          d =>
            d.id === depositId &&
            String(
              d.telegramUserId
            ) === userId
        );

      if (!deposit) {

        return res.status(404).json({
          ok: false,
          error:
            "Deposit request not found."
        });

      }

      if (
        deposit.status ===
        "confirmed"
      ) {

        const user =
          getUser(userId);

        return res.json({

          ok: true,

          status:
            "confirmed",

          deposit,

          balance:
            roundUSDT(
              user.balance
            )

        });

      }

      const transfer =
        await findDepositTransfer(
          deposit.paymentAmount,
          deposit.createdAt
        );

      if (!transfer) {

        return res.json({

          ok: true,

          status:
            "pending",

          message:
            "Payment has not been detected yet."

        });

      }

      const txid =
        String(
          transfer.transaction_id
        );

      const alreadyUsed =
        store.deposits.some(
          d =>
            String(
              d.txid || ""
            ).toLowerCase() ===
            txid.toLowerCase() &&
            d.status ===
            "confirmed"
        );

      if (alreadyUsed) {

        return res.status(400).json({
          ok: false,
          error:
            "This blockchain transaction has already been credited."
        });

      }

      const amount =
        roundUSDT(
          Number(
            transfer.value || 0
          ) / 1000000
        );

      const user =
        getUser(userId);

      user.balance =
        roundUSDT(
          Number(user.balance) +
          amount
        );

      deposit.status =
        "confirmed";

      deposit.txid =
        txid;

      deposit.amount =
        amount;

      deposit.from =
        transfer.from;

      deposit.blockTimestamp =
        transfer.block_timestamp;

      deposit.confirmedAt =
        new Date().toISOString();

      saveStore();

      console.log(
        "DEPOSIT CONFIRMED:",
        amount,
        "USDT",
        "user:",
        userId,
        "txid:",
        txid
      );

      res.json({

        ok: true,

        status:
          "confirmed",

        deposit,

        balance:
          roundUSDT(
            user.balance
          )

      });

    } catch (error) {

      console.error(
        "Deposit check error:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          error.message ||
          "Deposit check failed."
      });

    }

  }
);

/* =========================================================
   MANUAL TXID DEPOSIT
   Kept for compatibility with older HTML
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

      const expectedAmount =
        Number(
          req.body?.amount
        );

      if (
        !/^[a-fA-F0-9]{64}$/
          .test(txid)
      ) {

        return res.status(400).json({
          ok: false,
          error:
            "Invalid TRON TXID."
        });

      }

      if (
        !Number.isFinite(
          expectedAmount
        ) ||
        expectedAmount <= 0
      ) {

        return res.status(400).json({
          ok: false,
          error:
            "Invalid amount."
        });

      }

      const already =
        store.deposits.find(
          d =>
            String(
              d.txid || ""
            ).toLowerCase() ===
            txid.toLowerCase()
        );

      if (already) {

        return res.json({
          ok: true,
          alreadyProcessed: true,
          deposit: already
        });

      }

      const txInfo =
        await tronPost(
          `${TRONGRID_URL}/walletsolidity/gettransactionbyid`,
          {
            value: txid
          }
        );

      if (
        !txInfo ||
        !txInfo.txID
      ) {

        return res.status(400).json({
          ok: false,
          error:
            "Confirmed transaction not found."
        });

      }

      const url =
        `${TRONGRID_URL}/v1/accounts/${DEPOSIT_ADDRESS}` +
        `/transactions/trc20` +
        `?limit=200` +
        `&only_confirmed=true` +
        `&contract_address=${encodeURIComponent(
          USDT_CONTRACT
        )}` +
        `&only_to=true`;

      const data =
        await tronGet(url);

      const tx =
        (data.data || []).find(
          x =>
            String(
              x.transaction_id || ""
            ).toLowerCase() ===
            txid.toLowerCase()
        );

      if (!tx) {

        return res.status(400).json({
          ok: false,
          error:
            "Confirmed USDT transfer to the deposit address was not found."
        });

      }

      const actualAmount =
        roundUSDT(
          Number(
            tx.value || 0
          ) / 1000000
        );

      if (
        Math.abs(
          actualAmount -
          expectedAmount
        ) > 0.000001
      ) {

        return res.status(400).json({
          ok: false,
          error:
            `Amount mismatch. Blockchain shows ${actualAmount} USDT.`,
          actualAmount
        });

      }

      const user =
        getUser(
          req.telegramUser.id
        );

      user.balance =
        roundUSDT(
          Number(user.balance) +
          actualAmount
        );

      const deposit = {

        id:
          randomId("dep"),

        telegramUserId:
          String(
            req.telegramUser.id
          ),

        txid,

        amount:
          actualAmount,

        from:
          tx.from,

        to:
          tx.to,

        status:
          "confirmed",

        blockTimestamp:
          tx.block_timestamp,

        createdAt:
          new Date().toISOString()

      };

      store.deposits.push(
        deposit
      );

      saveStore();

      res.json({

        ok: true,

        verified: true,

        deposit,

        balance:
          roundUSDT(
            user.balance
          )

      });

    } catch (error) {

      console.error(
        "Verify TXID error:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          error.message ||
          "TXID verification failed."
      });

    }

  }
);

/* =========================================================
   SCAN DEPOSITS
========================================================= */

app.get(
  "/api/deposits/scan",
  requireAdmin,
  async (req, res) => {

    try {

      const limit =
        Math.min(
          Math.max(
            Number(
              req.query.limit || 20
            ),
            1
          ),
          200
        );

      const url =
        `${TRONGRID_URL}/v1/accounts/${DEPOSIT_ADDRESS}` +
        `/transactions/trc20` +
        `?limit=${limit}` +
        `&only_confirmed=true` +
        `&contract_address=${encodeURIComponent(
          USDT_CONTRACT
        )}` +
        `&only_to=true`;

      const data =
        await tronGet(url);

      res.json({

        ok: true,

        deposits:
          data.data || []

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
   WITHDRAWAL REQUEST
========================================================= */

app.post(
  "/api/withdrawals/request",
  requireTelegram,
  async (req, res) => {

    try {

      const result =
        await withLock(
          async () => {

            const userId =
              String(
                req.telegramUser.id
              );

            const address =
              String(
                req.body?.address ||
                ""
              ).trim();

            const amount =
              Number(
                req.body?.amount
              );

            if (
              !validTronAddress(
                address
              )
            ) {

              throw new Error(
                "Invalid TRON TRC20 address."
              );

            }

            if (
              !Number.isFinite(
                amount
              ) ||
              amount <= 0
            ) {

              throw new Error(
                "Enter a valid withdrawal amount."
              );

            }

            if (
              amount <
              MIN_WITHDRAWAL
            ) {

              throw new Error(
                `Minimum withdrawal is ${MIN_WITHDRAWAL} USDT.`
              );

            }

            const user =
              getUser(userId);

            const available =
              roundUSDT(
                user.balance
              );

            if (
              available <
              amount
            ) {

              throw new Error(
                "Insufficient available balance."
              );

            }

            const withdrawal = {

              id:
                randomId("wd"),

              telegramUserId:
                userId,

              username:
                req.telegramUser.username ||
                req.telegramUser.first_name ||
                "User",

              address,

              amount:
                roundUSDT(amount),

              status:
                "pending",

              createdAt:
                new Date().toISOString(),

              txid:
                null,

              adminNote:
                ""

            };

            /*
              Move money from AVAILABLE
              to RESERVED.

              It is NOT sent yet.
            */

            user.balance =
              roundUSDT(
                Number(user.balance) -
                amount
              );

            user.reservedBalance =
              roundUSDT(
                Number(
                  user.reservedBalance
                ) +
                amount
              );

            store.withdrawals.push(
              withdrawal
            );

            saveStore();

            return {

              withdrawal,

              balance:
                roundUSDT(
                  user.balance
                ),

              reservedBalance:
                roundUSDT(
                  user.reservedBalance
                )

            };

          }
        );

      res.json({

        ok: true,

        withdrawal:
          result.withdrawal,

        balance:
          result.balance,

        reservedBalance:
          result.reservedBalance,

        message:
          "Withdrawal request is pending administrator approval."

      });

    } catch (error) {

      console.error(
        "Withdrawal request error:",
        error
      );

      res.status(400).json({
        ok: false,
        error:
          error.message ||
          "Withdrawal request failed."
      });

    }

  }
);

/* =========================================================
   USER WITHDRAWAL HISTORY
========================================================= */

app.get(
  "/api/withdrawals",
  requireTelegram,
  (req, res) => {

    const userId =
      String(
        req.telegramUser.id
      );

    const withdrawals =
      store.withdrawals
        .filter(
          x =>
            String(
              x.telegramUserId
            ) === userId
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
   ADMIN STATUS
========================================================= */

app.get(
  "/api/admin/status",
  requireAdmin,
  (req, res) => {

    res.json({
      ok: true,
      admin: true,
      telegramUserId:
        String(
          req.telegramUser.id
        )
    });

  }
);

/* =========================================================
   ADMIN WITHDRAWALS
========================================================= */

app.get(
  "/api/admin/withdrawals",
  requireAdmin,
  (req, res) => {

    const withdrawals =
      store.withdrawals
        .filter(
          x =>
            x.status ===
            "pending"
        )
        .sort(
          (a, b) =>
            new Date(a.createdAt) -
            new Date(b.createdAt)
        )
        .map(
          x => {

            const user =
              store.users[
                String(
                  x.telegramUserId
                )
              ];

            return {

              ...x,

              username:
                x.username ||
                user?.username ||
                user?.firstName ||
                "User"

            };

          }
        );

    res.json({

      ok: true,

      withdrawals

    });

  }
);

/* =========================================================
   SEND USDT
========================================================= */

async function sendUSDT(
  destination,
  amount
) {

  if (
    !validTronAddress(
      destination
    )
  ) {

    throw new Error(
      "Invalid destination address."
    );

  }

  const tron =
    getTronWeb();

  const source =
    WITHDRAWAL_SOURCE_ADDRESS;

  const sourceFromKey =
    tron.address.fromPrivateKey(
      WITHDRAWAL_PRIVATE_KEY
    );

  if (
    String(
      sourceFromKey
    ).toLowerCase() !==
    String(source)
      .toLowerCase()
  ) {

    throw new Error(
      "WITHDRAWAL_PRIVATE_KEY does not belong to WITHDRAWAL_SOURCE_ADDRESS."
    );

  }

  const contract =
    await tron
      .contract()
      .at(
        USDT_CONTRACT
      );

  const tokenAmount =
    Math.round(
      Number(amount) *
      Math.pow(
        10,
        USDT_DECIMALS
      )
    );

  if (
    !Number.isSafeInteger(
      tokenAmount
    ) ||
    tokenAmount <= 0
  ) {

    throw new Error(
      "Invalid USDT amount."
    );

  }

  console.log(
    "Sending USDT:",
    amount,
    "from:",
    source,
    "to:",
    destination
  );

  const txid =
    await contract
      .transfer(
        destination,
        tokenAmount
      )
      .send({
        feeLimit:
          WITHDRAW_FEE_LIMIT
      });

  return String(
    txid
  );

}

/* =========================================================
   ADMIN APPROVE + SEND
========================================================= */

app.post(
  "/api/admin/withdrawals/:id/approve",
  requireAdmin,
  async (req, res) => {

    try {

      const result =
        await withLock(
          async () => {

            const id =
              String(
                req.params.id
              );

            const withdrawal =
              store.withdrawals.find(
                x =>
                  x.id === id
              );

            if (!withdrawal) {

              throw new Error(
                "Withdrawal request not found."
              );

            }

            if (
              withdrawal.status !==
              "pending"
            ) {

              throw new Error(
                `Withdrawal is already ${withdrawal.status}.`
              );

            }

            const user =
              getUser(
                withdrawal.telegramUserId
              );

            const amount =
              Number(
                withdrawal.amount
              );

            if (
              Number(
                user.reservedBalance
              ) < amount
            ) {

              throw new Error(
                "Reserved balance is insufficient for this withdrawal."
              );

            }

            /*
              IMPORTANT:
              Status remains pending while the
              blockchain transaction is being sent.
            */

            withdrawal.processingAt =
              new Date().toISOString();

            saveStore();

            let txid;

            try {

              txid =
                await sendUSDT(
                  withdrawal.address,
                  amount
                );

            } catch (sendError) {

              delete withdrawal.processingAt;

              saveStore();

              throw sendError;

            }

            /*
              Blockchain send succeeded.
              Now finalize the balance.
            */

            user.reservedBalance =
              roundUSDT(
                Number(
                  user.reservedBalance
                ) -
                amount
              );

            withdrawal.status =
              "sent";

            withdrawal.txid =
              txid;

            withdrawal.approvedBy =
              String(
                req.telegramUser.id
              );

            withdrawal.approvedAt =
              new Date().toISOString();

            withdrawal.sentAt =
              new Date().toISOString();

            delete withdrawal.processingAt;

            saveStore();

            return {

              withdrawal,

              txid,

              balance:
                roundUSDT(
                  user.balance
                ),

              reservedBalance:
                roundUSDT(
                  user.reservedBalance
                )

            };

          }
        );

      console.log(
        "WITHDRAWAL SENT:",
        result.withdrawal.id,
        result.txid
      );

      res.json({

        ok: true,

        withdrawal:
          result.withdrawal,

        txid:
          result.txid,

        balance:
          result.balance,

        reservedBalance:
          result.reservedBalance

      });

    } catch (error) {

      console.error(
        "Approve withdrawal error:",
        error
      );

      res.status(400).json({
        ok: false,
        error:
          error.message ||
          "Could not approve withdrawal."
      });

    }

  }
);

/* =========================================================
   ADMIN REJECT
========================================================= */

app.post(
  "/api/admin/withdrawals/:id/reject",
  requireAdmin,
  async (req, res) => {

    try {

      const result =
        await withLock(
          async () => {

            const id =
              String(
                req.params.id
              );

            const withdrawal =
              store.withdrawals.find(
                x =>
                  x.id === id
              );

            if (!withdrawal) {

              throw new Error(
                "Withdrawal request not found."
              );

            }

            if (
              withdrawal.status !==
              "pending"
            ) {

              throw new Error(
                `Withdrawal is already ${withdrawal.status}.`
              );

            }

            const user =
              getUser(
                withdrawal.telegramUserId
              );

            const amount =
              Number(
                withdrawal.amount
              );

            if (
              Number(
                user.reservedBalance
              ) < amount
            ) {

              throw new Error(
                "Reserved balance is inconsistent."
              );

            }

            /*
              Return reserved money
              back to available balance.
            */

            user.reservedBalance =
              roundUSDT(
                Number(
                  user.reservedBalance
                ) -
                amount
              );

            user.balance =
              roundUSDT(
                Number(
                  user.balance
                ) +
                amount
              );

            withdrawal.status =
              "rejected";

            withdrawal.adminNote =
              String(
                req.body?.note || ""
              ).slice(
                0,
                500
              );

            withdrawal.rejectedBy =
              String(
                req.telegramUser.id
              );

            withdrawal.rejectedAt =
              new Date().toISOString();

            saveStore();

            return {

              withdrawal,

              balance:
                roundUSDT(
                  user.balance
                ),

              reservedBalance:
                roundUSDT(
                  user.reservedBalance
                )

            };

          }
        );

      res.json({

        ok: true,

        withdrawal:
          result.withdrawal,

        balance:
          result.balance,

        reservedBalance:
          result.reservedBalance,

        message:
          "Withdrawal rejected. Funds returned to the user's available balance."

      });

    } catch (error) {

      console.error(
        "Reject withdrawal error:",
        error
      );

      res.status(400).json({
        ok: false,
        error:
          error.message ||
          "Could not reject withdrawal."
      });

    }

  }
);

/* =========================================================
   ADMIN USERS
========================================================= */

app.get(
  "/api/admin/users",
  requireAdmin,
  (req, res) => {

    const users =
      Object.values(
        store.users
      ).map(
        user => ({

          telegramUserId:
            user.telegramUserId,

          username:
            user.username ||
            user.firstName ||
            "User",

          balance:
            roundUSDT(
              user.balance
            ),

          reservedBalance:
            roundUSDT(
              user.reservedBalance
            ),

          referralCount:
            user.referralCount || 0,

          points:
            user.points || 0

        })
      );

    res.json({

      ok: true,

      users

    });

  }
);

/* =========================================================
   ADMIN DEPOSITS
========================================================= */

app.get(
  "/api/admin/deposits",
  requireAdmin,
  (req, res) => {

    res.json({

      ok: true,

      deposits:
        store.deposits
          .slice()
          .reverse()

    });

  }
);

/* =========================================================
   HEALTH
========================================================= */

app.get(
  "/api/health",
  (req, res) => {

    res.json({

      ok: true,

      service:
        "Big Money Backend",

      network:
        "TRON TRC20",

      telegramConfigured:
        Boolean(
          TELEGRAM_BOT_TOKEN
        ),

      adminConfigured:
        ADMIN_TELEGRAM_IDS.length > 0,

      tronGridConfigured:
        Boolean(
          TRONGRID_API_KEY
        ),

      withdrawalAddressConfigured:
        Boolean(
          WITHDRAWAL_SOURCE_ADDRESS
        ),

      withdrawalPrivateKeyConfigured:
        Boolean(
          WITHDRAWAL_PRIVATE_KEY
        )

    });

  }
);

/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
  (err, req, res, next) => {

    console.error(
      "Unhandled error:",
      err
    );

    res.status(500).json({

      ok: false,

      error:
        "Internal server error"

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
      "===================================="
    );

    console.log(
      "Big Money Backend"
    );

    console.log(
      "Port:",
      PORT
    );

    console.log(
      "Network: TRON TRC20"
    );

    console.log(
      "Deposit:",
      DEPOSIT_ADDRESS
    );

    console.log(
      "USDT:",
      USDT_CONTRACT
    );

    console.log(
      "Telegram:",
      TELEGRAM_BOT_TOKEN
        ? "configured"
        : "NOT CONFIGURED"
    );

    console.log(
      "Admin IDs:",
      ADMIN_TELEGRAM_IDS.length
        ? "configured"
        : "NOT CONFIGURED"
    );

    console.log(
      "TronGrid API:",
      TRONGRID_API_KEY
        ? "configured"
        : "not configured"
    );

    console.log(
      "Withdrawal source:",
      WITHDRAWAL_SOURCE_ADDRESS
        ? "configured"
        : "NOT CONFIGURED"
    );

    console.log(
      "Withdrawal private key:",
      WITHDRAWAL_PRIVATE_KEY
        ? "configured"
        : "NOT CONFIGURED"
    );

    console.log(
      "===================================="
    );

  }
);
