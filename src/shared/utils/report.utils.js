import { env } from "#config/env.js";
export const CLOSED_STATUS = "208";
import {
  buildSheetSpacerRow,
  buildSideBySideRows,
  excelFormat
} from "./excel.utils.js";
import { renderTemplate } from "./templateMaker.js"

export const formatDate = (value = null) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};
export const stripHtml = (value = "") => String(value || "").replace(/<[^>]*>/g, "");
export const isResolvedStatus = (row = {}) => {
  const statusId = String(row.ticket_status_id || row.ticket_status || "").trim();
  const statusName = String(row.ticket_status || "").trim().toLowerCase();

  return (
    statusId === CLOSED_STATUS ||
    statusName.includes("resolve") ||
    statusName.includes("closed") ||
    statusName.includes("complete")
  );
};
export const parseJsonArray = (value) => {
  if (Array.isArray(value)) return value;

  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed
      : [];
  } catch {
    return [];
  }
};
export const isActiveAMC = (customer = {}) => {
  const amcEndDate = customer?.amc_end_date
    ? new Date(customer.amc_end_date)
    : null;

  return (
    String(customer?.is_amc || "").toLowerCase() === "yes" &&
    amcEndDate &&
    amcEndDate >= new Date()
  );
};
export const buildSupportReportTemplate = async ({ customer = {}, supportCallCount = 0, summary = {}, products = [], }) => {
  return renderTemplate(
    "customerReport",
    "email",
    {
      customerName: customer.name || "Customer",
      companyName: env?.appName || "Support System",
      logoUrl: "https://sathiconnect.flowups.in/assets/sathi-connect-logo.png",
      amcStartDate: formatDate(customer.amc_start_date),
      amcEndDate: formatDate(customer.amc_end_date),
      supportCallCount,
      isActiveAMC: isActiveAMC(customer),
      summaryCards: [
        {
          label: "Total Tickets",
          value: summary.total || 0,
          bg: "#eff6ff",
          color: "#0f172a",
        },
        {
          label: "Resolved",
          value: summary.resolved || 0,
          bg: "#ecfdf5",
          color: "#166534",
        },
        {
          label: "Pending",
          value: summary.pending || 0,
          bg: "#fff7ed",
          color: "#c2410c",
        },
        {
          label: "Overdue",
          value: summary.overdue || 0,
          bg: "#fef2f2",
          color: "#dc2626",
        },
      ],
      products,
    }
  );
};
export const buildReportAttachment = async ({ customer = {}, summary = {}, supportRows = [], }) => {
  const spreadsheetColumnCount = 9;
  const activeAMC = isActiveAMC(customer);
  const htmlBody = await renderTemplate(
    "customerReport",
    "excel",
    {
      spreadsheetColumnCount,
      reportTitle: activeAMC
        ? "AMC Customer Support Report"
        : "Customer Support Report",
      spacerRow: await buildSheetSpacerRow(18, spreadsheetColumnCount),
      summarySection: await buildSideBySideRows({
        leftTitle: "Summary",
        leftData: summary,
        rightTitle: activeAMC
          ? "Report Details"
          : "",
        rightData: activeAMC
          ? {
            customer: customer.name || "-",
            amc_start_date: formatDate(customer.amc_start_date),
            amc_expiry_date: formatDate(customer.amc_end_date),
            generated_on: formatDate(new Date()),
          }
          : null,
        gapCols: 3,
        labelColspan: 1,
        valueColspan: 2,
      }),
      hasSupportRows: supportRows.length > 0,
      supportRows: supportRows.map(
        (row, index) => ({
          srNo: index + 1,
          ticket_no: row.ticket_no || "-",
          created_date: row.created_date || "-",
          due_date: row.due_date || "-",
          query_type: row.query_type || "-",
          ticket_status: row.ticket_status || "-",
          ticket_priority: row.ticket_priority || "-",
          assignee: row.assignee_name || "-",
          resolver: row.resolver_name || "-",
          statusClass: isResolvedStatus(row)
            ? "excel-status-closed"
            : "excel-status-open",
        })
      ),
    }
  );

  return {
    filename: `Customer-Report-${customer.name || "customer"}.xls`,
    content: await excelFormat(htmlBody),
    contentType: "application/vnd.ms-excel",
  };
};
// buildPerformanceExcelAttachment({ filters, summary, tickets, user: userDetails })
export const buildPerformanceExcelAttachment = async ({ filters = {}, summary = {}, tickets = [], user = {} }) => {
  const userName = user.name || user.userName || user.email || filters.user_name || "Selected User";

  const spreadsheetColumnCount = 9;
  const formatResolutionDuration = (ticket = {}) => {
    const totalSeconds = Number.isFinite(Number(ticket.resolution_time_seconds))
      ? Math.max(0, Math.round(Number(ticket.resolution_time_seconds)))
      : Math.max(0, Math.round(Number(ticket.resolution_time || 0) * 60));
    return `${Math.floor(totalSeconds / 60)} min ${totalSeconds % 60} sec`;
  };
  const details = {
    'User Name': filters.user_name || '-',
    'Order By': filters.order_by || '-',
    'Order': filters.order || '-',
    'From Date': filters.from_date || '-',
    'To Date': filters.to_date || '-',
  }
  const summaryDetails = {
    "Assigned": summary.assigned || 0,
    "Generated": summary.generated || 0,
    "Closed": summary.closed || 0,
    "Pending": summary.pending || 0,
    "Delegated": summary.delegated || 0,
    "Overdue": summary.overdue || 0,
    "Productivity Score": summary.productivity_score || 0,
    "Avg Resolution Time": summary.avg_resolution_time || 0,
  }
  const htmlBody = await renderTemplate(
    "userPerformanceReport",
    "excel",
    {
      spreadsheetColumnCount,
      reportTitle: "User Performance Report",
      user: user,
      spacerRow: await buildSheetSpacerRow(18, spreadsheetColumnCount),
      summarySection: await buildSideBySideRows({
        leftTitle: "Summary",
        leftData: summaryDetails,
        rightTitle: "Report Details",
        rightData: details,
        gapCols: 3,
        labelColspan: 1,
        valueColspan: 2,
      }),
      hasSupportRows: tickets.length > 0,
      supportRows: tickets.map(
        (row, index) => ({
          srNo: index + 1,
          customer_name: row.customer_name || "-",
          created_date: formatDate(row.created_date) || "-",
          ticket_priority: row.ticket_priority || "-",
          ticket_status: row.ticket_status || "-",
          assigned_date: formatDate(row.assigned_date) || "-",
          due_date: formatDate(row.due_date) || "-",
          call_direction: row.call_direction === "in" ? "Incomming" : "Outgoing",
          resolution_time: formatResolutionDuration(row) || "-",
        })
      ),
    }
  );

  return {
    filename: `Perfonrmance-Report-${filters.user_name || "User"}.xls`,
    content: await excelFormat(htmlBody),
    contentType: "application/vnd.ms-excel",
  };
};
export const buildCustomerWiseExcelAttachment = async ({ company = {}, customers = [], filters = {}, summary = {} }) => {
  const spreadsheetColumnCount = 9;
  const details = {
    'Company ID': company.company_id || '-',
    'Company Name': company.company_name || '-',
    'From Date': filters.from_date || '-',
    'To Date': filters.to_date || '-',
  }
  const summaryDetails = {
    "Total Customers": summary.total_customers || 0,
    "Total Tickets": summary.total_tickets || 0,
    "Customer With Tickets": summary.customers_with_tickets || 0,
    "Customer Without Tickets": summary.customers_without_tickets || 0,
    "Open": summary.open_tickets || 0,
    "Closed": summary.closed_tickets || 0,
    "In Progress": summary.in_progress_tickets || 0,
    "Overdue": summary.overdue_tickets || 0,
  }
  const htmlBody = await renderTemplate(
    "customerwiseReport",
    "excel",
    {
      spreadsheetColumnCount,
      reportTitle: "Customer Wise Report",
      spacerRow: await buildSheetSpacerRow(18, spreadsheetColumnCount),
      summarySection: await buildSideBySideRows({
        leftTitle: "Summary",
        leftData: summaryDetails,
        rightTitle: "Report Details",
        rightData: details,
        gapCols: 3,
        labelColspan: 1,
        valueColspan: 2,
      }),
      hasSupportRows: customers.length > 0,
      supportRows: customers.map(
        (row, index) => ({
          srNo: index + 1,
          customer_name: row.customer_name || "-",
          contact_person: row.contact_person || "-",
          mobile_no: row.mobile_no || "-",
          total_tickets: row.total_tickets || "0",
          open_tickets: row.open_tickets || "0",
          in_progress_tickets: row.in_progress_tickets || "0",
          closed_tickets: row.closed_tickets || "0",
          overdue_tickets: row.overdue_tickets || "0",
          last_ticket_no: row.last_ticket_no || "-",
          last_ticket_status: row.last_ticket_status || "-",
          last_ticket_date: formatDate(row.last_ticket_date) || "-",
        })
      ),
    }
  );

  return {
    filename: `Customer-wise-report${company.company_name ? "-" + company.company_name : ""}.xls`,
    content: await excelFormat(htmlBody),
    contentType: "application/vnd.ms-excel",
  };
};
