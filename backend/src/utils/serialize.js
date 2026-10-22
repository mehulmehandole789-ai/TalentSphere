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
  return {
    id: profile.id,
    userId: profile.userId,
    name: user.name,
    media: JSON.parse(profile.media || "[]"),
    category: profile.category,
    location: profile.location,
    rating: profile.rating,
    reviews: profile.reviewsCount,
    price: profile.price,
    exp: profile.exp,
    bookings: profile.bookingsCount,
    bio: profile.bio,
    skills: JSON.parse(profile.skills || "[]"),
    availability: profile.availability,
    verified: !!profile.verified,
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
