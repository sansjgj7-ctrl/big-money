const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 10000;

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || "";

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

const TRONGRID_URL =
  process.env.TRONGRID_URL ||
  "https://api.trongrid.io";

const TRONGRID_API_KEY =
  process.env.TRONGRID_API_KEY || "";

const ALLOWED_ORIGIN =
  process.env.ALLOWED_ORIGIN ||
  "https://sansjgj7-ctrl.github.io";

const USDT_DECIMALS = 6;

const REFERRAL_REWARD_POINTS = 3;
const DAILY_REWARD_POINTS = 0.5;
const QUALIFYING_DEPOSIT = 10;
const REQUIRED_REFERRALS = 5;

/*
=========================================================
POINT CONVERSION
=========================================================
1 Point = 1 USDT
=========================================================
*/

const POINT_USDT_RATE = 1;


/*
=========================================================
MIDDLEWARE
=========================================================
*/

app.use(
  cors({
    origin: ALLOWED_ORIGIN,
    methods: [
      "GET",
      "POST",
      "OPTIONS"
    ],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Telegram-Init-Data"
    ]
  })
);

app.use(
  express.json({
    limit: "100kb"
  })
);


/*
=========================================================
DATABASE
=========================================================
*/

const DATA_DIR =
  path.join(__dirname, "data");

const DATA_FILE =
  path.join(
    DATA_DIR,
    "big-money-data.json"
  );


function defaultDB(){

  return {
    users: [],
    deposits: [],
    withdrawals: [],
    usedTransactions: [],
    pointConversions: []
  };
}


function ensureDataDir(){

  if(
    !fs.existsSync(DATA_DIR)
  ){

    fs.mkdirSync(
      DATA_DIR,
      {
        recursive:true
      }
    );
  }
}


function loadDB(){

  try{

    ensureDataDir();

    if(
      !fs.existsSync(DATA_FILE)
    ){

      const db =
        defaultDB();

      fs.writeFileSync(
        DATA_FILE,
        JSON.stringify(
          db,
          null,
          2
        )
      );

      return db;
    }


    const raw =
      fs.readFileSync(
        DATA_FILE,
        "utf8"
      );


    const parsed =
      JSON.parse(raw);


    const db = {
      ...defaultDB(),
      ...parsed
    };


    if(
      !Array.isArray(db.users)
    ){
      db.users = [];
    }

    if(
      !Array.isArray(db.deposits)
    ){
      db.deposits = [];
    }

    if(
      !Array.isArray(db.withdrawals)
    ){
      db.withdrawals = [];
    }

    if(
      !Array.isArray(db.usedTransactions)
    ){
      db.usedTransactions = [];
    }

    if(
      !Array.isArray(db.pointConversions)
    ){
      db.pointConversions = [];
    }


    return db;

  }catch(error){

    console.error(
      "Database load error:",
      error
    );

    return defaultDB();
  }
}


let db =
  loadDB();


function saveDB(){

  ensureDataDir();

  const tempFile =
    DATA_FILE + ".tmp";

  fs.writeFileSync(
    tempFile,
    JSON.stringify(
      db,
      null,
      2
    )
  );

  fs.renameSync(
    tempFile,
    DATA_FILE
  );
}


/*
=========================================================
HELPERS
=========================================================
*/

function nowISO(){

  return new Date().toISOString();
}


function roundNumber(
  value,
  decimals = 6
){

  const factor =
    Math.pow(
      10,
      decimals
    );

  return (
    Math.round(
      Number(value) * factor
    ) / factor
  );
}


function makeId(
  prefix
){

  return (
    prefix +
    "_" +
    crypto.randomBytes(12).toString("hex")
  );
}


function constantTimeEqual(
  a,
  b
){

  const A =
    Buffer.from(
      String(a || "")
    );

  const B =
    Buffer.from(
      String(b || "")
    );

  if(
    A.length !== B.length
  ){
    return false;
  }

  return crypto.timingSafeEqual(
    A,
    B
  );
}


/*
=========================================================
KABUL DAY
=========================================================
*/

function getKabulDate(){

  const formatter =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:"Asia/Kabul",
        year:"numeric",
        month:"2-digit",
        day:"2-digit"
      }
    );

  return formatter.format(
    new Date()
  );
}


/*
=========================================================
TELEGRAM WEB APP AUTH
=========================================================
*/

function verifyTelegramInitData(
  initData
){

  if(
    !TELEGRAM_BOT_TOKEN
  ){

    throw new Error(
      "TELEGRAM_BOT_TOKEN is not configured."
    );
  }


  if(
    !initData ||
    typeof initData !== "string"
  ){

    throw new Error(
      "Telegram authentication data is missing."
    );
  }


  const params =
    new URLSearchParams(
      initData
    );


  const hash =
    params.get("hash");


  if(!hash){

    throw new Error(
      "Telegram authentication hash is missing."
    );
  }


  params.delete("hash");


  const dataCheckString =
    Array.from(params.entries())
      .sort(
        ([a],[b]) =>
          a.localeCompare(b)
      )
      .map(
        ([key,value]) =>
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


  if(
    !constantTimeEqual(
      calculatedHash,
      hash
    )
  ){

    throw new Error(
      "Invalid Telegram authentication."
    );
  }


  const authDate =
    Number(
      params.get("auth_date") || 0
    );


  if(
    !authDate
  ){

    throw new Error(
      "Telegram auth_date is missing."
    );
  }


  const age =
    Math.floor(
      Date.now() / 1000
    ) - authDate;


  if(
    age < 0 ||
    age > 86400
  ){

    throw new Error(
      "Telegram authentication has expired."
    );
  }


  const userRaw =
    params.get("user");


  if(!userRaw){

    throw new Error(
      "Telegram user information is missing."
    );
  }


  let user;

  try{

    user =
      JSON.parse(
        userRaw
      );

  }catch{

    throw new Error(
      "Invalid Telegram user data."
    );
  }


  if(
    !user ||
    !user.id
  ){

    throw new Error(
      "Invalid Telegram user."
    );
  }


  return {

    telegramUserId:
      String(user.id),

    username:
      user.username ||
      "",

    firstName:
      user.first_name ||
      "",

    lastName:
      user.last_name ||
      "",

    startParam:
      params.get("start_param") ||
      params.get("startapp") ||
      ""

  };
}


/*
=========================================================
TELEGRAM AUTH MIDDLEWARE
=========================================================
*/

function telegramAuth(
  req,
  res,
  next
){

  try{

    const initData =
      req.get(
        "X-Telegram-Init-Data"
      );


    const telegramUser =
      verifyTelegramInitData(
        initData
      );


    req.telegramUser =
      telegramUser;


    const user =
      ensureUser(
        telegramUser.telegramUserId,
        telegramUser.username,
        telegramUser
      );


    req.appUser =
      user;


    registerReferral(
      user,
      telegramUser.startParam
    );


    next();

  }catch(error){

    console.error(
      "Telegram auth error:",
      error.message
    );

    return res
      .status(401)
      .json({
        ok:false,
        message:
          error.message ||
          "Telegram authentication failed."
      });
  }
}


/*
=========================================================
USER
=========================================================
*/

function ensureUser(
  telegramUserId,
  username = "",
  telegramUser = {}
){

  const id =
    String(
      telegramUserId
    );


  let user =
    db.users.find(
      x =>
        String(x.telegramUserId) === id
    );


  if(!user){

    user = {

      telegramUserId:id,

      username:
        username || "",

      firstName:
        telegramUser.firstName ||
        "",

      lastName:
        telegramUser.lastName ||
        "",

      balance:0,

      points:0,

      referrals:[],

      totalInvited:0,

      successfulReferrals:0,

      referredBy:null,

      referralRewardGiven:false,

      dailyRewards:[],

      createdAt:
        nowISO(),

      updatedAt:
        nowISO()
    };


    db.users.push(
      user
    );

    saveDB();

  }else{

    if(username){
      user.username =
        username;
    }

    if(
      telegramUser.firstName
    ){
      user.firstName =
        telegramUser.firstName;
    }

    if(
      telegramUser.lastName
    ){
      user.lastName =
        telegramUser.lastName;
    }

    if(
      !Array.isArray(
        user.referrals
      )
    ){
      user.referrals = [];
    }

    if(
      !Array.isArray(
        user.dailyRewards
      )
    ){
      user.dailyRewards = [];
    }

    if(
      typeof user.balance !==
      "number"
    ){

      user.balance =
        Number(
          user.balance || 0
        );
    }

    if(
      typeof user.points !==
      "number"
    ){

      user.points =
        Number(
          user.points || 0
        );
    }

    if(
      typeof user.successfulReferrals !==
      "number"
    ){

      user.successfulReferrals =
        0;
    }

    if(
      typeof user.totalInvited !==
      "number"
    ){

      user.totalInvited =
        user.referrals.length;
    }
  }


  return user;
}


/*
=========================================================
REFERRAL REGISTRATION
=========================================================
*/

function cleanReferralId(
  value
){

  if(!value){
    return "";
  }

  let id =
    String(value).trim();


  if(
    id.startsWith("ref_")
  ){

    id =
      id.substring(4);
  }


  if(
    id.startsWith("ref")
  ){

    id =
      id.substring(3);
  }


  return id;
}


function registerReferral(
  user,
  startParam
){

  if(!startParam){
    return;
  }


  const referrerId =
    cleanReferralId(
      startParam
    );


  if(!referrerId){
    return;
  }


  if(
    String(referrerId) ===
    String(user.telegramUserId)
  ){

    return;
  }


  if(user.referredBy){
    return;
  }


  const referrer =
    db.users.find(
      x =>
        String(
          x.telegramUserId
        ) ===
        String(referrerId)
    );


  if(!referrer){
    return;
  }


  user.referredBy =
    String(
      referrer.telegramUserId
    );


  if(
    !Array.isArray(
      referrer.referrals
    )
  ){

    referrer.referrals = [];
  }


  const already =
    referrer.referrals.some(
      x =>
        String(
          x.telegramUserId
        ) ===
        String(
          user.telegramUserId
        )
    );


  if(!already){

    referrer.referrals.push({

      telegramUserId:
        String(
          user.telegramUserId
        ),

      username:
        user.username || "",

      successful:false,

      rewardGiven:false,

      createdAt:
        nowISO()

    });


    referrer.totalInvited =
      referrer.referrals.length;
  }


  user.updatedAt =
    nowISO();

  referrer.updatedAt =
    nowISO();


  saveDB();
}


/*
=========================================================
REFERRAL REWARD
=========================================================
*/

function applyReferralReward(
  depositedUser
){

  if(
    !depositedUser.referredBy
  ){

    return 0;
  }


  if(
    depositedUser.referralRewardGiven
  ){

    return 0;
  }


  const referrer =
    db.users.find(
      x =>
        String(
          x.telegramUserId
        ) ===
        String(
          depositedUser.referredBy
        )
    );


  if(!referrer){
    return 0;
  }


  if(
    String(
      referrer.telegramUserId
    ) ===
    String(
      depositedUser.telegramUserId
    )
  ){

    return 0;
  }


  if(
    !Array.isArray(
      referrer.referrals
    )
  ){

    referrer.referrals = [];
  }


  let referral =
    referrer.referrals.find(
      x =>
        String(
          x.telegramUserId
        ) ===
        String(
          depositedUser.telegramUserId
        )
    );


  if(!referral){

    referral = {

      telegramUserId:
        String(
          depositedUser.telegramUserId
        ),

      username:
        depositedUser.username ||
        "",

      successful:false,

      rewardGiven:false,

      createdAt:
        nowISO()

    };


    referrer.referrals.push(
      referral
    );
  }


  if(
    referral.rewardGiven
  ){

    depositedUser.referralRewardGiven =
      true;

    return 0;
  }


  referrer.points =
    roundNumber(
      Number(
        referrer.points || 0
      ) +
      REFERRAL_REWARD_POINTS,
      2
    );


  referrer.successfulReferrals =
    Number(
      referrer.successfulReferrals || 0
    ) + 1;


  referral.successful =
    true;

  referral.rewardGiven =
    true;

  referral.successAt =
    nowISO();


  depositedUser.referralRewardGiven =
    true;


  referrer.updatedAt =
    nowISO();

  depositedUser.updatedAt =
    nowISO();


  return REFERRAL_REWARD_POINTS;
}


/*
=========================================================
DAILY REWARD
=========================================================
*/

function applyDailyReward(
  user
){

  const today =
    getKabulDate();


  if(
    !Array.isArray(
      user.dailyRewards
    )
  ){

    user.dailyRewards = [];
  }


  if(
    user.dailyRewards.includes(
      today
    )
  ){

    return 0;
  }


  user.points =
    roundNumber(
      Number(
        user.points || 0
      ) +
      DAILY_REWARD_POINTS,
      2
    );


  user.dailyRewards.push(
    today
  );


  user.updatedAt =
    nowISO();


  return DAILY_REWARD_POINTS;
}


/*
=========================================================
TRON HELPERS
=========================================================
*/

function tronHexToBase58(
  hex
){

  const alphabet =
    "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";


  let num =
    BigInt(
      "0x" + hex
    );


  let output = "";


  while(
    num > 0
  ){

    const remainder =
      Number(
        num % BigInt(58)
      );


    output =
      alphabet[remainder] +
      output;


    num /=
      BigInt(58);
  }


  let leadingZeros = 0;


  for(
    let i = 0;
    i < hex.length;
    i += 2
  ){

    if(
      hex.substring(
        i,
        i + 2
      ) === "00"
    ){

      leadingZeros++;

    }else{

      break;
    }
  }


  return (
    "1".repeat(
      leadingZeros
    ) +
    output
  );
}


function base58CheckDecode(
  address
){

  const alphabet =
    "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";


  let num =
    BigInt(0);


  for(
    const char of address
  ){

    const index =
      alphabet.indexOf(
        char
      );


    if(index < 0){

      throw new Error(
        "Invalid base58 address."
      );
    }


    num =
      num *
      BigInt(58) +
      BigInt(index);
  }


  let hex =
    num.toString(16);


  if(
    hex.length % 2
  ){

    hex =
      "0" + hex;
  }


  while(
    hex.length < 50
  ){

    hex =
      "0" + hex;
  }


  return hex.substring(
    0,
    hex.length - 8
  );
}


function hexToTronAddress(
  value
){

  let hex =
    String(
      value || ""
    ).replace(
      /^0x/,
      ""
    );


  if(
    hex.length > 40
  ){

    hex =
      hex.slice(-40);
  }


  return tronHexToBase58(
    "41" + hex
  );
}


function decodeTransferInput(
  data
){

  const clean =
    String(
      data || ""
    ).replace(
      /^0x/,
      ""
    );


  if(
    !clean.startsWith(
      "a9059cbb"
    )
  ){

    return null;
  }


  if(
    clean.length < 136
  ){

    return null;
  }


  const addressHex =
    clean.substring(
      8 + 24,
      8 + 64
    );


  const amountHex =
    clean.substring(
      8 + 64,
      8 + 128
    );


  const amount =
    BigInt(
      "0x" +
      amountHex
    );


  return {

    recipient:
      hexToTronAddress(
        addressHex
      ),

    amount:
      Number(amount) /
      Math.pow(
        10,
        USDT_DECIMALS
      )

  };
}


/*
=========================================================
TRONGRID
=========================================================
*/

async function tronFetch(
  endpoint,
  options = {}
){

  const headers = {
    "Content-Type":
      "application/json",
    ...(options.headers || {})
  };


  if(
    TRONGRID_API_KEY
  ){

    headers[
      "TRON-PRO-API-KEY"
    ] =
      TRONGRID_API_KEY;
  }


  const response =
    await fetch(
      TRONGRID_URL +
      endpoint,
      {
        ...options,
        headers
      }
    );


  let data = null;


  try{

    data =
      await response.json();

  }catch{

    data = null;
  }


  if(
    !response.ok
  ){

    throw new Error(
      `TronGrid error: ${response.status}`
    );
  }


  return data;
}


/*
=========================================================
VERIFY TRANSACTION
=========================================================
*/

async function findConfirmedUSDTTransfer(
  txid
){

  const transaction =
    await tronFetch(
      "/walletsolidity/gettransactionbyid",
      {
        method:"POST",
        body:
          JSON.stringify({
            value:txid
          })
      }
    );


  if(
    !transaction ||
    !transaction.txID
  ){

    throw new Error(
      "Transaction was not found."
    );
  }


  const info =
    await tronFetch(
      "/walletsolidity/gettransactioninfobyid",
      {
        method:"POST",
        body:
          JSON.stringify({
            value:txid
          })
      }
    );


  if(
    info &&
    info.receipt &&
    info.receipt.result &&
    String(
      info.receipt.result
    ).toUpperCase() !==
    "SUCCESS"
  ){

    throw new Error(
      "Transaction failed on TRON."
    );
  }


  const contracts =
    transaction.raw_data &&
    Array.isArray(
      transaction.raw_data.contract
    )
      ? transaction.raw_data.contract
      : [];


  const contract =
    contracts.find(
      x =>
        x &&
        x.type ===
        "TriggerSmartContract"
    );


  if(
    contract &&
    contract.parameter &&
    contract.parameter.value
  ){

    const value =
      contract.parameter.value;


    const contractAddress =
      value.contract_address;


    const contractHex =
      base58CheckDecode(
        USDT_CONTRACT
      )
      .replace(
        /^41/i,
        ""
      )
      .toLowerCase();


    const actualContractHex =
      String(
        contractAddress || ""
      )
      .replace(
        /^41/i,
        ""
      )
      .toLowerCase();


    if(
      actualContractHex ===
      contractHex
    ){

      const decoded =
        decodeTransferInput(
          value.data
        );


      if(
        decoded &&
        decoded.recipient ===
        DEPOSIT_ADDRESS
      ){

        return {

          txid,

          from:
            value.owner_address
              ? hexToTronAddress(
                  value.owner_address
                )
              : "",

          to:
            decoded.recipient,

          amount:
            decoded.amount,

          confirmed:true

        };
      }
    }
  }


  const events =
    await tronFetch(
      `/v1/transactions/${encodeURIComponent(txid)}/events?only_confirmed=true&event_name=Transfer`
    );


  const eventList =
    Array.isArray(
      events?.data
    )
      ? events.data
      : [];


  const matches =
    eventList.filter(
      event => {

        const result =
          event.result ||
          {};

        const to =
          result.to ||
          event.to ||
          "";

        return (
          String(to) ===
          DEPOSIT_ADDRESS
        );
      }
    );


  if(
    matches.length === 0
  ){

    throw new Error(
      "No confirmed USDT transfer to the deposit address was found."
    );
  }


  if(
    matches.length > 1
  ){

    throw new Error(
      "Multiple matching transfers were found. Please contact admin."
    );
  }


  const event =
    matches[0];

  const result =
    event.result ||
    {};


  const rawValue =
    result.value ||
    event.value ||
    "0";


  let amount;


  try{

    amount =
      Number(
        BigInt(
          String(rawValue)
        )
      ) /
      Math.pow(
        10,
        USDT_DECIMALS
      );

  }catch{

    amount =
      Number(rawValue) /
      Math.pow(
        10,
        USDT_DECIMALS
      );
  }


  return {

    txid,

    from:
      result.from ||
      event.from ||
      "",

    to:
      result.to ||
      event.to ||
      DEPOSIT_ADDRESS,

    amount,

    confirmed:true

  };
}


/*
=========================================================
CONFIG
=========================================================
*/

app.get(
  "/",
  (req,res) => {

    res.json({

      ok:true,

      app:"Big Money",

      network:"TRON TRC20",

      token:"USDT"

    });

  }
);


app.get(
  "/api/config",
  (req,res) => {

    res.json({

      ok:true,

      network:"TRON",

      token:"USDT",

      standard:"TRC20",

      depositAddress:
        DEPOSIT_ADDRESS,

      qualifyingDeposit:
        QUALIFYING_DEPOSIT,

      referralRewardPoints:
        REFERRAL_REWARD_POINTS,

      dailyRewardPoints:
        DAILY_REWARD_POINTS,

      requiredReferrals:
        REQUIRED_REFERRALS,

      pointUsdtRate:
        POINT_USDT_RATE

    });

  }
);


/*
=========================================================
ACCOUNT
=========================================================
*/

app.get(
  "/api/account/:telegramUserId",
  telegramAuth,
  (req,res) => {

    const requestedId =
      String(
        req.params.telegramUserId
      );


    const authenticatedId =
      String(
        req.telegramUser.telegramUserId
      );


    if(
      requestedId !==
      authenticatedId
    ){

      return res
        .status(403)
        .json({
          ok:false,
          message:
            "Telegram user mismatch."
        });
    }


    const user =
      req.appUser;


    const referralLink =
      `https://t.me/bigmoney2026bot?start=ref_${user.telegramUserId}`;


    res.json({

      ok:true,

      user:{

        telegramUserId:
          user.telegramUserId,

        username:
          user.username || "",

        balance:
          roundNumber(
            user.balance || 0,
            6
          ),

        points:
          roundNumber(
            user.points || 0,
            2
          ),

        referrals:
          Array.isArray(
            user.referrals
          )
            ? user.referrals.length
            : 0,

        totalInvited:
          Number(
            user.totalInvited || 0
          ),

        successfulReferrals:
          Number(
            user.successfulReferrals || 0
          ),

        referredBy:
          user.referredBy ||
          null,

        referralLink

      },

      referral:{

        referralLink,

        invited:
          Number(
            user.totalInvited || 0
          ),

        successful:
          Number(
            user.successfulReferrals || 0
          ),

        points:
          roundNumber(
            user.points || 0,
            2
          )

      }

    });

  }
);


/*
=========================================================
REFERRAL
=========================================================
*/

app.get(
  "/api/referral/:telegramUserId",
  telegramAuth,
  (req,res) => {

    const requestedId =
      String(
        req.params.telegramUserId
      );


    const authenticatedId =
      String(
        req.telegramUser.telegramUserId
      );


    if(
      requestedId !==
      authenticatedId
    ){

      return res
        .status(403)
        .json({
          ok:false,
          message:
            "Telegram user mismatch."
        });
    }


    const user =
      req.appUser;


    const referralLink =
      `https://t.me/bigmoney2026bot?start=ref_${user.telegramUserId}`;


    res.json({

      ok:true,

      referral:{

        referralLink,

        invited:
          Number(
            user.totalInvited || 0
          ),

        successful:
          Number(
            user.successfulReferrals || 0
          ),

        points:
          roundNumber(
            user.points || 0,
            2
          )

      }

    });

  }
);


/*
=========================================================
POINTS -> USDT
=========================================================
*/

app.post(
  "/api/points/convert",
  telegramAuth,
  (req,res) => {

    try{

      let points =
        Number(
          req.body?.points
        );


      if(
        !Number.isFinite(
          points
        )
      ){

        return res
          .status(400)
          .json({
            ok:false,
            message:
              "Enter a valid number of points."
          });
      }


      points =
        roundNumber(
          points,
          2
        );


      if(
        points <= 0
      ){

        return res
          .status(400)
          .json({
            ok:false,
            message:
              "Points must be greater than 0."
          });
      }


      const user =
        req.appUser;


      const availablePoints =
        roundNumber(
          Number(
            user.points || 0
          ),
          2
        );


      if(
        points >
        availablePoints
      ){

        return res
          .status(400)
          .json({
            ok:false,
            message:
              `You only have ${availablePoints} points.`
          });
      }


      const usdt =
        roundNumber(
          points *
          POINT_USDT_RATE,
          6
        );


      user.points =
        roundNumber(
          availablePoints -
          points,
          2
        );


      user.balance =
        roundNumber(
          Number(
            user.balance || 0
          ) +
          usdt,
          6
        );


      user.updatedAt =
        nowISO();


      db.pointConversions.push({

        id:
          makeId(
            "pointconv"
          ),

        telegramUserId:
          String(
            user.telegramUserId
          ),

        points,

        usdt,

        rate:
          POINT_USDT_RATE,

        createdAt:
          nowISO()

      });


      saveDB();


      return res.json({

        ok:true,

        message:
          "Points converted successfully.",

        convertedPoints:
          points,

        addedUSDT:
          usdt,

        remainingPoints:
          user.points,

        balance:
          user.balance,

        rate:
          POINT_USDT_RATE

      });

    }catch(error){

      console.error(
        "Point conversion error:",
        error
      );

      return res
        .status(500)
        .json({
          ok:false,
          message:
            "Point conversion failed."
        });
    }

  }
);


/*
=========================================================
POINT HISTORY
=========================================================
*/

app.get(
  "/api/points/history",
  telegramAuth,
  (req,res) => {

    const userId =
      String(
        req.telegramUser.telegramUserId
      );


    const history =
      db.pointConversions
        .filter(
          x =>
            String(
              x.telegramUserId
            ) === userId
        )
        .sort(
          (a,b) =>
            new Date(b.createdAt) -
            new Date(a.createdAt)
        )
        .slice(
          0,
          50
        );


    res.json({

      ok:true,

      conversions:
        history

    });

  }
);


/*
=========================================================
DEPOSIT CHECK
=========================================================
*/

app.get(
  "/api/deposits/check",
  telegramAuth,
  async (req,res) => {

    try{

      const data =
        await tronFetch(
          `/v1/accounts/${DEPOSIT_ADDRESS}/transactions/trc20?limit=50&only_confirmed=true&contract_address=${USDT_CONTRACT}`
        );


      const transfers =
        Array.isArray(
          data?.data
        )
          ? data.data
          : [];


      const deposits =
        transfers
          .map(
            item => {

              const rawValue =
                item.value ||
                "0";


              let amount;


              try{

                amount =
                  Number(
                    BigInt(
                      String(rawValue)
                    )
                  ) /
                  Math.pow(
                    10,
                    USDT_DECIMALS
                  );

              }catch{

                amount =
                  Number(rawValue) /
                  Math.pow(
                    10,
                    USDT_DECIMALS
                  );
              }


              return {

                txid:
                  item.transaction_id ||
                  item.txID ||
                  "",

                amount,

                from:
                  item.from || "",

                to:
                  item.to || "",

                confirmed:true

              };

            }
          )
          .filter(
            x =>
              x.txid &&
              x.to ===
                DEPOSIT_ADDRESS
          );


      return res.json({

        ok:true,

        deposits

      });

    }catch(error){

      console.error(
        "Deposit check error:",
        error
      );

      return res
        .status(500)
        .json({
          ok:false,
          message:
            error.message
        });
    }

  }
);


/*
=========================================================
DEPOSIT REQUEST
=========================================================
*/

app.post(
  "/api/deposits/request",
  telegramAuth,
  (req,res) => {

    const user =
      req.appUser;


    res.json({

      ok:true,

      telegramUserId:
        user.telegramUserId,

      depositAddress:
        DEPOSIT_ADDRESS

    });

  }
);


/*
=========================================================
DEPOSIT VERIFY
=========================================================
*/

app.post(
  "/api/deposits/verify",
  telegramAuth,
  async (req,res) => {

    try{

      const user =
        req.appUser;


      const txid =
        String(
          req.body?.txid ||
          ""
        ).trim();


      const amount =
        Number(
          req.body?.amount
        );


      if(
        !/^[a-fA-F0-9]{64}$/.test(
          txid
        )
      ){

        return res
          .status(400)
          .json({
            ok:false,
            message:
              "Invalid 64-character TRON TXID."
          });
      }


      if(
        !Number.isFinite(
          amount
        ) ||
        amount <= 0
      ){

        return res
          .status(400)
          .json({
            ok:false,
            message:
              "Invalid deposit amount."
          });
      }


      const used =
        db.usedTransactions.some(
          x =>
            String(
              x.txid
            ).toLowerCase() ===
            txid.toLowerCase()
        );


      if(used){

        return res
          .status(400)
          .json({
            ok:false,
            message:
              "This TXID has already been used."
          });
      }


      const transfer =
        await findConfirmedUSDTTransfer(
          txid
        );


      if(
        !transfer ||
        !transfer.confirmed
      ){

        return res
          .status(400)
          .json({
            ok:false,
            message:
              "Confirmed USDT transfer not found."
          });
      }


      if(
        transfer.to !==
        DEPOSIT_ADDRESS
      ){

        return res
          .status(400)
          .json({
            ok:false,
            message:
              "This transaction was not sent to the Big Money deposit address."
          });
      }


      if(
        Math.abs(
          Number(
            transfer.amount
          ) -
          amount
        ) >
        0.000001
      ){

        return res
          .status(400)
          .json({
            ok:false,
            message:
              `Amount mismatch. Blockchain shows ${Number(
                transfer.amount
              ).toFixed(6)} USDT.`
          });
      }


      user.balance =
        roundNumber(
          Number(
            user.balance || 0
          ) +
          amount,
          6
        );


      user.updatedAt =
        nowISO();


      db.deposits.push({

        id:
          makeId(
            "dep"
          ),

        telegramUserId:
          String(
            user.telegramUserId
          ),

        username:
          user.username || "",

        txid,

        amount,

        from:
          transfer.from || "",

        to:
          transfer.to,

        confirmed:true,

        createdAt:
          nowISO()

      });


      db.usedTransactions.push({

        txid,

        telegramUserId:
          String(
            user.telegramUserId
          ),

        usedAt:
          nowISO()

      });


      let referralReward = 0;
      let dailyReward = 0;


      if(
        amount >=
        QUALIFYING_DEPOSIT
      ){

        referralReward =
          applyReferralReward(
            user
          );


        dailyReward =
          applyDailyReward(
            user
          );
      }


      saveDB();


      return res.json({

        ok:true,

        credited:
          amount,

        balance:
          user.balance,

        points:
          user.points,

        referralReward,

        dailyReward,

        txid

      });

    }catch(error){

      console.error(
        "Deposit verify error:",
        error
      );

      return res
        .status(500)
        .json({
          ok:false,
          message:
            error.message ||
            "Deposit verification failed."
        });
    }

  }
);


/*
=========================================================
WITHDRAWAL REQUEST
=========================================================
*/

app.post(
  "/api/withdrawals/request",
  telegramAuth,
  (req,res) => {

    try{

      const user =
        req.appUser;


      const address =
        String(
          req.body?.address ||
          ""
        ).trim();


      const amount =
        Number(
          req.body?.amount
        );


      if(
        !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(
          address
        )
      ){

        return res
          .status(400)
          .json({
            ok:false,
            message:
              "Invalid TRON TRC20 address."
          });
      }


      if(
        !Number.isFinite(
          amount
        ) ||
        amount <= 0
      ){

        return res
          .status(400)
          .json({
            ok:false,
            message:
              "Invalid withdrawal amount."
          });
      }


      const successful =
        Number(
          user.successfulReferrals || 0
        );


      if(
        successful <
        REQUIRED_REFERRALS
      ){

        return res
          .status(400)
          .json({
            ok:false,
            message:
              `You need ${REQUIRED_REFERRALS} successful referrals before withdrawal. You currently have ${successful}.`
          });
      }


      if(
        Number(
          user.balance || 0
        ) <
        amount
      ){

        return res
          .status(400)
          .json({
            ok:false,
            message:
              "Insufficient balance."
          });
      }


      user.balance =
        roundNumber(
          Number(
            user.balance || 0
          ) -
          amount,
          6
        );


      user.updatedAt =
        nowISO();


      const withdrawal = {

        id:
          makeId(
            "wd"
          ),

        telegramUserId:
          String(
            user.telegramUserId
          ),

        username:
          user.username || "",

        address,

        amount,

        status:
          "pending",

        paymentTxid:
          "",

        reason:
          "",

        createdAt:
          nowISO(),

        updatedAt:
          nowISO()

      };


      db.withdrawals.push(
        withdrawal
      );


      saveDB();


      return res.json({

        ok:true,

        withdrawalId:
          withdrawal.id,

        withdrawal,

        balance:
          user.balance

      });

    }catch(error){

      console.error(
        "Withdrawal request error:",
        error
      );

      return res
        .status(500)
        .json({
          ok:false,
          message:
            "Could not submit withdrawal."
        });
    }

  }
);


/*
=========================================================
USER WITHDRAWAL HISTORY
=========================================================
*/

app.get(
  "/api/withdrawals/me",
  telegramAuth,
  (req,res) => {

    const userId =
      String(
        req.telegramUser.telegramUserId
      );


    const withdrawals =
      db.withdrawals
        .filter(
          x =>
            String(
              x.telegramUserId
            ) === userId
        )
        .sort(
          (a,b) =>
            new Date(b.createdAt) -
            new Date(a.createdAt)
        );


    res.json({

      ok:true,

      withdrawals

    });

  }
);


/*
=========================================================
ADMIN AUTH
=========================================================
*/

function adminAuth(
  req,
  res,
  next
){

  const telegramUser =
    req.telegramUser;


  if(
    !telegramUser
  ){

    return res
      .status(401)
      .json({
        ok:false,
        message:
          "Telegram authentication required."
      });
  }


  const id =
    String(
      telegramUser.telegramUserId
    );


  if(
    !ADMIN_TELEGRAM_IDS.includes(
      id
    )
  ){

    return res
      .status(403)
      .json({
        ok:false,
        message:
          "Admin access denied."
      });
  }


  req.isAdmin = true;

  next();
}


/*
=========================================================
ADMIN WITHDRAWALS
=========================================================
*/

app.get(
  "/api/admin/withdrawals",
  telegramAuth,
  adminAuth,
  (req,res) => {

    const withdrawals =
      [...db.withdrawals]
        .sort(
          (a,b) =>
            new Date(b.createdAt) -
            new Date(a.createdAt)
        );


    res.json({

      ok:true,

      withdrawals

    });

  }
);


/*
=========================================================
ADMIN APPROVE
=========================================================
*/

app.post(
  "/api/admin/withdrawals/:id/approve",
  telegramAuth,
  adminAuth,
  (req,res) => {

    const withdrawal =
      db.withdrawals.find(
        x =>
          String(x.id) ===
          String(req.params.id)
      );


    if(!withdrawal){

      return res
        .status(404)
        .json({
          ok:false,
          message:
            "Withdrawal not found."
        });
    }


    if(
      withdrawal.status !==
      "pending"
    ){

      return res
        .status(400)
        .json({
          ok:false,
          message:
            "Only pending withdrawals can be approved."
        });
    }


    const paymentTxid =
      String(
        req.body?.paymentTxid ||
        ""
      ).trim();


    if(
      paymentTxid &&
      !/^[a-fA-F0-9]{64}$/.test(
        paymentTxid
      )
    ){

      return res
        .status(400)
        .json({
          ok:false,
          message:
            "Invalid payment TXID."
        });
    }


    withdrawal.status =
      "approved";


    withdrawal.paymentTxid =
      paymentTxid;


    withdrawal.updatedAt =
      nowISO();


    saveDB();


    res.json({

      ok:true,

      withdrawal

    });

  }
);


/*
=========================================================
ADMIN REJECT
=========================================================
*/

app.post(
  "/api/admin/withdrawals/:id/reject",
  telegramAuth,
  adminAuth,
  (req,res) => {

    const withdrawal =
      db.withdrawals.find(
        x =>
          String(x.id) ===
          String(req.params.id)
      );


    if(!withdrawal){

      return res
        .status(404)
        .json({
          ok:false,
          message:
            "Withdrawal not found."
        });
    }


    if(
      withdrawal.status !==
      "pending"
    ){

      return res
        .status(400)
        .json({
          ok:false,
          message:
            "Only pending withdrawals can be rejected."
        });
    }


    const reason =
      String(
        req.body?.reason ||
        "Withdrawal rejected by admin."
      ).trim();


    withdrawal.status =
      "rejected";


    withdrawal.reason =
      reason;


    withdrawal.updatedAt =
      nowISO();


    const user =
      db.users.find(
        x =>
          String(
            x.telegramUserId
          ) ===
          String(
            withdrawal.telegramUserId
          )
      );


    if(user){

      user.balance =
        roundNumber(
          Number(
            user.balance || 0
          ) +
          Number(
            withdrawal.amount || 0
          ),
          6
        );


      user.updatedAt =
        nowISO();
    }


    saveDB();


    res.json({

      ok:true,

      withdrawal,

      balance:
        user?.balance ?? null

    });

  }
);


/*
=========================================================
ADMIN PAYMENT TXID
=========================================================
*/

app.post(
  "/api/admin/withdrawals/:id/txid",
  telegramAuth,
  adminAuth,
  (req,res) => {

    const withdrawal =
      db.withdrawals.find(
        x =>
          String(x.id) ===
          String(req.params.id)
      );


    if(!withdrawal){

      return res
        .status(404)
        .json({
          ok:false,
          message:
            "Withdrawal not found."
        });
    }


    const paymentTxid =
      String(
        req.body?.paymentTxid ||
        ""
      ).trim();


    if(
      !/^[a-fA-F0-9]{64}$/.test(
        paymentTxid
      )
    ){

      return res
        .status(400)
        .json({
          ok:false,
          message:
            "Invalid payment TXID."
        });
    }


    withdrawal.paymentTxid =
      paymentTxid;


    if(
      withdrawal.status ===
      "pending"
    ){

      withdrawal.status =
        "approved";
    }


    withdrawal.updatedAt =
      nowISO();


    saveDB();


    res.json({

      ok:true,

      withdrawal

    });

  }
);


/*
=========================================================
ERROR HANDLER
=========================================================
*/

app.use(
  (
    error,
    req,
    res,
    next
  ) => {

    console.error(
      "Unhandled error:",
      error
    );


    res
      .status(500)
      .json({
        ok:false,
        message:
          "Internal server error."
      });

  }
);


/*
=========================================================
START
=========================================================
*/

app.listen(
  PORT,
  () => {

    console.log(
      `Big Money backend running on port ${PORT}`
    );

    console.log(
      "Point conversion:",
      `1 Point = ${POINT_USDT_RATE} USDT`
    );

  }
);
