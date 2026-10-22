const express = require("express");
const db = require("../db");
const { id } = require("../utils/id");
const { requireAuth, requireRole } = require("../middleware/auth");
const { eventOut, applicationOut } = require("../utils/serialize");

const router = express.Router();

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM events ORDER BY createdAt DESC").all().map(eventOut);
  res.json(rows);
});

router.get("/:id", (req, res) => {
  const event = db.prepare("SELECT * FROM events WHERE id = ?").get(req.params.id);
  if (!event) return res.status(404).json({ error: "Event not found." });
  const canRead = req.user && (req.user.role === "admin" || req.user.id === event.organizerId);
  const applications = canRead ? db
    .prepare("SELECT * FROM applications WHERE eventId = ? ORDER BY createdAt DESC")
    .all(event.id)
    .map(applicationOut) : [];
  res.json({ event: eventOut(event), applications });
});

router.post("/", requireAuth, requireRole("organizer"), (req, res) => {
  const { name, description, category, date, time, location, venue, talent, numArtists, budget, deadline } = req.body || {};
  if (![name,category,date,time,location,venue,talent,budget,deadline].every(v=>typeof v==="string"&&v.trim())) return res.status(400).json({error:"Complete all event details."});
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10)!==date || date<new Date().toISOString().slice(0,10) || !/^\d{4}-\d{2}-\d{2}$/.test(deadline) || deadline>date || deadline<new Date().toISOString().slice(0,10)) return res.status(400).json({error:"Choose a future event date and a deadline between today and the event."});
  if (!Number.isInteger(Number(numArtists)) || Number(numArtists)<1 || Number(numArtists)>1000) return res.status(400).json({error:"Artist count must be between 1 and 1000."});

  const newEvent = {
    id: id("ev_"),
    name,
    description: description || "",
    organizerId: req.user.id,
    organizerName: req.user.name,
    category: category || "General",
    date,
    time: time || "TBD",
    location: location || "Location TBD",
    venue: venue || "Venue TBD",
    talent: talent || "",
    numArtists: Number(numArtists) || 1,
    budget: budget || "TBD",
    deadline: deadline || date,
    gradSeed: Math.floor(Math.random() * 8),
    icon: "calendar",
  };

  db.prepare(`
    INSERT INTO events (id, name, description, organizerId, organizerName, category, date, time, location, venue, talent, numArtists, budget, deadline, gradSeed, icon)
    VALUES (@id, @name, @description, @organizerId, @organizerName, @category, @date, @time, @location, @venue, @talent, @numArtists, @budget, @deadline, @gradSeed, @icon)
  `).run(newEvent);

  const saved = db.prepare("SELECT * FROM events WHERE id = ?").get(newEvent.id);
  res.status(201).json(eventOut(saved));
});

module.exports = router;
