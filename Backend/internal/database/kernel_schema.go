package database

// KernelDDL contains the foundational SQL schema definition for TableEngine Kernel.
const KernelDDL = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Metadata Schema Catalog
CREATE TABLE IF NOT EXISTS sys_db_object (
    sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(80) NOT NULL UNIQUE,
    label VARCHAR(100) NOT NULL,
    super_class_id UUID REFERENCES sys_db_object(sys_id) ON DELETE RESTRICT,
    is_extendable BOOLEAN NOT NULL DEFAULT TRUE,
    is_kernel_table BOOLEAN NOT NULL DEFAULT FALSE,
    sys_created_on TIMESTAMPTZ DEFAULT clock_timestamp()
);

-- 2. Data Dictionary
CREATE TABLE IF NOT EXISTS sys_dictionary (
    sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_id UUID NOT NULL REFERENCES sys_db_object(sys_id) ON DELETE CASCADE,
    column_name VARCHAR(80) NOT NULL,
    label VARCHAR(100) NOT NULL,
    internal_type VARCHAR(40) NOT NULL,
    max_length INTEGER DEFAULT 255,
    is_mandatory BOOLEAN NOT NULL DEFAULT FALSE,
    is_read_only BOOLEAN NOT NULL DEFAULT FALSE,
    default_value TEXT,
    reference_table_id UUID REFERENCES sys_db_object(sys_id),
    is_system_field BOOLEAN NOT NULL DEFAULT FALSE,
    sys_created_on TIMESTAMPTZ DEFAULT clock_timestamp(),
    UNIQUE (table_id, column_name)
);

-- 3. Choice List (Dropdown options)
CREATE TABLE IF NOT EXISTS sys_choice (
    sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_id UUID NOT NULL REFERENCES sys_db_object(sys_id) ON DELETE CASCADE,
    element VARCHAR(80) NOT NULL,
    value VARCHAR(100) NOT NULL,
    label VARCHAR(100) NOT NULL,
    sequence INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    dependent_value VARCHAR(100),
    sys_created_on TIMESTAMPTZ DEFAULT clock_timestamp(),
    UNIQUE (table_id, element, value)
);

-- 4. Identity & Access Management (RBAC)
CREATE TABLE IF NOT EXISTS sys_user (
    sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_name VARCHAR(100) NOT NULL UNIQUE,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100),
    email VARCHAR(254),
    phone VARCHAR(40),
    job_title VARCHAR(120),
    department VARCHAR(120),
    company VARCHAR(120),
    manager_id UUID REFERENCES sys_user(sys_id) ON DELETE RESTRICT,
    locale VARCHAR(20),
    time_zone VARCHAR(80),
    is_service_account BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS sys_user_credential (
    sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES sys_user(sys_id) ON DELETE CASCADE,
    password_hash VARCHAR(255) NOT NULL,
    algorithm VARCHAR(32) NOT NULL DEFAULT 'bcrypt',
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    password_updated_on TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_user_credential_lookup ON sys_user_credential(user_id);

CREATE TABLE IF NOT EXISTS sys_user_group (
    sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    manager_id UUID REFERENCES sys_user(sys_id) ON DELETE RESTRICT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS sys_user_role (
    sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS sys_permission (
    sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(160) NOT NULL UNIQUE,
    description TEXT,
    table_id UUID NOT NULL REFERENCES sys_db_object(sys_id) ON DELETE RESTRICT,
    operation VARCHAR(10) NOT NULL CHECK (operation IN ('create','read','update','delete','execute')),
    field_name VARCHAR(80),
    action_name VARCHAR(100),
    condition_tree JSONB,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CHECK (field_name IS NULL OR operation IN ('create','read','update')),
    CHECK ((operation = 'execute' AND action_name IS NOT NULL AND field_name IS NULL)
        OR (operation <> 'execute' AND action_name IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_permission_resource ON sys_permission(table_id, operation) WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS sys_user_grmember (
    sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES sys_user(sys_id) ON DELETE RESTRICT,
    group_id UUID NOT NULL REFERENCES sys_user_group(sys_id) ON DELETE RESTRICT,
    UNIQUE (user_id, group_id)
);
CREATE INDEX IF NOT EXISTS idx_grmember_group ON sys_user_grmember(group_id, user_id);

CREATE TABLE IF NOT EXISTS sys_group_has_role (
    sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES sys_user_group(sys_id) ON DELETE RESTRICT,
    role_id UUID NOT NULL REFERENCES sys_user_role(sys_id) ON DELETE RESTRICT,
    UNIQUE (group_id, role_id)
);
CREATE INDEX IF NOT EXISTS idx_group_role_role ON sys_group_has_role(role_id, group_id);

CREATE TABLE IF NOT EXISTS sys_role_has_permission (
    sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id UUID NOT NULL REFERENCES sys_user_role(sys_id) ON DELETE RESTRICT,
    permission_id UUID NOT NULL REFERENCES sys_permission(sys_id) ON DELETE RESTRICT,
    UNIQUE (role_id, permission_id)
);
CREATE INDEX IF NOT EXISTS idx_role_permission_permission ON sys_role_has_permission(permission_id, role_id);

-- 5. Auto-Numbering Engine
CREATE TABLE IF NOT EXISTS sys_number (
    sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_id UUID NOT NULL REFERENCES sys_db_object(sys_id) ON DELETE RESTRICT,
    field_name VARCHAR(80) NOT NULL DEFAULT 'number',
    prefix VARCHAR(3) NOT NULL UNIQUE,
    minimum_digits SMALLINT NOT NULL DEFAULT 7 CHECK (minimum_digits BETWEEN 1 AND 19),
    start_number BIGINT NOT NULL DEFAULT 1 CHECK (start_number >= 1),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CHECK (char_length(prefix) BETWEEN 1 AND 3 AND prefix = upper(btrim(prefix))),
    UNIQUE (table_id, field_name)
);

CREATE TABLE IF NOT EXISTS sys_number_counter (
    sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    number_id UUID NOT NULL UNIQUE REFERENCES sys_number(sys_id) ON DELETE RESTRICT,
    last_value BIGINT NOT NULL CHECK (last_value >= 0)
);

-- 6. Universal Audit Trail
CREATE TABLE IF NOT EXISTS sys_audit (
    sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name VARCHAR(80) NOT NULL,
    document_id UUID NOT NULL,
    operation VARCHAR(6) NOT NULL CHECK (operation IN ('INSERT','UPDATE','DELETE')),
    field_name VARCHAR(80) NOT NULL,
    old_value JSONB,
    new_value JSONB,
    changed_on TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    changed_by UUID NOT NULL REFERENCES sys_user(sys_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_audit_doc ON sys_audit(table_name, document_id, changed_on);

-- 7. Business Rules Engine
CREATE TABLE IF NOT EXISTS sys_script (
    sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_id UUID NOT NULL REFERENCES sys_db_object(sys_id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    timing VARCHAR(20) NOT NULL CHECK (timing IN ('before_insert', 'before_update', 'after_insert', 'after_update')),
    execution_order INTEGER NOT NULL DEFAULT 100,
    execution_mode VARCHAR(10) NOT NULL DEFAULT 'caller' CHECK (execution_mode IN ('caller', 'service')),
    run_as_user_id UUID REFERENCES sys_user(sys_id) ON DELETE RESTRICT,
    condition_expression JSONB NOT NULL,
    action_type VARCHAR(40) NOT NULL CHECK (action_type IN ('set_field_value', 'abort_transaction', 'execute_script')),
    action_payload JSONB NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    sys_created_on TIMESTAMPTZ DEFAULT clock_timestamp(),
    CONSTRAINT ck_script_actor CHECK (
        (execution_mode = 'caller' AND run_as_user_id IS NULL)
        OR (execution_mode = 'service' AND run_as_user_id IS NOT NULL)
    )
);
CREATE INDEX IF NOT EXISTS idx_script_execution ON sys_script(table_id, timing, execution_order) WHERE is_active = TRUE;

-- 8. Status & States Catalog (FSM)
CREATE TABLE IF NOT EXISTS sys_state (
    sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_id UUID REFERENCES sys_db_object(sys_id) ON DELETE CASCADE,
    name VARCHAR(80) NOT NULL,
    label VARCHAR(100) NOT NULL,
    sequence INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    color VARCHAR(40) DEFAULT 'gray',
    description TEXT,
    sys_created_on TIMESTAMPTZ DEFAULT clock_timestamp(),
    sys_updated_on TIMESTAMPTZ DEFAULT clock_timestamp(),
    sys_created_by UUID REFERENCES sys_user(sys_id) ON DELETE RESTRICT,
    sys_updated_by UUID REFERENCES sys_user(sys_id) ON DELETE RESTRICT,
    sys_mod_count INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT uq_state_table_name UNIQUE (table_id, name)
);
CREATE INDEX IF NOT EXISTS idx_state_lookup ON sys_state(table_id, name) WHERE is_active = TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sys_state_global_name ON sys_state(name) WHERE table_id IS NULL;

-- 9. FSM State Transitions
CREATE TABLE IF NOT EXISTS sys_state_transition (
    sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_id UUID NOT NULL REFERENCES sys_db_object(sys_id) ON DELETE CASCADE,
    state_field VARCHAR(80) NOT NULL DEFAULT 'state',
    from_state_id UUID NOT NULL REFERENCES sys_state(sys_id) ON DELETE CASCADE,
    to_state_id UUID NOT NULL REFERENCES sys_state(sys_id) ON DELETE CASCADE,
    from_state VARCHAR(80),
    to_state VARCHAR(80),
    label VARCHAR(80) NOT NULL,
    required_role_id UUID REFERENCES sys_user_role(sys_id) ON DELETE RESTRICT,
    condition_tree JSONB,
    on_transition_action JSONB,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    sys_created_on TIMESTAMPTZ DEFAULT clock_timestamp(),
    sys_updated_on TIMESTAMPTZ DEFAULT clock_timestamp(),
    sys_created_by UUID REFERENCES sys_user(sys_id) ON DELETE RESTRICT,
    sys_updated_by UUID REFERENCES sys_user(sys_id) ON DELETE RESTRICT,
    sys_mod_count INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT uq_state_transition UNIQUE (table_id, state_field, from_state_id, to_state_id)
);
CREATE INDEX IF NOT EXISTS idx_transition_lookup ON sys_state_transition(table_id, state_field, from_state_id, to_state_id) WHERE is_active = TRUE;
`

// FunctionsAndTriggersDDL contains PL/pgSQL functions for audit and numbering.
const FunctionsAndTriggersDDL = `
-- 1. Universal Audit Diff Function
CREATE OR REPLACE FUNCTION trg_generic_audit_diff()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    key_name TEXT;
    old_map JSONB := '{}'::JSONB;
    new_map JSONB := '{}'::JSONB;
    record_id UUID;
    actor UUID := NULLIF(current_setting('app.user_id', TRUE), '')::UUID;
BEGIN
    IF actor IS NULL OR NOT EXISTS (
        SELECT 1 FROM sys_user WHERE sys_id = actor AND is_active
    ) THEN
        RAISE EXCEPTION 'Auditoria requer sys_id de usuário ativo no contexto';
    END IF;

    IF TG_OP = 'INSERT' THEN
        new_map := to_jsonb(NEW);
        record_id := NEW.sys_id;
    ELSIF TG_OP = 'DELETE' THEN
        old_map := to_jsonb(OLD);
        record_id := OLD.sys_id;
    ELSE
        old_map := to_jsonb(OLD);
        new_map := to_jsonb(NEW);
        record_id := NEW.sys_id;
    END IF;

    FOR key_name IN SELECT jsonb_object_keys(old_map || new_map) LOOP
        IF key_name NOT IN ('sys_updated_on', 'sys_mod_count')
           AND (TG_OP <> 'UPDATE' 
                OR (old_map -> key_name) IS DISTINCT FROM (new_map -> key_name)) THEN
            INSERT INTO sys_audit (
                table_name, document_id, operation, field_name,
                old_value, new_value, changed_by
            ) VALUES (
                TG_TABLE_NAME, record_id, TG_OP, key_name,
                old_map -> key_name, new_map -> key_name, actor
            );
        END IF;
    END LOOP;

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;

-- 2. Number Sequence Generation Function
CREATE OR REPLACE FUNCTION sys_next_number(p_number_id UUID)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
    cfg sys_number%ROWTYPE;
    n BIGINT;
    actor UUID := NULLIF(current_setting('app.user_id', TRUE), '')::UUID;
BEGIN
    IF actor IS NULL OR NOT EXISTS (
        SELECT 1 FROM sys_user WHERE sys_id = actor AND is_active
    ) THEN
        RAISE EXCEPTION 'Usuário de execução ausente ou inativo';
    END IF;

    SELECT * INTO cfg FROM sys_number
    WHERE sys_id = p_number_id FOR SHARE;
    IF NOT FOUND OR NOT cfg.is_active THEN
        RAISE EXCEPTION 'Configuração de numeração ausente ou inativa';
    END IF;

    UPDATE sys_number_counter
    SET last_value = last_value + 1
    WHERE number_id = cfg.sys_id
    RETURNING last_value INTO n;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Contador não inicializado';
    END IF;

    RETURN cfg.prefix || lpad(n::TEXT,
        greatest(cfg.minimum_digits::INTEGER, length(n::TEXT)), '0');
END;
$$;
`
