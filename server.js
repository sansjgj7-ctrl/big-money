const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;

app.get("/", (req, res) => {
  res.json({
    ok: true,
    name: "Big Money Backend",
    network: "TRON TRC20"
  });
});

app.get("/api/config", (req, res) => {
  res.json({
    network: "TRON",
    token: "USDT",
    standard: "TRC20",
    depositAddress: "TAmkXMpkcqSZmG9oRvtXfBvpLWr53wXEdx"
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Big Money Backend running on port ${PORT}`);
});
