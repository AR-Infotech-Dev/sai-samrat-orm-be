*** Roles 

1. Super Admin 
    - Company create/manage करणे
    - Users create/manage करणे
    - Roles assign करणे
    - Menu access manage करणे
    - Module permissions set करणे
    - Master data cleanup
    - System settings
2. Admin
3. Management / Owner
    - Total order dashboard पाहणे
    - Confirmed / Waiting / Hold / Pending qty पाहणे
    - Customer-wise आणि product-wise reports पाहणे
    - High priority orders review करणे
    - Hold/Cancel/Approve decisions घेणे
    - Excel export घेणे
4. Salesman
    - Customer order receive करणे
    - Customer select/create करणे
    - Product select करून order items add करणे
    - Quantity/rate enter करणे
    - Order Waiting किंवा Confirmed करणे
    - Customer remarks add करणे
    - Own orders track करणे
5. Sales Manager 
    - Sales team orders review
    - Order confirmation approve
    - High value orders check
    - Hold/cancel request approve
    - Customer-wise sales report पाहणे
6. Planning / Operations User - हा order planning करणारा role आहे.
    - Confirmed orders पाहणे
    - Product-wise order items plan करणे
    - SAIPL Qty enter करणे
    - PMK Qty enter करणे
    - Planning status update करणे
    - Priority set करणे
    - Ready quantity update करणे
7. Production User
    - Planned SAIPL quantity पाहणे
    - Production progress update करणे
    - Ready qty update करणे
    - Production remarks add करणे


** Sales flow ** 
Customer order received
→ Sales creates order
→ Adds product-wise order items
→ Marks status Waiting or Confirmed
→ Sales Manager/Admin reviews if needed

** Planning flow **
Confirmed order
→ Planning user opens order item planning
→ Enters SAIPL qty and PMK qty
→ Updates ready qty
→ Pending qty auto-calculates
→ Dashboard updates

** Management flow **
Open dashboard
→ Check total orders / pending / ready / PMK / SAIPL
→ Click KPI drill-down
→ Export report if needed