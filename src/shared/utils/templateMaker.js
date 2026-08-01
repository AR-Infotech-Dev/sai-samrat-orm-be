import fs from "fs/promises";
import { fileURLToPath } from "url";
import path from "path";
import Handlebars from "handlebars";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Register Helper
Handlebars.registerHelper("getValue", (obj, key) => {
    const value = obj?.[key];
    if (value === null || value === undefined || value === "") return "-";
    return value;
});

Handlebars.registerHelper("eq", (a, b) => a === b);

const parseArrayValue = (value) => {
    if (Array.isArray(value)) return value;
    if (typeof value !== "string") return [];

    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const formatJoinValue = (value, field = "") => {
    if (Array.isArray(value)) {
        const joined = value.map((item) => formatJoinValue(item, field)).filter((item) => item && item !== "-").join("+");
        return joined || "-";
    }

    if (!value || typeof value !== "object") {
        return value === null || value === undefined || value === "" ? "-" : value;
    }

    if (field === "product_id") {
        return value.product_id ?? value.id ?? value.value ?? value.label ?? "-";
    }

    if (field === "product_name") {
        return value.product_name ?? value.name ?? value.label ?? value.value ?? "-";
    }

    if (field === "serial_number") {
        return value.serial_number ?? value.value ?? value.label ?? "-";
    }

    if (field === "expiry_date") {
        return value.expiry_date ?? value.date ?? value.value ?? "-";
    }

    if (field === "add_ons") {
        return value.add_on_name ?? value.name ?? value.label ?? value.value ?? "-";
    }

    const joined = Object.values(value)
        .filter((item) => item !== null && item !== undefined && typeof item !== "object")
        .join(" ");
    return joined || "-";
};

Handlebars.registerHelper("joinField", (arr, field, separator = ",") => {
    const safeSeparator = typeof separator === "string" ? separator : ",";
    const rows = Array.isArray(arr) ? arr : parseArrayValue(arr);
    if (!rows.length) return "-";

    const joined = rows
        .map(item => {
            const value = item[field];
            return formatJoinValue(value, field);
        })
        .filter(Boolean)
        .join(safeSeparator);

    return joined || "-";
});


export const renderTemplate = async (name, type, data = {}) => {
    const folderMap = {
        email: "emails",
        excel: "excels",
    };
    const extensionMap = {
        email: ".email.hbs",
        excel: ".excel.hbs",
    };
    const templatePath = path.join(
        __dirname,
        "../../templates",
        folderMap[type],
        `${name}${extensionMap[type]}`
    );
    const source = await fs.readFile(templatePath, "utf8");
    const template = Handlebars.compile(source);
    return template(data);
}
