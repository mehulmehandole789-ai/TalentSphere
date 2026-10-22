const jwt = require("jsonwebtoken");
const db = require("../db");

const JWT_SECRET = process.env.JWT_SECRET;

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, version: user.tokenVersion || 0 }, JWT_SECRET, { expiresIn: "7d" });
}

// Populates req.user if a valid token is present; does NOT reject if absent.
function attachUser(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return next();
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(payload.sub);
    if (user && (payload.version || 0) === user.tokenVersion) {
      const block=require("../auth/common").accountBlock(user);
      if(block)req.authBlock=block;else req.user=user;
    }
  } catch (err) {
    // invalid/expired token â€” treat as anonymous
  }
  next();
}

// Rejects the request unless a valid token was attached.
function requireAuth(req, res, next) {
  if (!req.user) return res.status(req.authBlock?403:401).json(req.authBlock?{error:req.authBlock.message,...req.authBlock}:{error:"Authentication required.",code:"AUTH_REQUIRED"});
  next();
}

// Rejects unless req.user's role is one of the allowed roles.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(req.authBlock?403:401).json(req.authBlock?{error:req.authBlock.message,...req.authBlock}:{error:"Authentication required.",code:"AUTH_REQUIRED"});
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "You don't have permission to do that." });
    }
    next();
  };
}

module.exports = { signToken, attachUser, requireAuth, requireRole, JWT_SECRET };
