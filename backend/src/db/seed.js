require("dotenv").config({path:require("path").join(__dirname,"../../.env")});
const bcrypt = require("bcryptjs");
const db = require("./index");
const { id } = require("../utils/id");

const DEMO_PASSWORD = "password123";
const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);

console.log("Seeding database...");

if (db.prepare("SELECT COUNT(*) n FROM users").get().n) {
 console.log("Seed skipped: accounts already exist. No records changed."); process.exit(0);
}
console.log("Creating fictional DEMO data only.");
const insertUser = db.prepare(`
  INSERT INTO users (id, email, passwordHash, name, role, location, orgCategory)
  VALUES (@id, @email, @passwordHash, @name, @role, @location, @orgCategory)
`);
const insertArtistProfile = db.prepare(`
  INSERT INTO artist_profiles (id, userId, category, location, rating, reviewsCount, price, exp, bookingsCount, bio, skills, availability, verified, joined, gradSeed)
  VALUES (@id, @userId, @category, @location, @rating, @reviewsCount, @price, @exp, @bookingsCount, @bio, @skills, @availability, @verified, @joined, @gradSeed)
`);

const ARTISTS = [
  { name: "Meera Anand", email: "meera@talentsphere.io", category: "Singers", location: "Mumbai, IN", rating: 4.9, reviews: 58, price: 15000, exp: 6, bookings: 42, bio: "Playback & live vocalist blending Hindustani classical roots with contemporary pop. Performed at 100+ weddings and corporate galas.", skills: ["Playback Singing", "Live Gigs", "Hindustani Classical", "Sufi"], availability: "Weekends", verified: true, joined: "2021" },
  { name: "Rohan Kapoor", email: "rohan@talentsphere.io", category: "Comedians", location: "Delhi, IN", rating: 4.7, reviews: 91, price: 22000, exp: 8, bookings: 130, bio: "Stand-up comedian known for sharp observational humour and crowd work. Regular at Delhi's top comedy clubs and college fests.", skills: ["Stand-up", "Crowd Work", "Corporate Comedy", "Hosting"], availability: "Flexible", verified: true, joined: "2019" },
  { name: "Ananya & The Waves", email: "ananya@talentsphere.io", category: "Dancers", location: "Bengaluru, IN", rating: 4.8, reviews: 34, price: 35000, exp: 5, bookings: 27, bio: "7-member contemporary dance troupe specialising in fusion choreography for festivals, weddings and brand launches.", skills: ["Contemporary", "Bollywood Fusion", "Choreography", "Group Acts"], availability: "Book 2 weeks ahead", verified: true, joined: "2022" },
  { name: "Kabir Rehman", email: "kabir@talentsphere.io", category: "Poets", location: "Lucknow, IN", rating: 4.9, reviews: 47, price: 9000, exp: 4, bookings: 38, bio: "Urdu-Hindi spoken word poet whose verses on love and identity have crossed 2M views online. Open-mic favourite.", skills: ["Spoken Word", "Shayari", "Hosting Open Mics", "Scriptwriting"], availability: "Weekdays", verified: false, joined: "2023" },
  { name: "DJ Vireo", email: "vireo@talentsphere.io", category: "Producers", location: "Goa, IN", rating: 4.6, reviews: 76, price: 28000, exp: 7, bookings: 95, bio: "Electronic music producer & DJ with releases on independent label circuits. Known for high-energy beach and club sets.", skills: ["DJing", "Music Production", "Sound Design", "Mixing"], availability: "Weekends", verified: true, joined: "2020" },
  { name: "Priya Suresh", email: "priya@talentsphere.io", category: "Photographers", location: "Chennai, IN", rating: 4.9, reviews: 63, price: 18000, exp: 6, bookings: 58, bio: "Event and portrait photographer with a documentary eye. Specialises in weddings, concerts and brand shoots.", skills: ["Event Photography", "Portraits", "Editing", "Drone Shots"], availability: "Flexible", verified: true, joined: "2021" },
  { name: "Arjun Mehta", email: "arjun@talentsphere.io", category: "Musicians", location: "Pune, IN", rating: 4.5, reviews: 29, price: 12000, exp: 3, bookings: 19, bio: "Guitarist and composer for indie-rock and acoustic sets. Available solo or with a 3-piece band.", skills: ["Guitar", "Composition", "Acoustic Sets", "Band Leading"], availability: "Weekends", verified: false, joined: "2023" },
  { name: "Ishaani Roy", email: "ishaani@talentsphere.io", category: "Actors", location: "Kolkata, IN", rating: 4.8, reviews: 22, price: 20000, exp: 9, bookings: 31, bio: "Theatre and screen actor with credits in regional cinema and short films. Also offers workshop facilitation.", skills: ["Theatre", "Screen Acting", "Voiceover", "Workshops"], availability: "Book 1 week ahead", verified: true, joined: "2018" },
];

const artistIds = {}; // email -> artist_profiles.id

const seedArtists = db.transaction(() => {
  ARTISTS.forEach((a, i) => {
    const userId = id("u_");
    insertUser.run({
      id: userId,
      email: a.email,
      passwordHash: hash,
      name: "[Demo] " + a.name,
      role: "artist",
      location: a.location,
      orgCategory: null,
    });
    const profileId = id("art_");
    insertArtistProfile.run({
      id: profileId,
      userId,
      category: a.category,
      location: a.location,
      rating: a.rating,
      reviewsCount: a.reviews,
      price: a.price,
      exp: a.exp,
      bookingsCount: a.bookings,
      bio: a.bio,
      skills: JSON.stringify(a.skills),
      availability: a.availability,
      verified: a.verified ? 1 : 0,
      joined: a.joined,
      gradSeed: i,
    });
    artistIds[a.email] = profileId;
  });
});
seedArtists();

// Organizers
const ORGANIZERS = [
  { name: "Alex Organizer", email: "alex@talentsphere.io", orgCategory: "Corporate", location: "Bengaluru, IN" },
  { name: "St. Xavier's College", email: "stxaviers@talentsphere.io", orgCategory: "College / University", location: "Mumbai, IN" },
];
const organizerIds = {};
const seedOrganizers = db.transaction(() => {
  ORGANIZERS.forEach((o) => {
    const userId = id("u_");
    insertUser.run({
      id: userId,
      email: o.email,
      passwordHash: hash,
      name: "[Demo] " + o.name,
      role: "organizer",
      location: o.location,
      orgCategory: o.orgCategory,
    });
    organizerIds[o.email] = userId;
  });
});
seedOrganizers();

// Admin
const adminId = id("u_");
insertUser.run({
  id: adminId,
  email: "admin@talentsphere.io",
  passwordHash: hash,
  name: "[Demo] Admin",
  role: "admin",
  location: null,
  orgCategory: null,
});

// Events
const insertEvent = db.prepare(`
  INSERT INTO events (id, name, organizerId, organizerName, category, date, time, location, venue, talent, numArtists, budget, deadline, gradSeed, icon)
  VALUES (@id, @name, @organizerId, @organizerName, @category, @date, @time, @location, @venue, @talent, @numArtists, @budget, @deadline, @gradSeed, @icon)
`);

const EVENTS = [
  { name: "Kaleidoscope — College Cultural Fest", organizerEmail: "stxaviers@talentsphere.io", category: "Cultural Fest", date: "2026-09-12", time: "5:00 PM", location: "Mumbai, IN", venue: "Main Auditorium", talent: "Singers, Dancers", numArtists: 6, budget: "₹1,50,000", deadline: "2026-08-28", grad: 0, ic: "🎉" },
  { name: "Momentum 2026 — Corporate Annual Evening", organizerEmail: "alex@talentsphere.io", category: "Corporate Event", date: "2026-09-20", time: "7:30 PM", location: "Bengaluru, IN", venue: "The Leela Grand Ballroom", talent: "Singers, Comedians", numArtists: 3, budget: "₹3,00,000", deadline: "2026-09-05", grad: 2, ic: "🏢" },
  { name: "Soundwave Music Festival", organizerEmail: "alex@talentsphere.io", category: "Music Festival", date: "2026-10-04", time: "3:00 PM", location: "Goa, IN", venue: "Vagator Beach Grounds", talent: "Musicians, Producers, DJs", numArtists: 12, budget: "₹8,00,000", deadline: "2026-09-15", grad: 4, ic: "🎶" },
  { name: "Laugh Riot — Comedy Night", organizerEmail: "alex@talentsphere.io", category: "Comedy Show", date: "2026-08-30", time: "8:00 PM", location: "Delhi, IN", venue: "The Habitat Studio", talent: "Comedians", numArtists: 4, budget: "₹80,000", deadline: "2026-08-20", grad: 1, ic: "🎙️" },
  { name: "Rina & Dev's Wedding Sangeet", organizerEmail: "alex@talentsphere.io", category: "Wedding", date: "2026-11-02", time: "6:00 PM", location: "Jaipur, IN", venue: "The Rambagh Lawns", talent: "Singers, Dancers, DJs", numArtists: 5, budget: "₹4,50,000", deadline: "2026-10-10", grad: 5, ic: "💍" },
  { name: "Unplugged — Open Mic Night", organizerEmail: "stxaviers@talentsphere.io", category: "Open Mic", date: "2026-08-22", time: "7:00 PM", location: "Pune, IN", venue: "Café Verse Terrace", talent: "Poets, Singers, Musicians", numArtists: 10, budget: "₹40,000", deadline: "2026-08-18", grad: 3, ic: "🎵" },
  { name: "Rhythm & Form — Dance Showcase", organizerEmail: "alex@talentsphere.io", category: "Dance Showcase", date: "2026-09-27", time: "5:30 PM", location: "Bengaluru, IN", venue: "Chowdiah Memorial Hall", talent: "Dancers, Choreographers", numArtists: 8, budget: "₹2,20,000", deadline: "2026-09-10", grad: 6, ic: "💃" },
];

const eventIds = {};
const seedEvents = db.transaction(() => {
  EVENTS.forEach((e) => {
    const eventId = id("ev_");
    const organizerId = organizerIds[e.organizerEmail];
    const organizerName = ORGANIZERS.find((o) => o.email === e.organizerEmail).name;
    insertEvent.run({
      id: eventId,
      name: "[Demo] " + e.name,
      organizerId,
      organizerName,
      category: e.category,
      date: new Date(Date.now()+(30+EVENTS.indexOf(e))*86400000).toISOString().slice(0,10),
      time: e.time,
      location: e.location,
      venue: e.venue,
      talent: e.talent,
      numArtists: e.numArtists,
      budget: e.budget,
      deadline: new Date(Date.now()+20*86400000).toISOString().slice(0,10),
      gradSeed: e.grad,
      icon: e.ic,
    });
    eventIds[e.name] = eventId;
  });
});
seedEvents();

// Applications
const insertApplication = db.prepare(`
  INSERT INTO applications (id, eventId, artistId, message, fee, status)
  VALUES (@id, @eventId, @artistId, @message, @fee, @status)
`);
db.transaction(() => {
  insertApplication.run({
    id: id("ap_"),
    eventId: eventIds["Kaleidoscope — College Cultural Fest"],
    artistId: artistIds["meera@talentsphere.io"],
    message: "Loved the fest theme! I can bring a 20-min Bollywood-meets-classical set.",
    fee: 14000,
    status: "Pending",
  });
  insertApplication.run({
    id: id("ap_"),
    eventId: eventIds["Laugh Riot — Comedy Night"],
    artistId: artistIds["rohan@talentsphere.io"],
    message: "Available for the full night, can headline or open.",
    fee: 22000,
    status: "Accepted",
  });
})();

// Bookings
const insertBooking = db.prepare(`
  INSERT INTO bookings (id, artistId, organizerId, eventName, date, duration, location, fee, platformFee, status)
  VALUES (@id, @artistId, @organizerId, @eventName, @date, @duration, @location, @fee, @platformFee, @status)
`);
db.transaction(() => {
  insertBooking.run({
    id: "BK-10231",
    artistId: artistIds["priya@talentsphere.io"],
    organizerId: organizerIds["alex@talentsphere.io"],
    eventName: "Corporate Product Launch",
    date: "2026-08-15",
    duration: "4 hrs",
    location: "Mumbai, IN",
    fee: 18000,
    platformFee: 1800,
    status: "Completed",
  });
  insertBooking.run({
    id: "BK-10298",
    artistId: artistIds["ananya@talentsphere.io"],
    organizerId: organizerIds["alex@talentsphere.io"],
    eventName: "Ansh & Priya Wedding",
    date: "2026-08-25",
    duration: "3 hrs",
    location: "Udaipur, IN",
    fee: 35000,
    platformFee: 3500,
    status: "Confirmed",
  });
})();

// Collaborations
db.prepare(`
  INSERT INTO collaborations (id, fromId, toId, message, status)
  VALUES (@id, @fromId, @toId, @message, @status)
`).run({
  id: id("cl_"),
  fromId: artistIds["arjun@talentsphere.io"],
  toId: artistIds["meera@talentsphere.io"],
  message: "Would love to co-write and record an acoustic single together.",
  status: "Pending",
});

// Reviews
const insertReview = db.prepare(`
  INSERT INTO reviews (id, artistId, author, rating, text)
  VALUES (@id, @artistId, @author, @rating, @text)
`);
db.transaction(() => {
  insertReview.run({ id: id("rv_"), artistId: artistIds["meera@talentsphere.io"], author: "Verve Weddings Co.", rating: 5, text: "Meera's voice completely elevated our sangeet — professional, punctual, and hugely talented." });
  insertReview.run({ id: id("rv_"), artistId: artistIds["meera@talentsphere.io"], author: "TechNova Corp Events", rating: 5, text: "Booked her for our annual day. Guests are still talking about the performance." });
  insertReview.run({ id: id("rv_"), artistId: artistIds["rohan@talentsphere.io"], author: "Delhi Comedy Club", rating: 4, text: "Great crowd work, adapted his set well for a corporate audience." });
})();

// Notifications for the demo organizer (Alex) and demo artist (Meera)
const insertNotification = db.prepare(`
  INSERT INTO notifications (id, userId, text, kind, read)
  VALUES (@id, @userId, @text, @kind, @read)
`);
const meeraUserId = db.prepare("SELECT userId FROM artist_profiles WHERE id = ?").get(artistIds["meera@talentsphere.io"]).userId;
db.transaction(() => {
  insertNotification.run({ id: id("nt_"), userId: meeraUserId, text: "Your application to Kaleidoscope — College Cultural Fest is under review.", kind: "application", read: 0 });
  insertNotification.run({ id: id("nt_"), userId: meeraUserId, text: "Booking BK-10298 has been confirmed for Aug 25.", kind: "booking", read: 0 });
  insertNotification.run({ id: id("nt_"), userId: meeraUserId, text: "Arjun Mehta sent you a collaboration request.", kind: "collab", read: 1 });
  insertNotification.run({ id: id("nt_"), userId: meeraUserId, text: "You received a new 5★ review from Verve Weddings Co.", kind: "review", read: 1 });
})();

console.log("Seed complete.");
console.log("");
console.log("Demo accounts (all use password: " + DEMO_PASSWORD + "):");
console.log("  Artist:    meera@talentsphere.io");
console.log("  Organizer: alex@talentsphere.io");
console.log("  Admin:     admin@talentsphere.io");

console.log("All demo accounts require email verification. Fictional inboxes need explicit development-only preview; see AUTHENTICATION.md.");
