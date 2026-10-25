function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    location: u.location,
    orgCategory: u.orgCategory,
    suspended: !!u.suspended,
    emailVerified: !!u.emailVerified,
    approvalStatus: u.approvalStatus,
  };
}

// Joins an artist_profiles row with its owning user row (name/location live on users).
function artistOut(profile, user) {
  const db=require('../db');
  const aggregate=db.prepare("SELECT COALESCE(AVG(r.rating),0) rating,COUNT(*) count FROM reviews r JOIN bookings b ON b.id=r.bookingId WHERE r.artistId=? AND r.hidden=0 AND b.status='Completed'").get(profile.id);
  const verification=db.prepare('SELECT details,createdAt FROM artist_verifications WHERE artistId=? AND revoked=0 ORDER BY id DESC LIMIT 1').get(profile.id);

  return {
    id: profile.id,
    userId: profile.userId,
    name: user.name,
    media: JSON.parse(profile.media || "[]"),
    category: profile.category,
    location: profile.location,
    rating: aggregate.rating,
    reviews: aggregate.count,
    price: profile.price,
    exp: profile.exp,
    bookings: profile.bookingsCount,
    bio: profile.bio,
    skills: JSON.parse(profile.skills || "[]"),
    availability: profile.availability,
    verified: !!profile.verified && !!verification,
    verification: verification||null,
    details:JSON.parse(profile.details||"{}"),
    visibility:profile.visibility,
    joined: profile.joined,
    gradSeed: profile.gradSeed,
  };
}

function eventOut(e) {
  return { ...e };
}

function bookingOut(b) {
  return { ...b };
}

function applicationOut(a) {
  return { ...a };
}

function collabOut(c) {
  return { ...c };
}

function reviewOut(r) {
  return { ...r };
}

function notificationOut(n) {
  return { ...n, read: !!n.read };
}

module.exports = {
  publicUser,
  artistOut,
  eventOut,
  bookingOut,
  applicationOut,
  collabOut,
  reviewOut,
  notificationOut,
};
