const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { notificationOut } = require("../utils/serialize");

const router = express.Router();

router.get("/", requireAuth, (req, res) => {
  const rows = db
    .prepare("SELECT * FROM notifications WHERE userId = ? ORDER BY createdAt DESC")
    .all(req.user.id);
  res.json(rows.map(notificationOut));
});

router.patch("/:id/read", requireAuth, (req, res) => {
  const notif = db.prepare("SELECT * FROM notifications WHERE id = ?").get(req.params.id);
  if (!notif || notif.userId !== req.user.id) return res.status(404).json({ error: "Notification not found." });
  db.prepare("UPDATE notifications SET read = 1 WHERE id = ?").run(notif.id);
  res.json(notificationOut(db.prepare("SELECT * FROM notifications WHERE id = ?").get(notif.id)));
});

router.patch("/read-all", requireAuth, (req, res) => {
  db.prepare("UPDATE notifications SET read = 1 WHERE userId = ?").run(req.user.id);
  res.json({ ok: true });
});

module.exports = router;
