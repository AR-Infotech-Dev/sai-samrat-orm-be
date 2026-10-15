import { buildProductionNote } from "./production-note.service.js";
import { renderProformaPdf } from "../proforma-invoice/proforma-pdf.service.js";
import { successResponse, failureResponse } from "#shared/utils/apiResponse.js";

export const productionNote = async (req, res) => {
  try {
    const result = await buildProductionNote(req.params.id);
    if (!result) return failureResponse(res, { code: 2004, httpStatus: 404, message: "Order not found" });
    if (req.path.endsWith("/pdf")) {
      const buffer = await renderProformaPdf(result.html);
      const name = String(result.invoice.pi_no).replace(/[^a-zA-Z0-9_-]/g, "_");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${name} - Production Note.pdf"`);
      return res.send(buffer);
    }
    return successResponse(res, { code: 1004, httpStatus: 200, data: result });
  } catch (error) {
    return failureResponse(res, { code: 2008, httpStatus: 500, message: error.message });
  }
};
