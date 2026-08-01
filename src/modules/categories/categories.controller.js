import * as CommonModel from "#shared/models/common.model.js";
import { query, DB_PREFIX } from "#config/database.js";
import { successResponse, failureResponse } from "#shared/utils/apiResponse.js";
import { prepareFilterData } from "#shared/utils/filter.builder.js";
import { toMysqlDateTime } from "#shared/utils/dateTime.js";
import { buildTablePayload, pickValue } from "#shared/utils/tablePayload.js";
import { isSuperAdminRole as isSuperAdmin } from "#shared/utils/role.utils.js";
import { env } from "#config/env.js";

const MODULE_TABLE = "categories";

const default_columns = {
    parent_id: { table: "categories", alias: "pc", column: "categoryName", key2: "category_id", select: "" },
};

const custom_columns = {
    // company_id: { table: "company_master", alias: "dc", column: "company_name", key2: "company_id", select: "" },
    created_by: { table: "admin", alias: "ad", column: "name", key2: "adminID", select: "" },
    modified_by: { table: "admin", alias: "am", column: "name", key2: "adminID", select: "" },
};

// ======================================================
// LIST CATEGORY DETAILS
// ======================================================
export const getcategoryDetails = async (req, res) => {
    try {
        const {
            getAll = "N",
            page,
            curpage,
            category_id = "",
            is_parent = "",
            orderBy = "created_date",
            order = "ASC",
            status = "",
            parent_id = "",
            isSub = "N",
            childOf = "",
            is_system = "",
            searchText = "",
            filters = [],
        } = req.body;

        // const limit = 10;
        const limit = env.perPage;
        const currentPage = Number(page || (curpage !== undefined ? Number(curpage) + 1 : 1)) || 1;
        const start = (currentPage - 1) * limit;
        const filterData = prepareFilterData({
            filters,
            searchText,
            other: {
                orderBy,
                order,
                searchColumns: ["t.categoryName", "t.slug", "t.description"],
            },
            default_columns,
            custom_columns,
        });

        const { select, where, values, join, other } = filterData;
        other.freeTextSearch = searchText;
        other.searchColumns = ["t.categoryName", "t.slug", "t.description"];
        // console.log(other);

        if (!isSuperAdmin(req.user) && req.user.company_id) {
            where.push("t.company_id = ?");
            values.push(req.user.company_id);
        }

        if (category_id) {
            addInFilter(where, values, "t.category_id", category_id);
        }

        if (is_parent) {
            where.push("t.is_parent = ?");
            values.push(is_parent);
        }

        if (parent_id) {
            where.push("t.parent_id = ?");
            values.push(parent_id);
        }

        if (status) {
            addInFilter(where, values, "t.status", status);
        }

        if (is_system) {
            where.push("t.is_sys_category = ?");
            values.push("yes");
        }

        if (childOf === "yes" && searchText) {
            const parentRows = await CommonModel.GetMasterListDetails({
                select: "t.category_id",
                table: MODULE_TABLE,
                where: ["t.categoryName = ?"],
                values: [searchText],
            });

            if (parentRows.length) {
                where.push("t.parent_id = ?");
                values.push(parentRows[0].category_id);
            }
        }

        const total = await CommonModel.getCountsByParameter({ table: MODULE_TABLE, where, values, join, other });
        const totalPages = Math.ceil(total / limit);
        const end = Math.min(start + limit, total);

        let categoryDetails = [];
        if (getAll === "Y") {
            categoryDetails = await CommonModel.GetMasterListDetails({ select: "t.*", table: MODULE_TABLE, where, values, other: { orderBy: "t.categories_index", order: "ASC" } });
        } else {
            const listSelect = select ? `t.*,${select.replace(/^t\.\*,?/, "")}` : "t.*";
            categoryDetails = await CommonModel.GetMasterListDetails({
                select: listSelect,
                table: MODULE_TABLE,
                where,
                values,
                limit,
                start,
                join,
                other,
            });
        }

        if (isSub === "Y") {
            await addSubLists(categoryDetails);
        } else {
            await addParentMeta(categoryDetails);

            if (parent_id) {
                categoryDetails.sort((a, b) => Number(a.categories_index || 0) - Number(b.categories_index || 0));
            }
        }

        return successResponse(res, {
            code: 1004,
            httpStatus: 200,
            data: {
                data: categoryDetails,
                pagination: {
                    total,
                    page: currentPage,
                    limit,
                    totalPages,
                    start: total === 0 ? 0 : start + 1,
                    end,
                },
                paginginfo: {
                    curPage: currentPage,
                    prevPage: currentPage <= 1 ? 0 : currentPage - 1,
                    pageLimit: limit,
                    nextpage: currentPage + 1,
                    totalRecords: total,
                    start,
                    end: start + limit,
                },
            },
        });
    } catch (error) {
        return failureResponse(res, {
            code: 2008,
            httpStatus: 500,
            message: error.message,
        });
    }
};

// ======================================================
// CREATE / UPDATE / GET SINGLE
// ======================================================
export const categoryMaster = async (req, res) => {
    try {
        const method = req.method.toUpperCase();
        const { id: category_id = null } = req.params;

        switch (method) {
            case "PUT": {
                const payload = buildCategoryPayload(req.body);
                const validationMessage = validateCategoryPayload(payload, true);
                if (validationMessage) {
                    return failureResponse(res, {
                        code: 2001,
                        httpStatus: 400,
                        message: validationMessage,
                    });
                }

                const { categoryName, slug, parentSlug } = req.body;
                const existingRows = await CommonModel.getMasterDetails(MODULE_TABLE, "*", { categoryName, slug });

                if (existingRows.length) {
                    return failureResponse(res, {
                        code: 2000,
                        httpStatus: 409,
                        message: "Category already exists",
                    });
                }

                const data = await buildTablePayload(MODULE_TABLE, {
                    ...payload,
                    status: req.body.status || "active",
                    company_id: req.user.company_id || null,
                    created_by: req.user.adminID,
                    created_date: toMysqlDateTime(),
                });

                if (parentSlug) {
                    const parentRows = await CommonModel.getMasterDetails(MODULE_TABLE, "*", { slug: parentSlug });
                    data.parent_id = parentRows[0]?.category_id || null;
                }

                const result = await CommonModel.saveMasterDetails({ table: MODULE_TABLE, data });

                return successResponse(res, {
                    code: 1001,
                    httpStatus: 201,
                    data: {
                        insertId: result.insertId,
                    },
                });
            }

            case "POST": {
                if (!category_id) {
                    return failureResponse(res, {
                        code: 2004,
                        httpStatus: 404,
                    });
                }

                const payload = buildCategoryPayload(req.body);
                const validationMessage = validateCategoryPayload(payload, false);
                if (validationMessage) {
                    return failureResponse(res, {
                        code: 2001,
                        httpStatus: 400,
                        message: validationMessage,
                    });
                }

                const data = await buildTablePayload(MODULE_TABLE, {
                    ...payload,
                    modified_by: req.user.adminID,
                    modified_date: toMysqlDateTime(),
                });

                const result = await CommonModel.updateMasterDetails({
                    table: MODULE_TABLE,
                    data,
                    where: { category_id },
                });

                if (!result.affectedRows) {
                    return failureResponse(res, {
                        code: 2004,
                        httpStatus: 404,
                    });
                }

                return successResponse(res, {
                    code: 1002,
                    httpStatus: 200,
                    data: [],
                });
            }

            case "GET": {
                if (!category_id) {
                    return failureResponse(res, {
                        code: 2004,
                        httpStatus: 404,
                    });
                }

                const details = await CommonModel.getMasterDetails(MODULE_TABLE, "*", { category_id });

                if (!details.length) {
                    return failureResponse(res, {
                        code: 2004,
                        httpStatus: 404,
                    });
                }

                return successResponse(res, {
                    code: 1004,
                    httpStatus: 200,
                    data: { data: details[0] },
                });
            }

            default:
                return failureResponse(res, {
                    code: 2000,
                    httpStatus: 405,
                });
        }
    } catch (error) {
        return failureResponse(res, {
            code: 2008,
            httpStatus: 500,
            message: error.message,
        });
    }
};

// ======================================================
// CHANGE STATUS
// ======================================================

export const changeStatus = async (req, res) => {
    try {
        const { action = "", ids = [] } = req.body;

        if (action.trim().toLowerCase() !== "delete") {
            return failureResponse(res, {
                code: 2000,
                httpStatus: 400,
                message: "Invalid action",
            });
        }

        if (!Array.isArray(ids) || !ids.length) {
            return failureResponse(res, {
                code: 2001,
                httpStatus: 400,
                message: "ids are required",
            });
        }

        const where = { category_id: ids };
        if (!isSuperAdmin(req.user) && req.user.company_id) {
            where.company_id = req.user.company_id;
        }
        where.is_sys_category = 'no';
        await CommonModel.deleteMasterDetails({
            table: MODULE_TABLE,
            where,
        });

        return successResponse(res, {
            code: 1003,
            httpStatus: 200,
            data: [],
        });
    } catch (error) {
        return failureResponse(res, {
            code: 2008,
            httpStatus: 500,
            message: error.message,
        });
    }
};

// ======================================================
// GET SLUG LIST
// ======================================================
export const getslugList = async (req, res) => {
    try {
        const { slug = "", status = "", category_id = "", is_parent = "" } = req.body;
        const where = [];
        const values = [];
        const other = {
            orderBy: "t.categories_index",
            order: "ASC",
        };

        addInFilter(where, values, "t.status", status);
        addInFilter(where, values, "t.slug", slug);
        addInFilter(where, values, "t.category_id", category_id);

        if (is_parent) {
            where.push("t.is_parent = ?");
            values.push(is_parent);
        }

        const categoryDetails = await CommonModel.GetMasterListDetails({
            select: "t.category_id,t.slug,t.categoryName,t.parent_id,t.is_parent,t.categories_index",
            table: MODULE_TABLE,
            where,
            values,
            other,
        });

        for (const row of categoryDetails) {
            row.sublist = await CommonModel.GetMasterListDetails({
                select: "t.category_id,t.slug,t.categoryName,t.parent_id,t.is_parent,t.categories_index,t.cat_color",
                table: MODULE_TABLE,
                where: [
                    "t.parent_id = ?",
                    "t.status = ?",
                ],
                values: [
                    row.category_id,
                    "active",
                ],
                other,
            });
        }

        if (!categoryDetails.length) {
            return failureResponse(res, {
                code: 2004,
                httpStatus: 404,
                message: "No records found",
            });
        }

        return successResponse(res, {
            code: 1004,
            httpStatus: 200,
            data: {
                data: categoryDetails,
            },
        });
    } catch (error) {
        return failureResponse(res, {
            code: 2008,
            httpStatus: 500,
            message: error.message,
        });
    }
};

// ======================================================
// CHANGE POSITIONS
// ======================================================
export const changePosition = async (req, res) => {
    try {
        const { action = "", menu_ids = [] } = req.body;

        if (action.trim() !== "changePositions") {
            return failureResponse(res, {
                code: 2000,
                httpStatus: 400,
                message: "Invalid action",
            });
        }

        if (!Array.isArray(menu_ids) || !menu_ids.length) {
            return failureResponse(res, {
                code: 2001,
                httpStatus: 400,
                message: "menu_ids are required",
            });
        }

        for (const [index, categoryId] of menu_ids.entries()) {
            await CommonModel.updateMasterDetails({
                table: MODULE_TABLE,
                data: {
                    categories_index: index + 1,
                },
                where: {
                    category_id: categoryId,
                },
            });
        }

        return successResponse(res, {
            code: 1002,
            httpStatus: 200,
            data: [],
        });
    } catch (error) {
        return failureResponse(res, {
            code: 2008,
            httpStatus: 500,
            message: error.message,
        });
    }
};

// ======================================================
// CATEGORY ID BY SLUG
// ======================================================
export const categoryIDBySlug = async (req, res) => {
    try {
        const { slug } = req.params;
        const details = await CommonModel.getMasterDetails(MODULE_TABLE, "category_id,slug", { slug });

        if (!details.length) {
            return failureResponse(res, {
                code: 2004,
                httpStatus: 404,
            });
        }

        return successResponse(res, {
            code: 1004,
            httpStatus: 200,
            data: {
                data: details,
            },
        });
    } catch (error) {
        return failureResponse(res, {
            code: 2008,
            httpStatus: 500,
            message: error.message,
        });
    }
};

// ======================================================
// MULTIPLE STATUS / DELETE
// ======================================================
export const multiplecategoryChangeStatus = async (req, res) => {
    try {
        const { action = "", list = [], status = "" } = req.body;
        const ids = normalizeIds(list);

        if (!ids.length) {
            return failureResponse(res, {
                code: 2001,
                httpStatus: 400,
                message: "list is required",
            });
        }

        if (action.trim() === "delete") {
            await CommonModel.deleteMasterDetails({
                table: MODULE_TABLE,
                where: {
                    category_id: ids,
                },
            });
        } else {
            await updateCategoryStatus(ids, status || action);
        }

        return successResponse(res, {
            code: action.trim() === "delete" ? 1003 : 1002,
            httpStatus: 200,
            data: [],
        });
    } catch (error) {
        return failureResponse(res, {
            code: 2008,
            httpStatus: 500,
            message: error.message,
        });
    }
};

// ======================================================
// PARTIAL UPDATE
// ======================================================
export const categoryUpdate = async (req, res) => {
    try {
        const { id: category_id } = req.params;
        let { data } = req.body;

        if (!category_id) {
            return failureResponse(res, {
                code: 2004,
                httpStatus: 404,
            });
        }

        if (!data) {
            return failureResponse(res, {
                code: 2001,
                httpStatus: 400,
                message: "data is required",
            });
        }

        if (typeof data === "string") {
            data = JSON.parse(data);
        }

        const payload = await buildTablePayload(MODULE_TABLE, {
            ...data,
            modified_by: req.user.adminID,
            modified_date: toMysqlDateTime(),
        });

        const result = await CommonModel.updateMasterDetails({
            table: MODULE_TABLE,
            data: payload,
            where: { category_id },
        });

        if (!result.affectedRows) {
            return failureResponse(res, {
                code: 2004,
                httpStatus: 404,
            });
        }

        return successResponse(res, {
            code: 1002,
            httpStatus: 200,
            data: [],
        });
    } catch (error) {
        return failureResponse(res, {
            code: 2008,
            httpStatus: 500,
            message: error.message,
        });
    }
};

const validateCategoryPayload = (body = {}, isCreate = false) => {
    const requiredFields = [
        ["categoryName", "Category Name"],
        ["slug", "Category Slug"],
        ["is_parent", "Category Parent"],
    ];

    for (const [field, label] of requiredFields) {
        if (!body[field]) {
            return `${label} is required`;
        }
    }

    return null;
};

const buildCategoryPayload = (body = {}) => {
    const data = {};

    data.category_id = pickValue(body.category_id);
    data.parent_id = pickValue(body.parent_id);
    data.categoryName = pickValue(body.categoryName);
    data.slug = pickValue(body.slug);
    data.is_parent = pickValue(body.is_parent);
    data.description = pickValue(body.description);
    data.cover_image = pickValue(body.cover_image);
    data.cat_color = pickValue(body.cat_color);
    data.status = pickValue(body.status);

    Object.keys(data).forEach((key) => {
        if (data[key] === undefined) {
            delete data[key];
        }
    });

    return data;
};


const normalizeIds = (value) => {
    if (Array.isArray(value)) {
        return value;
    }

    if (typeof value === "string") {
        return value.split(",").map((item) => item.trim()).filter(Boolean);
    }

    return value ? [value] : [];
};

const addInFilter = (where, values, column, rawValue) => {
    const items = normalizeIds(rawValue);
    if (!items.length) {
        return;
    }

    where.push(`${column} IN (${items.map(() => "?").join(",")})`);
    values.push(...items);
};

const updateCategoryStatus = async (ids = [], status = "") => {
    const placeholders = ids.map(() => "?").join(",");
    const sql = `UPDATE ${DB_PREFIX}${MODULE_TABLE} SET status = ? WHERE category_id IN (${placeholders})`;
    return await query(sql, [status, ...ids]);
};

const addParentMeta = async (rows = []) => {
    for (const row of rows) {
        if (!row.parent_id) {
            row.parentCatName = "--";
            continue;
        }

        const parentRows = await CommonModel.GetMasterListDetails({
            select: "t.categoryName",
            table: MODULE_TABLE,
            where: ["t.category_id = ?"],
            values: [row.parent_id],
            other: {
                orderBy: "t.categories_index",
                order: "ASC",
            },
        });

        row.parentCatName = parentRows[0]?.categoryName || "--";
    }
};

const addSubLists = async (rows = []) => {
    for (const row of rows) {
        row.SubList = await CommonModel.GetMasterListDetails({
            select: "t.category_id,t.categoryName,t.slug",
            table: MODULE_TABLE,
            where: [
                "t.parent_id = ?",
                "t.status = ?",
            ],
            values: [
                row.category_id,
                "active",
            ],
            other: {
                orderBy: "t.categories_index",
                order: "ASC",
            },
        });
    }
};
