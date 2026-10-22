const express = require("express");
const db = require("../db");
const { id } = require("../utils/id");
const { requireAuth, requireRole } = require("../middleware/auth");
const { applicationOut } = require("../utils/serialize");

const router = express.Router();

function notify(userId, text, kind) {
  db.prepare("INSERT INTO notifications (id, userId, text, kind) VALUES (?, ?, ?, ?)").run(
    id("nt_"),
    userId,
    text,
    kind
  );
}

// Applications relevant to the current user: an artist sees their own,
// an organizer sees applications to their events.
router.get("/", requireAuth, (req, res) => {
  let rows;
  if (req.user.role === "artist") {
    const profile = db.prepare("SELECT * FROM artist_profiles WHERE userId = ?").get(req.user.id);
    rows = profile
      ? db.prepare("SELECT * FROM applications WHERE artistId = ? ORDER BY createdAt DESC").all(profile.id)
      : [];
  } else if (req.user.role === "organizer") {
    rows = db
      .prepare(
        `SELECT applications.* FROM applications
         JOIN events ON events.id = applications.eventId
         WHERE events.organizerId = ?
         ORDER BY applications.createdAt DESC`
      )
      .all(req.user.id);
  } else {
    rows = db.prepare("SELECT * FROM applications ORDER BY createdAt DESC").all();
  }
  res.json(rows.map(applicationOut));
});

router.post("/", requireAuth, requireRole("artist"), (req, res) => {
  const { eventId, message, fee } = req.body || {};
  const event = db.prepare("SELECT * FROM events WHERE id = ?").get(eventId);
  if (!event) return res.status(404).json({ error: "Event not found." });

  const profile = db.prepare("SELECT * FROM artist_profiles WHERE userId = ?").get(req.user.id);
  if (!profile) return res.status(400).json({ error: "No artist profile for this account." });

  if (event.deadline < new Date().toISOString().slice(0,10)) return res.status(400).json({error:"Application deadline has passed."});
  if (db.prepare("SELECT id FROM applications WHERE eventId = ? AND artistId = ? AND status != 'Withdrawn'").get(eventId,profile.id)) return res.status(409).json({error:"You already applied to this event."});
  if (fee !== undefined && (!Number.isFinite(Number(fee)) || Number(fee) < 0)) return res.status(400).json({error:"Invalid fee."});
  const newApp = {
    id: id("ap_"),
    eventId,
    artistId: profile.id,
    message: message || "I'd love to be part of this event.",
    fee: Number(fee) || profile.price,
    status: "Pending",
  };

  db.prepare(`
    INSERT INTO applications (id, eventId, artistId, message, fee, status)
    VALUES (@id, @eventId, @artistId, @message, @fee, @status)
  `).run(newApp);

  notify(event.organizerId, `${req.user.name} applied to "${event.name}".`, "application");

  const saved = db.prepare("SELECT * FROM applications WHERE id = ?").get(newApp.id);
  res.status(201).json(applicationOut(saved));
});

router.patch("/:id", requireAuth, (req, res) => {
  const app = db.prepare("SELECT * FROM applications WHERE id = ?").get(req.params.id);
  if (!app) return res.status(404).json({ error: "Application not found." });

  const { status } = req.body || {};
  if (!["Pending", "Accepted", "Rejected", "Withdrawn"].includes(status)) {
    return res.status(400).json({ error: "Invalid status." });
  }

  const profile =
    req.user.role === "artist" ? db.prepare("SELECT * FROM artist_profiles WHERE userId = ?").get(req.user.id) : null;
  const event = db.prepare("SELECT * FROM events WHERE id = ?").get(app.eventId);

  const isOwningArtist = profile && profile.id === app.artistId;
  const isOwningOrganizer = event && event.organizerId === req.user.id;
  if (!isOwningArtist && !isOwningOrganizer && req.user.role !== "admin") {
    return res.status(403).json({ error: "You don't have permission to do that." });
  }

  if (app.status !== "Pending") return res.status(409).json({error:"Application already resolved."});
  if ((isOwningArtist && status !== "Withdrawn") || (!isOwningArtist && !["Accepted","Rejected"].includes(status))) return res.status(403).json({error:"Status change not permitted."});
  db.prepare("UPDATE applications SET status = ? WHERE id = ?").run(status, app.id);

  if (status === "Accepted" || status === "Rejected") {
    const artist = db.prepare("SELECT * FROM artist_profiles WHERE id = ?").get(app.artistId);
    if (artist) {
      notify(artist.userId, `Your application to "${event?.name || "an event"}" was ${status.toLowerCase()}.`, "application");
    }
  }

  const updated = db.prepare("SELECT * FROM applications WHERE id = ?").get(app.id);
  res.json(applicationOut(updated));
});

module.exports = router;
