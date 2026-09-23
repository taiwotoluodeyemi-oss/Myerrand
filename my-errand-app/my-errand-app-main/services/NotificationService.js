const nodemailer = require('nodemailer');
const axios = require('axios');

class NotificationService {
    constructor(emailConfig, smsConfig) {
        this.emailTransporter = nodemailer.createTransport(emailConfig);
        this.smsConfig = smsConfig;
    }

    async sendEmail(to, subject, text) {
        try {
            const info = await this.emailTransporter.sendMail({
                from: process.env.EMAIL_FROM,
                to,
                subject,
                text,
            });
            console.log('Email sent: ' + info.response);
        } catch (error) {
            console.error('Error sending email:', error);
            // Retry mechanism can be added here using a library like nodemailer-retry
        }
    }

    async sendSms(to, message) {
        try {
            const response = await axios.post(this.smsConfig.url, {
                to,
                message,
            });
            console.log('SMS sent:', response.data);
        } catch (error) {
            console.error('Error sending SMS:', error);
            // Retry mechanism can be implemented here as well
        }
    }
}

module.exports = NotificationService;

