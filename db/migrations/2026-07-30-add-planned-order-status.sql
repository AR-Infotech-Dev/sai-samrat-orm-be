ALTER TABLE ab_orders
MODIFY COLUMN order_status enum (
    'draft',
    'waiting',
    'confirmed',
    'planned',
    'hold',
    'cancelled',
    'completed'
) NOT NULL DEFAULT 'draft';
