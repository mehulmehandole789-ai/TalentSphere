const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { publicUser, artistOut, eventOut, bookingOut } = require("../utils/serialize");

const router = express.Router();
router.use(requireAuth, requireRole("admin"));

router.get("/users", (req, res) => {
  const users = db.prepare("SELECT * FROM users ORDER BY createdAt DESC").all();
  const artistProfiles = db.prepare("SELECT * FROM artist_profiles").all();
  const byUserId = Object.fromEntries(artistProfiles.map((p) => [p.userId, p]));

  const out = users.map((u) => {
    const base = publicUser(u);
    if (byUserId[u.id]) {
      const p = byUserId[u.id];
      return { ...base, verified: !!p.verified, artistProfileId: p.id };
    }
    return base;
  });
  res.json(out);
});

router.get("/events", (req, res) => {
  res.json(db.prepare("SELECT * FROM events ORDER BY createdAt DESC").all().map(eventOut));
});

router.get("/bookings", (req, res) => {
  res.json(db.prepare("SELECT * FROM bookings ORDER BY createdAt DESC").all().map(bookingOut));
});

router.get("/reports", (req, res) => {
  const totalUsers = db.prepare("SELECT COUNT(*) c FROM users").get().c;
  const totalArtists = db.prepare("SELECT COUNT(*) c FROM artist_profiles").get().c;
  const totalOrganizers = db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'organizer'").get().c;
  const totalEvents = db.prepare("SELECT COUNT(*) c FROM events").get().c;
  const totalBookings = db.prepare("SELECT COUNT(*) c FROM bookings").get().c;
  const confirmedRevenue =
    db.prepare("SELECT COALESCE(SUM(platformFee),0) s FROM bookings WHERE status IN ('Confirmed','Completed')").get()
      .s;

  res.json({ totalUsers, totalArtists, totalOrganizers, totalEvents, totalBookings, confirmedRevenue });
});

router.patch("/artists/:id/verify", (req, res) => {
  const profile = db.prepare("SELECT * FROM artist_profiles WHERE id = ?").get(req.params.id);
  if (!profile) return res.status(404).json({ error: "Artist not found." });
  db.prepare("UPDATE artist_profiles SET verified = 1 WHERE id = ?").run(profile.id);
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(profile.userId);
  const updated = db.prepare("SELECT * FROM artist_profiles WHERE id = ?").get(profile.id);
  res.json(artistOut(updated, user));
});

router.patch("/users/:id/suspension", (req,res) => {
 const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
 if (!user) return res.status(404).json({error:"User not found."});
 if (user.role === "admin") return res.status(403).json({error:"Administrators cannot be suspended."});
 db.prepare("UPDATE users SET suspended = ?, tokenVersion = tokenVersion + 1 WHERE id = ?").run(user.suspended ? 0 : 1,user.id);
 res.json(publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(user.id)));
});
router.patch("/users/:id/approval",(req,res)=>{
 const user=db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id);
 if(!user)return res.status(404).json({error:"User not found."});
 if(user.role==="admin")return res.status(403).json({error:"Administrator approval cannot be changed here."});
 const status=req.body.approvalStatus;
 if(!["approved","pending","rejected"].includes(status))return res.status(400).json({error:"Invalid approval status."});
 db.prepare("UPDATE users SET approvalStatus=?,tokenVersion=tokenVersion+1 WHERE id=?").run(status,user.id);
 res.json(publicUser(db.prepare("SELECT * FROM users WHERE id=?").get(user.id)));
});
module.exports = router;
