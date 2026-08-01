ALTER TABLE ab_orders
MODIFY COLUMN order_status enum (
    'draft',
    'waiting',
    'confirmed',
    'planned',
    'production',
    'ready',
    'dispatch',
    'hold',
    'cancelled',
    'completed'
) NOT NULL DEFAULT 'draft';

CREATE TABLE IF NOT EXISTS ab_order_item_production (
    production_id int NOT NULL AUTO_INCREMENT,
    company_id int NOT NULL,
    order_id int NOT NULL,
    order_item_id int NOT NULL,
    available_stock_qty decimal(15,2) NOT NULL DEFAULT 0,
    saipl_mfg_qty decimal(15,2) NOT NULL DEFAULT 0,
    pmk_procure_qty decimal(15,2) NOT NULL DEFAULT 0,
    produced_qty decimal(15,2) NOT NULL DEFAULT 0,
    procured_qty decimal(15,2) NOT NULL DEFAULT 0,
    qc_passed_qty decimal(15,2) NOT NULL DEFAULT 0,
    rework_qty decimal(15,2) NOT NULL DEFAULT 0,
    ready_qty decimal(15,2) NOT NULL DEFAULT 0,
    pending_qty decimal(15,2) NOT NULL DEFAULT 0,
    production_status enum ('not_started','in_progress','partially_ready','ready','hold','completed') NOT NULL DEFAULT 'not_started',
    start_date date DEFAULT NULL,
    expected_ready_date date DEFAULT NULL,
    completed_date date DEFAULT NULL,
    priority enum ('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
    remarks text DEFAULT NULL,
    created_by int DEFAULT NULL,
    created_date datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    modified_by int DEFAULT NULL,
    modified_date datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    status enum ('active','inactive','delete') NOT NULL DEFAULT 'active',
    PRIMARY KEY (production_id),
    UNIQUE KEY uk_ab_production_order_item (order_item_id),
    KEY idx_ab_production_order (order_id),
    KEY idx_ab_production_company_status (company_id, production_status, status)
);

CREATE TABLE IF NOT EXISTS ab_order_item_production_history (
    history_id int NOT NULL AUTO_INCREMENT,
    company_id int NOT NULL,
    production_id int NOT NULL,
    order_item_id int NOT NULL,
    old_ready_qty decimal(15,2) DEFAULT NULL,
    new_ready_qty decimal(15,2) DEFAULT NULL,
    old_production_status varchar(50) DEFAULT NULL,
    new_production_status varchar(50) DEFAULT NULL,
    changed_by int DEFAULT NULL,
    changed_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    note text DEFAULT NULL,
    PRIMARY KEY (history_id),
    KEY idx_ab_production_history_item (order_item_id),
    KEY idx_ab_production_history_company (company_id)
);
