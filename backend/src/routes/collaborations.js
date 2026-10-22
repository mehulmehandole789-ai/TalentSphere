const express = require("express");
const db = require("../db");
const { id } = require("../utils/id");
const { requireAuth, requireRole } = require("../middleware/auth");
const { collabOut } = require("../utils/serialize");

const router = express.Router();

function notify(userId, text, kind) {
  db.prepare("INSERT INTO notifications (id, userId, text, kind) VALUES (?, ?, ?, ?)").run(
    id("nt_"),
    userId,
    text,
    kind
  );
}

router.get("/", requireAuth, requireRole("artist"), (req, res) => {
  const profile = db.prepare("SELECT * FROM artist_profiles WHERE userId = ?").get(req.user.id);
  if (!profile) return res.json([]);
  const rows = db
    .prepare("SELECT * FROM collaborations WHERE fromId = ? OR toId = ? ORDER BY createdAt DESC")
    .all(profile.id, profile.id);
  res.json(rows.map(collabOut));
});

router.post("/", requireAuth, requireRole("artist"), (req, res) => {
  const { toId, message } = req.body || {};
  const fromProfile = db.prepare("SELECT * FROM artist_profiles WHERE userId = ?").get(req.user.id);
  if (!fromProfile) return res.status(400).json({ error: "No artist profile for this account." });
  if (toId === fromProfile.id) return res.status(400).json({ error: "You can't collaborate with yourself." });

  const toProfile = db.prepare("SELECT * FROM artist_profiles WHERE id = ?").get(toId);
  if (!toProfile) return res.status(404).json({ error: "Artist not found." });

  if (db.prepare("SELECT id FROM collaborations WHERE fromId = ? AND toId = ? AND status = 'Pending'").get(fromProfile.id,toId)) return res.status(409).json({error:"A request is already pending."});
  const newCollab = {
    id: id("cl_"),
    fromId: fromProfile.id,
    toId,
    message: message || "Would love to collaborate on an upcoming project!",
    status: "Pending",
  };
  db.prepare(`
    INSERT INTO collaborations (id, fromId, toId, message, status)
    VALUES (@id, @fromId, @toId, @message, @status)
  `).run(newCollab);

  notify(toProfile.userId, `${req.user.name} sent you a collaboration request.`, "collab");

  const saved = db.prepare("SELECT * FROM collaborations WHERE id = ?").get(newCollab.id);
  res.status(201).json(collabOut(saved));
});

router.patch("/:id", requireAuth, requireRole("artist"), (req, res) => {
  const collab = db.prepare("SELECT * FROM collaborations WHERE id = ?").get(req.params.id);
  if (!collab) return res.status(404).json({ error: "Collaboration request not found." });

  const profile = db.prepare("SELECT * FROM artist_profiles WHERE userId = ?").get(req.user.id);
  if (!profile || profile.id !== collab.toId) {
    return res.status(403).json({ error: "Only the recipient can respond to this request." });
  }

  if (collab.status !== "Pending") return res.status(409).json({error:"Request already resolved."});
  const { status } = req.body || {};
  if (!["Accepted", "Declined"].includes(status)) return res.status(400).json({ error: "Invalid status." });

  db.prepare("UPDATE collaborations SET status = ? WHERE id = ?").run(status, collab.id);

  const fromProfile = db.prepare("SELECT * FROM artist_profiles WHERE id = ?").get(collab.fromId);
  if (fromProfile) {
    notify(fromProfile.userId, `${req.user.name} ${status.toLowerCase()} your collaboration request.`, "collab");
  }

  const updated = db.prepare("SELECT * FROM collaborations WHERE id = ?").get(collab.id);
  res.json(collabOut(updated));
});

module.exports = router;
