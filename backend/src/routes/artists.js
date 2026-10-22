const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { artistOut, reviewOut } = require("../utils/serialize");

const router = express.Router();

function loadArtist(profile) {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(profile.userId);
  return artistOut(profile, user);
}

router.get("/", (req, res) => {
  const { category, location, maxPrice, q, sort } = req.query;

  let rows = db.prepare("SELECT * FROM artist_profiles").all().map(loadArtist);

  if (category && category !== "All") rows = rows.filter((a) => a.category === category);
  if (location && location !== "All") rows = rows.filter((a) => a.location === location);
  if (maxPrice) rows = rows.filter((a) => a.price <= Number(maxPrice));
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter(
      (a) =>
        a.name.toLowerCase().includes(needle) ||
        a.skills.join(" ").toLowerCase().includes(needle) ||
        a.category.toLowerCase().includes(needle)
    );
  }

  if (sort === "Highest Rated") rows.sort((a, b) => b.rating - a.rating);
  else if (sort === "Most Experienced") rows.sort((a, b) => b.exp - a.exp);
  else if (sort === "Price: Low to High") rows.sort((a, b) => a.price - b.price);
  else if (sort === "Newest") rows.sort((a, b) => b.joined.localeCompare(a.joined));

  res.json(rows);
});

router.get("/:id", (req, res) => {
  const profile = db.prepare("SELECT * FROM artist_profiles WHERE id = ?").get(req.params.id);
  if (!profile) return res.status(404).json({ error: "Artist not found." });

  const artist = loadArtist(profile);
  const reviews = db
    .prepare("SELECT * FROM reviews WHERE artistId = ? ORDER BY createdAt DESC")
    .all(profile.id)
    .map(reviewOut);
  const similar = db
    .prepare("SELECT * FROM artist_profiles WHERE category = ? AND id != ? LIMIT 3")
    .all(profile.category, profile.id)
    .map(loadArtist);

  res.json({ artist, reviews, similar });
});

// Bind every editor mutation to the authenticated owner, including stale-tab requests.
router.use('/me',requireAuth,requireRole('artist'),(req,res,next)=>{
 const profile=db.prepare('SELECT * FROM artist_profiles WHERE userId=?').get(req.user.id);
 if(!profile)return res.status(404).json({error:'Artist profile not found.'});
 const expected=req.body.profileId??req.query.profileId;
 if((expected!==undefined&&expected!==profile.id)||
    (req.body.artistId!==undefined&&req.body.artistId!==profile.id)||
    (req.body.userId!==undefined&&req.body.userId!==req.user.id)){
  return res.status(403).json({error:'You can only edit your own portfolio. Reload the page to check the signed-in account.',code:'PROFILE_OWNER_MISMATCH'});
 }
 next();
});

// Update the logged-in artist's own profile.
router.patch("/me", requireAuth, requireRole("artist"), (req, res) => {
  const profile = db.prepare("SELECT * FROM artist_profiles WHERE userId = ?").get(req.user.id);
  if (!profile) return res.status(404).json({ error: "Artist profile not found." });

  for (const key of ["price","exp"]) if (req.body[key] !== undefined && (!Number.isFinite(req.body[key]) || req.body[key] < 0 || req.body[key] > 10000000)) return res.status(400).json({error:`Invalid ${key}.`});
  if (req.body.skills !== undefined && (!Array.isArray(req.body.skills) || req.body.skills.length > 30 || req.body.skills.some(s => typeof s !== "string" || s.length > 80))) return res.status(400).json({error:"Invalid skills."});
  const fields = ["category", "location", "price", "exp", "bio", "availability"];
  const updates = {};
  for (const f of fields) {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  }
  if (Array.isArray(req.body.skills)) updates.skills = JSON.stringify(req.body.skills);

  const setClause = Object.keys(updates)
    .map((k) => `${k} = @${k}`)
    .join(", ");
  if (setClause) {
    db.prepare(`UPDATE artist_profiles SET ${setClause} WHERE id = @id`).run({ ...updates, id: profile.id });
  }

  const updated = db.prepare("SELECT * FROM artist_profiles WHERE id = ?").get(profile.id);
  res.json(loadArtist(updated));
});

router.post("/me/portfolio", requireRole("artist"), (req,res)=>{
 const profile=db.prepare("SELECT * FROM artist_profiles WHERE userId=?").get(req.user.id);
 if(!profile)return res.status(404).json({error:"Artist profile not found."});
 const {data}=req.body;
 if(typeof data!=="string"||data.length>7000000)return res.status(400).json({error:"Select a PNG, JPEG or WebP image up to 5 MB."});
 const match=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(data);
 if(!match)return res.status(400).json({error:"Unsupported image format."});
 const bytes=Buffer.from(match[2],"base64");
 const valid=(match[1]==="png"&&bytes.subarray(0,8).toString("hex")==="89504e470d0a1a0a")||(match[1]==="jpeg"&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)||(match[1]==="webp"&&bytes.toString("ascii",0,4)==="RIFF"&&bytes.toString("ascii",8,12)==="WEBP");
 if(!valid||bytes.length>5*1024*1024)return res.status(400).json({error:"Invalid image or image exceeds 5 MB."});
 const media=JSON.parse(profile.media||"[]");if(media.length>=6)return res.status(400).json({error:"Maximum six portfolio images. Remove one first."});
 media.push(data);db.prepare("UPDATE artist_profiles SET media=? WHERE id=?").run(JSON.stringify(media),profile.id);
 res.status(201).json(loadArtist(db.prepare("SELECT * FROM artist_profiles WHERE id=?").get(profile.id)));
});
router.delete("/me/portfolio/:index",requireRole("artist"),(req,res)=>{
 const profile=db.prepare("SELECT * FROM artist_profiles WHERE userId=?").get(req.user.id);
 if(!profile)return res.status(404).json({error:'Artist profile not found.'});
 const media=JSON.parse(profile.media||"[]"),index=Number(req.params.index);
 if(!Number.isInteger(index)||index<0||index>=media.length)return res.status(404).json({error:"Image not found."});
 media.splice(index,1);db.prepare("UPDATE artist_profiles SET media=? WHERE id=?").run(JSON.stringify(media),profile.id);
 res.json(loadArtist(db.prepare("SELECT * FROM artist_profiles WHERE id=?").get(profile.id)));
});
module.exports = router;
