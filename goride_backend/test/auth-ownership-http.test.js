const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const Module = require("node:module");
const original = Module._load;
let actual;
Module._load = function (name, parent, isMain) {
  if (
    parent?.filename.endsWith("/controllers/authController.js") &&
    name === "../services/authService"
  )
    return {
      updateFcmToken: async (...args) => {
        actual = args;
        return {};
      },
      logout: async (...args) => {
        actual = args;
        return {};
      },
    };
  return original.call(this, name, parent, isMain);
};
const controller = require("../src/controllers/authController");
Module._load = original;
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.user = { id: "verified-owner" };
  next();
});
app.post("/device", controller.updateFcmToken);
app.post("/logout", controller.logout);
test("FCM and logout controllers ignore attacker-supplied body userId", async () => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  try {
    for (const path of ["/device", "/logout"]) {
      const r = await fetch(
        `http://127.0.0.1:${server.address().port}${path}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer owner-session",
          },
          body: JSON.stringify({ userId: "victim", fcmToken: "device" }),
        },
      );
      assert.equal(r.status, 200);
      assert.equal(actual[0], "owner-session");
      assert.equal(actual[1], "verified-owner");
    }
  } finally {
    await new Promise((r) => server.close(r));
  }
});
