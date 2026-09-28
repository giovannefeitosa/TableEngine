package database

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"tableengine/internal/config"
)

var (
	SystemServiceUserID = uuid.MustParse("00000000-0000-0000-0000-000000000001")
	AdminUserID         = uuid.MustParse("00000000-0000-4000-8000-000000000002")
	AdminGroupID        = uuid.MustParse("10000000-0000-0000-0000-000000000001")
	AdminRoleID         = uuid.MustParse("20000000-0000-0000-0000-000000000001")

	StateDraftID      = uuid.MustParse("30000000-0000-0000-0000-000000000001")
	StateNewID        = uuid.MustParse("30000000-0000-0000-0000-000000000002")
	StateInProgressID = uuid.MustParse("30000000-0000-0000-0000-000000000003")
	StateResolvedID   = uuid.MustParse("30000000-0000-0000-0000-000000000004")
	StateClosedID     = uuid.MustParse("30000000-0000-0000-0000-000000000005")
	StateCanceledID   = uuid.MustParse("30000000-0000-0000-0000-000000000006")
)

var KernelTables = []string{
	"sys_db_object",
	"sys_dictionary",
	"sys_choice",
	"sys_user",
	"sys_user_group",
	"sys_user_role",
	"sys_permission",
	"sys_user_grmember",
	"sys_group_has_role",
	"sys_role_has_permission",
	"sys_number",
	"sys_number_counter",
	"sys_script",
	"sys_state",
	"sys_state_transition",
}

type DB struct {
	Pool *pgxpool.Pool
	Cfg  *config.Config
}

// Connect initializes the PostgreSQL connection pool with retry mechanism.
func Connect(ctx context.Context, cfg *config.Config) (*DB, error) {
	var pool *pgxpool.Pool
	var err error

	for attempts := 1; attempts <= 15; attempts++ {
		log.Printf("Connecting to database (attempt %d/15)...", attempts)
		poolCfg, parseErr := pgxpool.ParseConfig(cfg.DatabaseURL)
		if parseErr != nil {
			return nil, fmt.Errorf("invalid database URL: %w", parseErr)
		}
		poolCfg.MaxConns = 30
		poolCfg.MinConns = 2
		poolCfg.MaxConnLifetime = 1 * time.Hour

		pool, err = pgxpool.NewWithConfig(ctx, poolCfg)
		if err == nil {
			pingErr := pool.Ping(ctx)
			if pingErr == nil {
				log.Println("Database connection established successfully.")
				return &DB{Pool: pool, Cfg: cfg}, nil
			}
			pool.Close()
			err = pingErr
		}

		log.Printf("Database connection attempt failed: %v. Retrying in 2 seconds...", err)
		time.Sleep(2 * time.Second)
	}

	return nil, fmt.Errorf("failed to connect to database after 15 attempts: %w", err)
}

// MigrateAndBootstrap runs the initial kernel DDL and seeds the administrative user.
func (db *DB) MigrateAndBootstrap(ctx context.Context) error {
	log.Println("Running Kernel schema migration...")

	// 1. Run DDL for all kernel tables
	if _, err := db.Pool.Exec(ctx, KernelDDL); err != nil {
		return fmt.Errorf("failed to execute KernelDDL: %w", err)
	}

	// 2. Run Functions and Triggers
	if _, err := db.Pool.Exec(ctx, FunctionsAndTriggersDDL); err != nil {
		return fmt.Errorf("failed to execute FunctionsAndTriggersDDL: %w", err)
	}

	// 3. Bootstrap Service Account & Administrator
	tx, err := db.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin bootstrap transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Set app.user_id to system_service
	_, _ = tx.Exec(ctx, "SELECT set_config('app.user_id', $1, true)", SystemServiceUserID.String())

	// Insert Technical Account: system_service
	_, err = tx.Exec(ctx, `
		INSERT INTO sys_user (sys_id, user_name, first_name, last_name, email, is_service_account, is_active)
		VALUES ($1, 'system_service', 'System', 'Service Account', 'system@tableengine.local', TRUE, TRUE)
		ON CONFLICT (user_name) DO UPDATE SET is_active = TRUE
	`, SystemServiceUserID)
	if err != nil {
		return fmt.Errorf("failed to seed system_service user: %w", err)
	}

	// Insert Admin User
	_, err = tx.Exec(ctx, `
		INSERT INTO sys_user (sys_id, user_name, first_name, last_name, email, is_service_account, is_active)
		VALUES ($1, $2, 'System', 'Administrator', 'admin@empresa.com', FALSE, TRUE)
		ON CONFLICT (user_name) DO UPDATE SET is_active = TRUE
	`, AdminUserID, db.Cfg.InitialAdminUser)
	if err != nil {
		return fmt.Errorf("failed to seed admin user: %w", err)
	}

	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(db.Cfg.InitialAdminPassword), 12)
	if err != nil {
		return fmt.Errorf("failed to hash admin password: %w", err)
	}

	// Insert Admin Credential
	_, err = tx.Exec(ctx, `
		INSERT INTO sys_user_credential (user_id, password_hash, algorithm)
		VALUES ($1, $2, 'bcrypt')
		ON CONFLICT (user_id) DO UPDATE SET password_hash = $2, failed_attempts = 0, locked_until = NULL
	`, AdminUserID, string(hashedPassword))
	if err != nil {
		return fmt.Errorf("failed to seed admin credential: %w", err)
	}

	// Insert Admin Group: System Administrators
	_, err = tx.Exec(ctx, `
		INSERT INTO sys_user_group (sys_id, name, description, is_active)
		VALUES ($1, 'System Administrators', 'Superuser administrative group with full system privileges', TRUE)
		ON CONFLICT (name) DO UPDATE SET is_active = TRUE
	`, AdminGroupID)
	if err != nil {
		return fmt.Errorf("failed to seed admin group: %w", err)
	}

	// Insert Admin Role: admin
	_, err = tx.Exec(ctx, `
		INSERT INTO sys_user_role (sys_id, name, description, is_active)
		VALUES ($1, 'admin', 'System Administrator with universal bypass and DDL permissions', TRUE)
		ON CONFLICT (name) DO UPDATE SET is_active = TRUE
	`, AdminRoleID)
	if err != nil {
		return fmt.Errorf("failed to seed admin role: %w", err)
	}

	// Bind Admin User -> Admin Group
	_, err = tx.Exec(ctx, `
		INSERT INTO sys_user_grmember (user_id, group_id)
		VALUES ($1, $2)
		ON CONFLICT (user_id, group_id) DO NOTHING
	`, AdminUserID, AdminGroupID)
	if err != nil {
		return fmt.Errorf("failed to bind admin user to group: %w", err)
	}

	// Bind Admin Group -> Admin Role
	_, err = tx.Exec(ctx, `
		INSERT INTO sys_group_has_role (group_id, role_id)
		VALUES ($1, $2)
		ON CONFLICT (group_id, role_id) DO NOTHING
	`, AdminGroupID, AdminRoleID)
	if err != nil {
		return fmt.Errorf("failed to bind admin group to role: %w", err)
	}

	// Add common kernel attributes to all Kernel tables
	for _, tableName := range KernelTables {
		alterSQL := fmt.Sprintf(`
			ALTER TABLE %s
				ADD COLUMN IF NOT EXISTS sys_created_on TIMESTAMPTZ DEFAULT clock_timestamp(),
				ADD COLUMN IF NOT EXISTS sys_updated_on TIMESTAMPTZ DEFAULT clock_timestamp(),
				ADD COLUMN IF NOT EXISTS sys_created_by UUID REFERENCES sys_user(sys_id) ON DELETE RESTRICT,
				ADD COLUMN IF NOT EXISTS sys_updated_by UUID REFERENCES sys_user(sys_id) ON DELETE RESTRICT,
				ADD COLUMN IF NOT EXISTS sys_mod_count INTEGER NOT NULL DEFAULT 0;
		`, tableName)

		if _, err := tx.Exec(ctx, alterSQL); err != nil {
			return fmt.Errorf("failed to apply kernel attributes to %s: %w", tableName, err)
		}

		updateSQL := fmt.Sprintf(`
			UPDATE %s SET
				sys_created_by = COALESCE(sys_created_by, $1),
				sys_updated_by = COALESCE(sys_updated_by, $1);
		`, tableName)

		if _, err := tx.Exec(ctx, updateSQL, SystemServiceUserID); err != nil {
			return fmt.Errorf("failed to set authors on %s: %w", tableName, err)
		}
	}

	// Register Kernel tables in sys_db_object
	for _, tableName := range append(KernelTables, "sys_audit", "sys_user_credential") {
		label := formatTableLabel(tableName)
		_, err := tx.Exec(ctx, `
			INSERT INTO sys_db_object (name, label, super_class_id, is_extendable, is_kernel_table)
			VALUES ($1, $2, NULL, FALSE, TRUE)
			ON CONFLICT (name) DO NOTHING
		`, tableName, label)
		if err != nil {
			return fmt.Errorf("failed to register kernel table %s: %w", tableName, err)
		}
	}

	// Register kernel columns in sys_dictionary for all tables
	if err := db.registerSystemDictionaryFields(ctx, tx); err != nil {
		return fmt.Errorf("failed to register kernel dictionary fields: %w", err)
	}

	// Attach audit triggers to Kernel tables (except sys_audit and sys_user_credential)
	for _, tableName := range KernelTables {
		trgSQL := fmt.Sprintf(`
			DROP TRIGGER IF EXISTS trg_audit_%s ON %s;
			CREATE TRIGGER trg_audit_%s
			AFTER INSERT OR UPDATE OR DELETE ON %s
			FOR EACH ROW EXECUTE FUNCTION trg_generic_audit_diff();
		`, tableName, tableName, tableName, tableName)
		if _, err := tx.Exec(ctx, trgSQL); err != nil {
			return fmt.Errorf("failed to attach audit trigger to %s: %w", tableName, err)
		}
	}

	// Create Universal Permissions for admin role on all registered tables
	var tableIDs []uuid.UUID
	rows, err := tx.Query(ctx, `SELECT sys_id FROM sys_db_object`)
	if err != nil {
		return fmt.Errorf("failed to query sys_db_object for permissions: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var tid uuid.UUID
		if err := rows.Scan(&tid); err == nil {
			tableIDs = append(tableIDs, tid)
		}
	}

	operations := []string{"create", "read", "update", "delete"}
	for _, tid := range tableIDs {
		for _, op := range operations {
			permName := fmt.Sprintf("admin.%s.%s", tid.String(), op)
			var permID uuid.UUID
			err := tx.QueryRow(ctx, `
				INSERT INTO sys_permission (name, description, table_id, operation, is_active)
				VALUES ($1, 'Admin universal access', $2, $3, TRUE)
				ON CONFLICT (name) DO UPDATE SET is_active = TRUE
				RETURNING sys_id
			`, permName, tid, op).Scan(&permID)
			if err == nil {
				_, _ = tx.Exec(ctx, `
					INSERT INTO sys_role_has_permission (role_id, permission_id)
					VALUES ($1, $2)
					ON CONFLICT (role_id, permission_id) DO NOTHING
				`, AdminRoleID, permID)
			}
		}
	}

	// Seed standard states and migrate existing tables/transitions
	if err := db.migrateAndSeedStates(ctx, tx); err != nil {
		return fmt.Errorf("failed to migrate and seed states: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("failed to commit bootstrap transaction: %w", err)
	}

	log.Println("Kernel schema migration and administrative bootstrap completed successfully.")
	return nil
}

func (db *DB) registerSystemDictionaryFields(ctx context.Context, tx pgx.Tx) error {
	// Query all columns from information_schema for kernel tables
	rows, err := tx.Query(ctx, `
		SELECT c.table_name, c.column_name, c.data_type, c.is_nullable, c.character_maximum_length, o.sys_id
		FROM information_schema.columns c
		JOIN sys_db_object o ON o.name = c.table_name
		WHERE c.table_schema = 'public'
	`)
	if err != nil {
		return err
	}
	defer rows.Close()

	type colDef struct {
		tableName  string
		columnName string
		dataType   string
		isNullable string
		maxLength  *int
		tableID    uuid.UUID
	}
	var cols []colDef
	for rows.Next() {
		var c colDef
		if err := rows.Scan(&c.tableName, &c.columnName, &c.dataType, &c.isNullable, &c.maxLength, &c.tableID); err != nil {
			return err
		}
		cols = append(cols, c)
	}

	for _, c := range cols {
		internalType := mapPostgresTypeToInternal(c.dataType)
		isMandatory := c.isNullable == "NO"
		label := formatFieldLabel(c.columnName)
		maxLen := 255
		if c.maxLength != nil {
			maxLen = *c.maxLength
		}

		_, err := tx.Exec(ctx, `
			INSERT INTO sys_dictionary (
				table_id, column_name, label, internal_type, max_length, is_mandatory, is_system_field
			) VALUES ($1, $2, $3, $4, $5, $6, TRUE)
			ON CONFLICT (table_id, column_name) DO NOTHING
		`, c.tableID, c.columnName, label, internalType, maxLen, isMandatory)
		if err != nil {
			return err
		}
	}

	return nil
}

func mapPostgresTypeToInternal(pgType string) string {
	switch pgType {
	case "uuid":
		return "uuid"
	case "character varying", "varchar":
		return "string"
	case "text":
		return "text"
	case "integer":
		return "integer"
	case "bigint":
		return "bigint"
	case "boolean":
		return "boolean"
	case "timestamp with time zone", "timestamptz":
		return "timestamptz"
	case "jsonb", "json":
		return "jsonb"
	default:
		return "string"
	}
}

func formatTableLabel(name string) string {
	switch name {
	case "sys_db_object":
		return "Tabelas do Sistema"
	case "sys_dictionary":
		return "Dicionário de Dados"
	case "sys_choice":
		return "Lista de Opções"
	case "sys_user":
		return "Usuários"
	case "sys_user_credential":
		return "Credenciais de Usuário"
	case "sys_user_group":
		return "Grupos de Usuários"
	case "sys_user_role":
		return "Papéis Funcionais (Roles)"
	case "sys_permission":
		return "Permissões de Recursos"
	case "sys_user_grmember":
		return "Membros de Grupos"
	case "sys_group_has_role":
		return "Roles de Grupos"
	case "sys_role_has_permission":
		return "Permissões de Roles"
	case "sys_number":
		return "Configurações de Numeração"
	case "sys_number_counter":
		return "Contadores de Numeração"
	case "sys_audit":
		return "Trilha de Auditoria"
	case "sys_script":
		return "Regras de Negócio (Business Rules)"
	case "sys_state":
		return "Estados do Ciclo de Vida (FSM)"
	case "sys_state_transition":
		return "Transições de Estado (FSM)"
	default:
		return name
	}
}

func formatFieldLabel(name string) string {
	switch name {
	case "sys_id":
		return "Sys ID"
	case "sys_class_name":
		return "Classe"
	case "sys_created_on":
		return "Criado em"
	case "sys_created_by":
		return "Criado por"
	case "sys_updated_on":
		return "Atualizado em"
	case "sys_updated_by":
		return "Atualizado por"
	case "sys_mod_count":
		return "Versão (Mod Count)"
	case "name":
		return "Nome"
	case "label":
		return "Rótulo"
	case "user_name":
		return "Nome de Usuário"
	case "email":
		return "E-mail"
	case "first_name":
		return "Nome"
	case "last_name":
		return "Sobrenome"
	case "is_active":
		return "Ativo"
	case "state":
		return "Estado"
	case "short_description":
		return "Descrição Curta"
	case "from_state_id":
		return "Estado de Origem (ID)"
	case "to_state_id":
		return "Estado de Destino (ID)"
	case "from_state":
		return "Estado de Origem"
	case "to_state":
		return "Estado de Destino"
	default:
		return name
	}
}

func (db *DB) migrateAndSeedStates(ctx context.Context, tx pgx.Tx) error {
	// 1. Seed standard states in sys_state
	states := []struct {
		id    uuid.UUID
		name  string
		label string
		seq   int
		color string
	}{
		{StateDraftID, "draft", "Rascunho", 10, "slate"},
		{StateNewID, "new", "Novo", 20, "blue"},
		{StateInProgressID, "in_progress", "Em Andamento", 30, "amber"},
		{StateResolvedID, "resolved", "Resolvido", 40, "emerald"},
		{StateClosedID, "closed", "Fechado", 50, "purple"},
		{StateCanceledID, "canceled", "Cancelado", 60, "rose"},
	}

	for _, s := range states {
		_, err := tx.Exec(ctx, `
			INSERT INTO sys_state (sys_id, name, label, sequence, is_active, color, sys_created_by, sys_updated_by)
			VALUES ($1, $2, $3, $4, TRUE, $5, $6, $6)
			ON CONFLICT (sys_id) DO UPDATE SET
				label = EXCLUDED.label,
				sequence = EXCLUDED.sequence,
				color = EXCLUDED.color
		`, s.id, s.name, s.label, s.seq, s.color, SystemServiceUserID)
		if err != nil {
			return fmt.Errorf("failed to seed state %s: %w", s.name, err)
		}
	}

	// 2. Ensure sys_state_transition has foreign keys populated
	_, err := tx.Exec(ctx, `
		ALTER TABLE sys_state_transition ADD COLUMN IF NOT EXISTS from_state_id UUID REFERENCES sys_state(sys_id) ON DELETE CASCADE;
		ALTER TABLE sys_state_transition ADD COLUMN IF NOT EXISTS to_state_id UUID REFERENCES sys_state(sys_id) ON DELETE CASCADE;

		UPDATE sys_state_transition SET from_state_id = CASE
			WHEN from_state = 'draft' THEN '30000000-0000-0000-0000-000000000001'::uuid
			WHEN from_state = 'new' THEN '30000000-0000-0000-0000-000000000002'::uuid
			WHEN from_state = 'in_progress' THEN '30000000-0000-0000-0000-000000000003'::uuid
			WHEN from_state = 'resolved' THEN '30000000-0000-0000-0000-000000000004'::uuid
			WHEN from_state = 'closed' THEN '30000000-0000-0000-0000-000000000005'::uuid
			WHEN from_state = 'canceled' THEN '30000000-0000-0000-0000-000000000006'::uuid
			ELSE '30000000-0000-0000-0000-000000000002'::uuid
		END WHERE from_state_id IS NULL;

		UPDATE sys_state_transition SET to_state_id = CASE
			WHEN to_state = 'draft' THEN '30000000-0000-0000-0000-000000000001'::uuid
			WHEN to_state = 'new' THEN '30000000-0000-0000-0000-000000000002'::uuid
			WHEN to_state = 'in_progress' THEN '30000000-0000-0000-0000-000000000003'::uuid
			WHEN to_state = 'resolved' THEN '30000000-0000-0000-0000-000000000004'::uuid
			WHEN to_state = 'closed' THEN '30000000-0000-0000-0000-000000000005'::uuid
			WHEN to_state = 'canceled' THEN '30000000-0000-0000-0000-000000000006'::uuid
			ELSE '30000000-0000-0000-0000-000000000004'::uuid
		END WHERE to_state_id IS NULL;
	`)
	if err != nil {
		return fmt.Errorf("failed to migrate sys_state_transition: %w", err)
	}

	// 3. Migrate tbl_task.state to reference sys_state if tbl_task exists
	var taskTableExists bool
	_ = tx.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM sys_db_object WHERE name = 'tbl_task')").Scan(&taskTableExists)
	if taskTableExists {
		var stateType string
		_ = tx.QueryRow(ctx, "SELECT data_type FROM information_schema.columns WHERE table_name = 'tbl_task' AND column_name = 'state'").Scan(&stateType)
		if stateType != "" && stateType != "uuid" {
			// Drop views, migrate column, and recreate views
			_, _ = tx.Exec(ctx, "DROP VIEW IF EXISTS v_incident CASCADE;")
			_, _ = tx.Exec(ctx, "DROP VIEW IF EXISTS v_task CASCADE;")

			_, err = tx.Exec(ctx, `
				ALTER TABLE tbl_task ADD COLUMN IF NOT EXISTS state_uuid UUID;
				UPDATE tbl_task SET state_uuid = CASE
					WHEN state = 'draft' THEN '30000000-0000-0000-0000-000000000001'::uuid
					WHEN state = 'new' THEN '30000000-0000-0000-0000-000000000002'::uuid
					WHEN state = 'in_progress' THEN '30000000-0000-0000-0000-000000000003'::uuid
					WHEN state = 'resolved' THEN '30000000-0000-0000-0000-000000000004'::uuid
					WHEN state = 'closed' THEN '30000000-0000-0000-0000-000000000005'::uuid
					WHEN state = 'canceled' THEN '30000000-0000-0000-0000-000000000006'::uuid
					ELSE '30000000-0000-0000-0000-000000000002'::uuid
				END;
				ALTER TABLE tbl_task DROP COLUMN state CASCADE;
				ALTER TABLE tbl_task RENAME COLUMN state_uuid TO state;
				ALTER TABLE tbl_task ADD CONSTRAINT fk_task_state FOREIGN KEY (state) REFERENCES sys_state(sys_id) ON DELETE RESTRICT;
				ALTER TABLE tbl_task ALTER COLUMN state SET DEFAULT '30000000-0000-0000-0000-000000000002'::uuid;

				CREATE OR REPLACE VIEW v_task AS SELECT * FROM tbl_task;
			`)
			if err != nil {
				return fmt.Errorf("failed to alter tbl_task.state: %w", err)
			}

			// If tbl_incident exists, recreate view v_incident
			var incExists bool
			_ = tx.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM sys_db_object WHERE name = 'tbl_incident')").Scan(&incExists)
			if incExists {
				_, _ = tx.Exec(ctx, `
					CREATE OR REPLACE VIEW v_incident AS
					SELECT t1.sys_id, t1.sys_class_name, t1.sys_created_on, t1.sys_created_by,
					       t1.sys_updated_on, t1.sys_updated_by, t1.sys_mod_count, t1.short_description,
					       t1.state, t1.number, t0.severity, t0.close_notes
					FROM tbl_incident t0
					JOIN tbl_task t1 ON t0.sys_id = t1.sys_id;
				`)
			}
		}

		// Update sys_dictionary for tbl_task.state
		_, _ = tx.Exec(ctx, `
			UPDATE sys_dictionary
			SET internal_type = 'reference',
			    reference_table_id = (SELECT sys_id FROM sys_db_object WHERE name = 'sys_state'),
			    default_value = '30000000-0000-0000-0000-000000000002'
			WHERE table_id = (SELECT sys_id FROM sys_db_object WHERE name = 'tbl_task')
			  AND column_name = 'state';
		`)
	}

	// Update reference_table_id in sys_dictionary for from_state_id and to_state_id on sys_state_transition
	_, _ = tx.Exec(ctx, `
		UPDATE sys_dictionary
		SET internal_type = 'reference',
		    reference_table_id = (SELECT sys_id FROM sys_db_object WHERE name = 'sys_state')
		WHERE table_id = (SELECT sys_id FROM sys_db_object WHERE name = 'sys_state_transition')
		  AND column_name IN ('from_state_id', 'to_state_id');
	`)

	return nil
}

