// middleware/rateLimiter.js
const rateLimit = require('express-rate-limit');

const errandRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 50, // max requests per IP
  message: 'Too many requests, please try again later.'
});

module.exports = errandRateLimiter;
