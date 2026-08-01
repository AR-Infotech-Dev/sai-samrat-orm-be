-- PRODUCTS 
-- Product data Tally à¤®à¤§à¥‚à¤¨ à¤¯à¥‡à¤£à¤¾à¤° à¤†à¤¹à¥‡. à¤¤à¥à¤¯à¤¾à¤®à¥à¤³à¥‡ tally_item_id, product_code, brand, rate, sync date à¤²à¤¾à¤—à¤¤à¥€à¤².
ALTER TABLE ab_products
ADD COLUMN tally_item_id varchar(100) DEFAULT NULL AFTER product_id,
ADD COLUMN product_code varchar(100) DEFAULT NULL AFTER tally_item_id,
ADD COLUMN brand varchar(150) DEFAULT NULL AFTER product_name,
ADD COLUMN category_id int DEFAULT NULL AFTER brand,
ADD COLUMN unit varchar(50) DEFAULT 'Nos' AFTER category_id,
ADD COLUMN standard_rate decimal(15, 2) DEFAULT 0 AFTER unit,
ADD COLUMN gst_rate decimal(5, 2) DEFAULT 0 AFTER standard_rate,
ADD COLUMN is_tally_synced enum ('yes', 'no') NOT NULL DEFAULT 'no' AFTER gst_rate,
ADD COLUMN last_tally_sync_at datetime DEFAULT NULL AFTER is_tally_synced,
ADD COLUMN status enum ('active', 'inactive', 'delete') NOT NULL DEFAULT 'active' AFTER modified_date;

CREATE INDEX idx_ab_products_tally_item_id ON ab_products (tally_item_id);

CREATE INDEX idx_ab_products_company_status ON ab_products (company_id, status);

-- ORDERS
-- Order à¤®à¥à¤¹à¤£à¤œà¥‡ customer demand.
CREATE TABLE
    ab_orders (
        order_id int NOT NULL AUTO_INCREMENT,
        order_no varchar(50) NOT NULL,
        company_id int NOT NULL,
        customer_id int NOT NULL,
        brand varchar(150) DEFAULT NULL,
        order_date date NOT NULL,
        order_month varchar(20) DEFAULT NULL,
        order_week varchar(50) DEFAULT NULL,
        sales_person_id int DEFAULT NULL,
        expected_delivery_date date DEFAULT NULL,
        order_status enum (
            'draft',
            'waiting',
            'confirmed',
            'planned',
            'hold',
            'cancelled',
            'completed'
        ) NOT NULL DEFAULT 'draft',
        priority enum ('low', 'normal', 'high', 'urgent') NOT NULL DEFAULT 'normal',
        total_order_qty decimal(15, 2) NOT NULL DEFAULT 0,
        total_order_value decimal(15, 2) NOT NULL DEFAULT 0,
        currency varchar(10) NOT NULL DEFAULT 'INR',
        exchange_rate decimal(15, 4) DEFAULT NULL,
        total_value_in_inr decimal(15, 2) DEFAULT NULL,
        source varchar(50) DEFAULT 'manual',
        excel_row_no int DEFAULT NULL,
        remarks text DEFAULT NULL,
        created_by int DEFAULT NULL,
        created_date datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        modified_by int DEFAULT NULL,
        modified_date datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        status enum ('active', 'inactive', 'delete') NOT NULL DEFAULT 'active',
        PRIMARY KEY (order_id),
        UNIQUE KEY uk_ab_orders_order_no_company (company_id, order_no),
        KEY idx_ab_orders_customer (customer_id),
        KEY idx_ab_orders_company_status (company_id, order_status, status),
        KEY idx_ab_orders_order_date (order_date)
    );

-- ORDER-ITEMS
CREATE TABLE
    ab_order_items (
        order_item_id int NOT NULL AUTO_INCREMENT,
        company_id int NOT NULL,
        order_id int NOT NULL,
        product_id int NOT NULL,
        product_code_snapshot varchar(100) DEFAULT NULL,
        product_name_snapshot varchar(250) NOT NULL,
        brand_snapshot varchar(150) DEFAULT NULL,
        order_qty decimal(15, 2) NOT NULL DEFAULT 0,
        unit_rate decimal(15, 2) NOT NULL DEFAULT 0,
        line_value decimal(15, 2) NOT NULL DEFAULT 0,
        item_status enum ('active', 'hold', 'cancelled', 'completed') NOT NULL DEFAULT 'active',
        expected_delivery_date date DEFAULT NULL,
        remarks text DEFAULT NULL,
        created_by int DEFAULT NULL,
        created_date datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        modified_by int DEFAULT NULL,
        modified_date datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        status enum ('active', 'inactive', 'delete') NOT NULL DEFAULT 'active',
        PRIMARY KEY (order_item_id),
        KEY idx_ab_order_items_order (order_id),
        KEY idx_ab_order_items_product (product_id),
        KEY idx_ab_order_items_company_product (company_id, product_id),
        KEY idx_ab_order_items_status (item_status, status)
    );

-- ORDER-PLANNING
-- planned_qty = saipl_qty + pmk_qty
-- pending_qty = order_qty - ready_qty - dispatched_qty
CREATE TABLE
    ab_order_item_planning (
        planning_id int NOT NULL AUTO_INCREMENT,
        company_id int NOT NULL,
        order_id int NOT NULL,
        order_item_id int NOT NULL,
        saipl_qty decimal(15, 2) NOT NULL DEFAULT 0,
        pmk_qty decimal(15, 2) NOT NULL DEFAULT 0,
        planned_qty decimal(15, 2) NOT NULL DEFAULT 0,
        ready_qty decimal(15, 2) NOT NULL DEFAULT 0,
        dispatched_qty decimal(15, 2) NOT NULL DEFAULT 0,
        pending_qty decimal(15, 2) NOT NULL DEFAULT 0,
        planning_status enum (
            'not_planned',
            'planned',
            'in_progress',
            'partially_ready',
            'ready',
            'completed',
            'hold'
        ) NOT NULL DEFAULT 'not_planned',
        planned_date date DEFAULT NULL,
        expected_ready_date date DEFAULT NULL,
        priority enum ('low', 'normal', 'high', 'urgent') NOT NULL DEFAULT 'normal',
        planning_note text DEFAULT NULL,
        created_by int DEFAULT NULL,
        created_date datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        modified_by int DEFAULT NULL,
        modified_date datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        status enum ('active', 'inactive', 'delete') NOT NULL DEFAULT 'active',
        PRIMARY KEY (planning_id),
        UNIQUE KEY uk_ab_planning_order_item (order_item_id),
        KEY idx_ab_planning_order (order_id),
        KEY idx_ab_planning_company_status (company_id, planning_status, status)
    );

-- ORDER-HISTORY
CREATE TABLE
    ab_order_history (
        history_id int NOT NULL AUTO_INCREMENT,
        company_id int NOT NULL,
        order_id int NOT NULL,
        old_status varchar(50) DEFAULT NULL,
        new_status varchar(50) NOT NULL,
        changed_by int DEFAULT NULL,
        changed_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        note text DEFAULT NULL,
        PRIMARY KEY (history_id),
        KEY idx_ab_order_status_history_order (order_id),
        KEY idx_ab_order_status_history_company (company_id)
    );

-- PLANNING-HSTORY
CREATE TABLE
    ab_order_item_planning_history (
        history_id int NOT NULL AUTO_INCREMENT,
        company_id int NOT NULL,
        planning_id int NOT NULL,
        order_item_id int NOT NULL,
        old_saipl_qty decimal(15, 2) DEFAULT NULL,
        new_saipl_qty decimal(15, 2) DEFAULT NULL,
        old_pmk_qty decimal(15, 2) DEFAULT NULL,
        new_pmk_qty decimal(15, 2) DEFAULT NULL,
        old_ready_qty decimal(15, 2) DEFAULT NULL,
        new_ready_qty decimal(15, 2) DEFAULT NULL,
        old_planning_status varchar(50) DEFAULT NULL,
        new_planning_status varchar(50) DEFAULT NULL,
        changed_by int DEFAULT NULL,
        changed_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        note text DEFAULT NULL,
        PRIMARY KEY (history_id),
        KEY idx_ab_planning_history_item (order_item_id),
        KEY idx_ab_planning_history_company (company_id)
    );
