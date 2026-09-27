const winston = require('winston');
const path = require('path');

const jsonFormat = winston.format.combine(winston.format.timestamp(), winston.format.json());
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: jsonFormat,
  defaultMeta: { service: 'my-errand-app', environment: process.env.NODE_ENV || 'development' },
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: path.join(__dirname, '../logs/error.log'), level: 'error' }),
    new winston.transports.File({ filename: path.join(__dirname, '../logs/combined.log') }),
  ],
});
module.exports = logger;
