import assert from "node:assert/strict";
import { query, DB_PREFIX } from "../config/database.js";
import { buildProductionNote } from "../modules/orders/booking/production-note.service.js";
import * as booking from "../modules/orders/booking/booking.controller.js";
import * as planning from "../modules/orders/planning/planning.controller.js";
import * as dispatch from "../modules/orders/dispatch/dispatch.controller.js";
import * as dashboard from "../modules/dashboard/dashboard.model.js";
const user={adminID:1,role_slug:"super_admin"};
const response=()=>({status(code){this.code=code;return this;},json(value){assert(this.code<400,JSON.stringify(value));this.value=value;return this;}});
try{
 const rows=await query(`SELECT * FROM ${DB_PREFIX}orders WHERE status <> 'delete' LIMIT 1`);
 assert(rows.length>0);
 const note=await buildProductionNote(rows[0].order_id);assert(note.html.includes("PRODUCTION NOTE"));
 for(const handler of [booking.list,planning.list,dispatch.list]){const res=response();await handler({body:{},params:{},user},res);assert(res.value);}
 const details=response();await booking.getOrderDetails({method:"GET",params:{id:rows[0].order_id},user},details);assert(details.value);
 const report=await dashboard.getDashboardOverview(user,{});assert(report.lifecycle.rows.length>0);
 console.log(JSON.stringify({verified:true,notes:report.lifecycle.summary.total_orders,qty:report.lifecycle.summary.total_order_qty,preview:true,booking:true,planning:true,dispatch:true}));
 process.exit(0);
}catch(error){console.error(error.stack);process.exit(1);}
