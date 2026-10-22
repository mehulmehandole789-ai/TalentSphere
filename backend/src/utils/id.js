const crypto = require("crypto");

// Short, URL-safe unique id with an optional prefix, e.g. id("bk_") => "bk_9f2a1c7e4b3d"
function id(prefix = "") {
  return prefix + crypto.randomBytes(9).toString("hex");
}

module.exports = { id };
