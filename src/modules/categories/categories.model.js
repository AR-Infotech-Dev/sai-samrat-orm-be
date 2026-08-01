import * as CommonModel from "#shared/models/common.model.js";
import { DB_PREFIX, query } from "#config/database.js";
import { MODULE_TABLE } from "./categories.constants.js";

export const getCategoryById = (categoryId) => CommonModel.getMasterDetails(MODULE_TABLE, "*", { category_id: categoryId });

export const createCategory = (data) => CommonModel.saveMasterDetails({ table: MODULE_TABLE, data });

export const updateCategory = (categoryId, data) => CommonModel.updateMasterDetails({ table: MODULE_TABLE, data, where: { category_id: categoryId } });

export const deleteCategories = (ids = []) => CommonModel.deleteMasterDetails({ table: MODULE_TABLE, where: { category_id: ids } });

export const updateCategoryStatus = (ids = [], status = "") => {
  const placeholders = ids.map(() => "?").join(",");
  return query(`UPDATE ${DB_PREFIX}${MODULE_TABLE} SET status = ? WHERE category_id IN (${placeholders})`, [status, ...ids]);
};

