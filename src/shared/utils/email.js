import nodemailer from "nodemailer";
import path from "path";
import { env } from "#config/env.js";
import { query, DB_PREFIX } from "#config/database.js";
import { renderTemplate } from "./templateMaker.js";

// ================================
// Mail Transporter
// ================================
const defaultTransporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: env.EMAIL_USER,
        pass: env.EMAIL_PASS,
    },
});

const companyMailerCache = new Map();

export const clearCompanyMailerCache = (company_id = null) => {
    if (company_id) {
        companyMailerCache.delete(company_id);
        companyMailerCache.delete(String(company_id));
        return;
    }
    companyMailerCache.clear();
};

const PROVIDER_DEFAULTS = {
    gmail: { host: "smtp.gmail.com", port: 587, secure: false },
    yahoo: { host: "smtp.mail.yahoo.com", port: 587, secure: false },
    outlook: { host: "smtp.office365.com", port: 587, secure: false },
};

const getSmtpTransportOptions = (companyConfig = {}) => {
    const provider = String(companyConfig.mail_provider || "gmail").toLowerCase();
    const defaults = PROVIDER_DEFAULTS[provider] || {};
    const encryption = String(companyConfig.smtp_encryption || "tls").toLowerCase();
    const port = Number(companyConfig.smtp_port || defaults.port || 587);

    return {
        host: companyConfig.smtp_host || defaults.host || "smtp.gmail.com",
        port,
        secure: encryption === "ssl" || port === 465,
        auth: {
            user: companyConfig.smtp_username || companyConfig.sender_email,
            pass: companyConfig.email_app_password,
        },
        requireTLS: encryption === "tls",
    };
};

export const createSmtpTransport = (config = {}) => {
    return nodemailer.createTransport(getSmtpTransportOptions(config));
};

const getFriendlySmtpError = (error = {}) => {
    const message = String(error?.message || "");
    const code = String(error?.code || "");

    if (/auth|credential|password|username|login/i.test(`${code} ${message}`)) {
        return "Authentication failed. Please check email username and app password.";
    }

    if (/timeout|timed out/i.test(message)) {
        return "Connection timeout. Please check SMTP host, port, and network access.";
    }

    if (/ECONNREFUSED|ENOTFOUND|host/i.test(`${code} ${message}`)) {
        return "SMTP host is unreachable. Please check host and port.";
    }

    if (/tls|ssl|certificate|secure/i.test(message)) {
        return "TLS/SSL mismatch. Please check encryption setting.";
    }

    return message || "SMTP connection failed.";
};

export const testSmtpConnection = async (config = {}) => {
    try {
        const transporter = createSmtpTransport(config);
        const senderName = config.sender_name || config.company_name || "Support Team";
        const senderEmail = config.sender_email;

        await transporter.verify();
        const html = await renderTemplate("smtpConnectionTest", "email");
        const formattedHtml = await mailFormat(config, html);

        await transporter.sendMail({
            from: `${senderName} <${senderEmail}>`,
            to: senderEmail,
            subject: "SMTP Connection Test",
            text: "SMTP configuration successful.",
            html: formattedHtml,
        });

        return {
            success: true,
            message: "SMTP connection successful",
        };
    } catch (error) {
        return {
            success: false,
            message: getFriendlySmtpError(error),
            error: error.message,
        };
    }
};

const getCompanyMailerConfig = async (company_id = null) => {
    if (!company_id) {
        return null;
    }

    // if (companyMailerCache.has(company_id)) {
    //     return companyMailerCache.get(company_id);
    // }

    const sql = `
        SELECT company_id, company_name, sender_email, sender_name, mail_provider, smtp_host, smtp_port, smtp_encryption, smtp_username, email_app_password, email_logo
        FROM ${DB_PREFIX}company_master
        WHERE company_id = ?
          AND status = 'active'
        LIMIT 1
    `;

    const rows = await query(sql, [company_id]);
    const config = rows[0] || null;

    companyMailerCache.set(company_id, config);
    return config;
};

const getTransporter = async (company_id = null) => {
    const companyConfig = await getCompanyMailerConfig(company_id);

    if (!companyConfig?.sender_email || !companyConfig?.email_app_password) {
        return {
            transporter: defaultTransporter,
            from: `Support Team <${env.EMAIL_USER}>`,
            companyConfig,
        };
    }

    const transporter = nodemailer.createTransport(getSmtpTransportOptions(companyConfig));
    const senderName = companyConfig.sender_name || companyConfig.company_name || "Support Team";
    const logo_path = companyConfig.email_logo || "";

    return {
        transporter,
        from: `${senderName} <${companyConfig.sender_email}>`,
        companyConfig,
    };
};

// ================================
// Generic Send Email Function
// ================================
export const sendEmail = async ({ to, subject, html, text = "", company_id = null, attachments = [], }) => {
    try {
        const { transporter, from, companyConfig } = await getTransporter(company_id);
        const formattedHtml = await mailFormat(companyConfig, html);
        const fallbackText = text || String(html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

        const info = await transporter.sendMail({
            from,
            to,
            subject,
            text: fallbackText,
            html: formattedHtml,
            attachments,
        });
        return {
            success: true,
            message: "Email sent successfully",
            messageId: info.messageId,
        };
    } catch (error) {
        console.error("Send Email Error:", error);
        return {
            success: false,
            message: "Failed to send email",
            error: error.message,
        };
    }
};

// ================================
// Ticket Status Email Function
// ================================
export const sendTicketStatusMail = async ({ to, ticketId, ticketTitle, status, userName = "User", company_id = null, }) => {
    try {
        const html = await renderTemplate("ticketNotification", "email", {
            clientName: userName,
            ticketNo: ticketId,
            subject: `Ticket #${ticketId} Status Updated`,
            message: "Your ticket status has been updated.",
            status,
            category: ticketTitle,
            appName: env.appName || "Support System",
        });

        const result = await sendEmail({ to, subject: `Ticket #${ticketId} Status Updated`, html, company_id, });
        return result;
    } catch (error) {
        console.error("Ticket Mail Error:", error);
        return {
            success: false,
            message: "Failed to send ticket status email",
            error: error.message,
        };
    }
};

const buildLogoUrl = (logoPath = "") => {
    const rawLogoPath = String(logoPath || "").trim();
    if (!rawLogoPath) {
        return "";
    }

    if (/^https?:\/\//i.test(rawLogoPath)) {
        return rawLogoPath;
    }

    const baseUrl = String(env.appUrl || env.appLink || "").replace(/\/+$/, "");
    const cleanPath = rawLogoPath
        .replace(/\\/g, "/")
        .replace(/^.*?public\//, "")
        .replace(/^\/+/, "");
    const normalizedPath = cleanPath.includes("images/company-logos/")
        ? cleanPath.slice(cleanPath.indexOf("images/company-logos/"))
        : `images/company-logos/${path.basename(cleanPath)}`;
    return baseUrl ? `${baseUrl}/${normalizedPath}` : `/${normalizedPath}`;
};

const mailFormat = async (companyConfig = {}, html = '') => {
    const config = companyConfig || {};
    let mainMailBody = String(html || "");
    mainMailBody = mainMailBody.replace(/{appName}/g, env.appName);
    mainMailBody = mainMailBody.replace(/{companyName}/g, config.company_name);

    const logoUrl = buildLogoUrl(config.email_logo);
    return renderTemplate("mailLayout", "email", {
        appName: env.appName,
        appLink: env.appLink,
        logoPath: logoUrl,
        mainMailBody,
    });
};
