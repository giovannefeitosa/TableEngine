package ddl

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"tableengine/internal/auth"
	"tableengine/internal/database"
)

var nameRegex = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_]{0,79}$`)

type TableInfo struct {
	SysID         uuid.UUID  `json:"sys_id"`
	Name          string     `json:"name"`
	Label         string     `json:"label"`
	SuperClassID  *uuid.UUID `json:"super_class_id"`
	IsExtendable  bool       `json:"is_extendable"`
	IsKernelTable bool       `json:"is_kernel_table"`
	ViewName      string     `json:"view_name,omitempty"`
	SysCreatedOn  time.Time  `json:"sys_created_on"`
}

type CreateTableRequest struct {
	Name         string     `json:"name"`
	Label        string     `json:"label"`
	SuperClassID *uuid.UUID `json:"super_class_id"`
	IsExtendable bool       `json:"is_extendable"`
}

type FieldInfo struct {
	SysID            uuid.UUID  `json:"sys_id,omitempty"`
	TableID          uuid.UUID  `json:"table_id,omitempty"`
	ColumnName       string     `json:"column_name"`
	Label            string     `json:"label"`
	InternalType     string     `json:"internal_type"`
	MaxLength        int        `json:"max_length"`
	IsMandatory      bool       `json:"is_mandatory"`
	IsReadOnly       bool       `json:"is_read_only"`
	DefaultValue     *string    `json:"default_value"`
	ReferenceTableID *uuid.UUID `json:"reference_table_id,omitempty"`
	DefinedInTable   string     `json:"defined_in_table,omitempty"`
	InheritanceLevel int        `json:"inheritance_level"`
}

type AddFieldRequest struct {
	ColumnName       string     `json:"column_name"`
	Label            string     `json:"label"`
	InternalType     string     `json:"internal_type"`
	MaxLength        int        `json:"max_length"`
	IsMandatory      bool       `json:"is_mandatory"`
	IsReadOnly       bool       `json:"is_read_only"`
	DefaultValue     *string    `json:"default_value"`
	ReferenceTableID *uuid.UUID `json:"reference_table_id"`
	// For auto_number:
	NumberPrefix   string `json:"number_prefix,omitempty"`
	MinimumDigits  int    `json:"minimum_digits,omitempty"`
	StartNumber    int64  `json:"start_number,omitempty"`
}

type Engine struct {
	db *database.DB
}

func NewEngine(db *database.DB) *Engine {
	return &Engine{db: db}
}

// ListTables retrieves all tables, optionally including system tables.
func (e *Engine) ListTables(ctx context.Context, includeKernel bool) ([]TableInfo, error) {
	query := `
		SELECT sys_id, name, label, super_class_id, is_extendable, is_kernel_table, sys_created_on
		FROM sys_db_object
	`
	if !includeKernel {
		query += ` WHERE is_kernel_table = FALSE`
	}
	query += ` ORDER BY is_kernel_table DESC, name ASC`

	rows, err := e.db.Pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tables := make([]TableInfo, 0)
	for rows.Next() {
		var t TableInfo
		if err := rows.Scan(&t.SysID, &t.Name, &t.Label, &t.SuperClassID, &t.IsExtendable, &t.IsKernelTable, &t.SysCreatedOn); err != nil {
			return nil, err
		}
		t.ViewName = fmt.Sprintf("v_%s", strings.TrimPrefix(t.Name, "tbl_"))
		tables = append(tables, t)
	}

	return tables, nil
}

// CreateTable dynamically builds a base table or a child TPT table.
func (e *Engine) CreateTable(ctx context.Context, req CreateTableRequest, userCtx *auth.SecurityContext) (*TableInfo, error) {
	// Normalize table name
	tableName := strings.ToLower(strings.TrimSpace(req.Name))
	if !strings.HasPrefix(tableName, "tbl_") {
		tableName = "tbl_" + tableName
	}

	if !nameRegex.MatchString(tableName) {
		return nil, fmt.Errorf("nome de tabela inválido: '%s'. Deve conter apenas letras, números e underscores", tableName)
	}

	label := strings.TrimSpace(req.Label)
	if label == "" {
		label = tableName
	}

	var createdInfo TableInfo

	err := auth.ExecuteInTx(ctx, e.db, userCtx, func(tx pgx.Tx) error {
		// Check for duplicate name
		var exists bool
		err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM sys_db_object WHERE name = $1)", tableName).Scan(&exists)
		if err != nil {
			return err
		}
		if exists {
			return fmt.Errorf("tabela '%s' já existe", tableName)
		}

		actorID := userCtx.UserID

		if req.SuperClassID == nil {
			// Case A: Root Table
			var newTableID uuid.UUID
			err := tx.QueryRow(ctx, `
				INSERT INTO sys_db_object (name, label, super_class_id, is_extendable, is_kernel_table, sys_created_by, sys_updated_by)
				VALUES ($1, $2, NULL, $3, FALSE, $4, $4)
				RETURNING sys_id, sys_created_on
			`, tableName, label, req.IsExtendable, actorID).Scan(&newTableID, &createdInfo.SysCreatedOn)
			if err != nil {
				return fmt.Errorf("falha ao registrar sys_db_object: %w", err)
			}

			// Create physical table with mandatory kernel columns
			createSQL := fmt.Sprintf(`
				CREATE TABLE %s (
					sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
					sys_class_name VARCHAR(80) NOT NULL,
					sys_created_on TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
					sys_created_by UUID NOT NULL REFERENCES sys_user(sys_id) ON DELETE RESTRICT,
					sys_updated_on TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
					sys_updated_by UUID NOT NULL REFERENCES sys_user(sys_id) ON DELETE RESTRICT,
					sys_mod_count INTEGER NOT NULL DEFAULT 0
				);
			`, tableName)
			if _, err := tx.Exec(ctx, createSQL); err != nil {
				return fmt.Errorf("falha ao criar tabela física %s: %w", tableName, err)
			}

			// Register Kernel attributes in sys_dictionary
			kernelCols := []struct {
				name, label, iType string
				ref                *uuid.UUID
			}{
				{"sys_id", "Sys ID", "uuid", nil},
				{"sys_class_name", "Classe", "string", nil},
				{"sys_created_on", "Criado em", "timestamptz", nil},
				{"sys_created_by", "Criado por", "reference", &database.AdminUserID},
				{"sys_updated_on", "Atualizado em", "timestamptz", nil},
				{"sys_updated_by", "Atualizado por", "reference", &database.AdminUserID},
				{"sys_mod_count", "Versão", "integer", nil},
			}

			for _, col := range kernelCols {
				var refID *uuid.UUID
				if col.iType == "reference" {
					var uid uuid.UUID
					_ = tx.QueryRow(ctx, "SELECT sys_id FROM sys_db_object WHERE name = 'sys_user'").Scan(&uid)
					refID = &uid
				}
				_, err := tx.Exec(ctx, `
					INSERT INTO sys_dictionary (table_id, column_name, label, internal_type, is_system_field, reference_table_id)
					VALUES ($1, $2, $3, $4, TRUE, $5)
				`, newTableID, col.name, col.label, col.iType, refID)
				if err != nil {
					return fmt.Errorf("falha ao registrar coluna %s no dicionário: %w", col.name, err)
				}
			}

			// Attach universal audit trigger
			trgSQL := fmt.Sprintf(`
				CREATE TRIGGER trg_audit_%s
				AFTER INSERT OR UPDATE OR DELETE ON %s
				FOR EACH ROW EXECUTE FUNCTION trg_generic_audit_diff();
			`, tableName, tableName)
			if _, err := tx.Exec(ctx, trgSQL); err != nil {
				return fmt.Errorf("falha ao vincular trigger de auditoria: %w", err)
			}

			// Create Polymorphic View
			viewName := fmt.Sprintf("v_%s", strings.TrimPrefix(tableName, "tbl_"))
			viewSQL := fmt.Sprintf("CREATE OR REPLACE VIEW %s AS SELECT * FROM %s;", viewName, tableName)
			if _, err := tx.Exec(ctx, viewSQL); err != nil {
				return fmt.Errorf("falha ao criar view polimórfica %s: %w", viewName, err)
			}

			createdInfo.SysID = newTableID
			createdInfo.Name = tableName
			createdInfo.Label = label
			createdInfo.SuperClassID = nil
			createdInfo.IsExtendable = req.IsExtendable
			createdInfo.IsKernelTable = false
			createdInfo.ViewName = viewName

		} else {
			// Case B: Child Table (TPT)
			// Validate parent exists and is extendable
			var parentName string
			var parentExtendable bool
			err := tx.QueryRow(ctx, `
				SELECT name, is_extendable FROM sys_db_object WHERE sys_id = $1
			`, req.SuperClassID).Scan(&parentName, &parentExtendable)
			if err != nil {
				return errors.New("tabela pai não encontrada")
			}
			if !parentExtendable {
				return errors.New("a tabela pai especificada não permite herança (is_extendable = false)")
			}

			// Insert into sys_db_object
			var newTableID uuid.UUID
			err = tx.QueryRow(ctx, `
				INSERT INTO sys_db_object (name, label, super_class_id, is_extendable, is_kernel_table, sys_created_by, sys_updated_by)
				VALUES ($1, $2, $3, $4, FALSE, $5, $5)
				RETURNING sys_id, sys_created_on
			`, tableName, label, req.SuperClassID, req.IsExtendable, actorID).Scan(&newTableID, &createdInfo.SysCreatedOn)
			if err != nil {
				return fmt.Errorf("falha ao registrar tabela filha: %w", err)
			}

			// Create physical child table with PK/FK referencing immediate parent
			createSQL := fmt.Sprintf(`
				CREATE TABLE %s (
					sys_id UUID PRIMARY KEY,
					CONSTRAINT fk_%s_parent_%s
						FOREIGN KEY (sys_id) REFERENCES %s(sys_id) ON DELETE CASCADE
				);
			`, tableName, strings.TrimPrefix(tableName, "tbl_"), strings.TrimPrefix(parentName, "tbl_"), parentName)
			if _, err := tx.Exec(ctx, createSQL); err != nil {
				return fmt.Errorf("falha ao criar tabela física derivada %s: %w", tableName, err)
			}

			// Attach universal audit trigger
			trgSQL := fmt.Sprintf(`
				CREATE TRIGGER trg_audit_%s
				AFTER INSERT OR UPDATE OR DELETE ON %s
				FOR EACH ROW EXECUTE FUNCTION trg_generic_audit_diff();
			`, tableName, tableName)
			if _, err := tx.Exec(ctx, trgSQL); err != nil {
				return fmt.Errorf("falha ao vincular trigger de auditoria na filha: %w", err)
			}

			// Build and create polymorphic view
			viewName, err := e.regenerateViewForTable(ctx, tx, newTableID)
			if err != nil {
				return fmt.Errorf("falha ao gerar view polimórfica: %w", err)
			}

			createdInfo.SysID = newTableID
			createdInfo.Name = tableName
			createdInfo.Label = label
			createdInfo.SuperClassID = req.SuperClassID
			createdInfo.IsExtendable = req.IsExtendable
			createdInfo.IsKernelTable = false
			createdInfo.ViewName = viewName
		}

		return nil
	})

	if err != nil {
		return nil, err
	}
	return &createdInfo, nil
}

// AddField dynamically adds a column to a table and propagates views.
func (e *Engine) AddField(ctx context.Context, tableID uuid.UUID, req AddFieldRequest, userCtx *auth.SecurityContext) (*FieldInfo, error) {
	colName := strings.ToLower(strings.TrimSpace(req.ColumnName))
	if !nameRegex.MatchString(colName) {
		return nil, fmt.Errorf("nome de coluna inválido: '%s'", colName)
	}

	label := strings.TrimSpace(req.Label)
	if label == "" {
		label = colName
	}

	maxLen := req.MaxLength
	if maxLen <= 0 {
		maxLen = 255
	}

	var result FieldInfo

	err := auth.ExecuteInTx(ctx, e.db, userCtx, func(tx pgx.Tx) error {
		var tableName string
		err := tx.QueryRow(ctx, "SELECT name FROM sys_db_object WHERE sys_id = $1", tableID).Scan(&tableName)
		if err != nil {
			return errors.New("tabela não encontrada")
		}

		// Check if column already exists in table dictionary
		var exists bool
		_ = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM sys_dictionary WHERE table_id = $1 AND column_name = $2)", tableID, colName).Scan(&exists)
		if exists {
			return fmt.Errorf("campo '%s' já existe nesta tabela", colName)
		}

		// Map to PostgreSQL DDL
		pgDDL, isAutoNum := mapTypeToPostgresDDL(req.InternalType, maxLen, req.DefaultValue, req.ReferenceTableID, tx, ctx)

		// Execute ALTER TABLE
		alterSQL := fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s;", tableName, colName, pgDDL)
		if _, err := tx.Exec(ctx, alterSQL); err != nil {
			return fmt.Errorf("falha na instrução DDL de adição de coluna: %w", err)
		}

		// Insert into sys_dictionary
		var fieldID uuid.UUID
		err = tx.QueryRow(ctx, `
			INSERT INTO sys_dictionary (
				table_id, column_name, label, internal_type, max_length,
				is_mandatory, is_read_only, default_value, reference_table_id, is_system_field
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE)
			RETURNING sys_id
		`, tableID, colName, label, req.InternalType, maxLen, req.IsMandatory, req.IsReadOnly, req.DefaultValue, req.ReferenceTableID).Scan(&fieldID)
		if err != nil {
			return fmt.Errorf("falha ao salvar definição no dicionário: %w", err)
		}

		// If auto_number, register in sys_number and sys_number_counter
		if isAutoNum {
			prefix := strings.ToUpper(strings.TrimSpace(req.NumberPrefix))
			if prefix == "" {
				prefix = strings.ToUpper(strings.TrimPrefix(tableName, "tbl_"))
				if len(prefix) > 3 {
					prefix = prefix[:3]
				}
			}
			minDigits := req.MinimumDigits
			if minDigits < 1 || minDigits > 19 {
				minDigits = 7
			}
			startNum := req.StartNumber
			if startNum < 1 {
				startNum = 1
			}

			var numID uuid.UUID
			err := tx.QueryRow(ctx, `
				INSERT INTO sys_number (table_id, field_name, prefix, minimum_digits, start_number)
				VALUES ($1, $2, $3, $4, $5)
				RETURNING sys_id
			`, tableID, colName, prefix, minDigits, startNum).Scan(&numID)
			if err != nil {
				return fmt.Errorf("falha ao configurar numeração automática: %w", err)
			}

			_, err = tx.Exec(ctx, `
				INSERT INTO sys_number_counter (number_id, last_value)
				VALUES ($1, $2)
			`, numID, startNum-1)
			if err != nil {
				return fmt.Errorf("falha ao inicializar contador de numeração: %w", err)
			}
		}

		// Regenerate polymorphic views for this table and all its descendant hierarchy
		if err := e.propagatePolymorphicViews(ctx, tx, tableID); err != nil {
			return fmt.Errorf("falha ao propagar views polimórficas: %w", err)
		}

		result = FieldInfo{
			SysID:            fieldID,
			TableID:          tableID,
			ColumnName:       colName,
			Label:            label,
			InternalType:     req.InternalType,
			MaxLength:        maxLen,
			IsMandatory:      req.IsMandatory,
			IsReadOnly:       req.IsReadOnly,
			DefaultValue:     req.DefaultValue,
			ReferenceTableID: req.ReferenceTableID,
			DefinedInTable:   tableName,
			InheritanceLevel: 0,
		}

		return nil
	})

	if err != nil {
		return nil, err
	}
	return &result, nil
}

// ResolveFields performs the recursive CTE to return all inherited and native fields of a table.
func (e *Engine) ResolveFields(ctx context.Context, tableName string) ([]FieldInfo, error) {
	cte := `
		WITH RECURSIVE table_lineage AS (
			SELECT sys_id, name, super_class_id, 0 AS inheritance_level
			FROM sys_db_object
			WHERE name = $1

			UNION ALL

			SELECT parent.sys_id, parent.name, parent.super_class_id, tl.inheritance_level + 1
			FROM sys_db_object parent
			JOIN table_lineage tl ON tl.super_class_id = parent.sys_id
		)
		SELECT
			d.sys_id,
			d.table_id,
			d.column_name,
			d.label,
			d.internal_type,
			COALESCE(d.max_length, 255),
			d.is_mandatory,
			d.is_read_only,
			d.default_value,
			d.reference_table_id,
			tl.name AS defined_in_table,
			tl.inheritance_level
		FROM table_lineage tl
		JOIN sys_dictionary d ON d.table_id = tl.sys_id
		ORDER BY tl.inheritance_level DESC, d.column_name ASC;
	`

	rows, err := e.db.Pool.Query(ctx, cte, tableName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	fields := make([]FieldInfo, 0)
	for rows.Next() {
		var f FieldInfo
		if err := rows.Scan(
			&f.SysID, &f.TableID, &f.ColumnName, &f.Label, &f.InternalType, &f.MaxLength,
			&f.IsMandatory, &f.IsReadOnly, &f.DefaultValue, &f.ReferenceTableID,
			&f.DefinedInTable, &f.InheritanceLevel,
		); err != nil {
			return nil, err
		}
		fields = append(fields, f)
	}

	return fields, nil
}

// propagatePolymorphicViews regenerates views for a table and all its descendants.
func (e *Engine) propagatePolymorphicViews(ctx context.Context, tx pgx.Tx, rootID uuid.UUID) error {
	// Find all tables in tree rooted at rootID (including rootID)
	cte := `
		WITH RECURSIVE descendants AS (
			SELECT sys_id FROM sys_db_object WHERE sys_id = $1
			UNION ALL
			SELECT child.sys_id
			FROM sys_db_object child
			JOIN descendants d ON child.super_class_id = d.sys_id
		)
		SELECT sys_id FROM descendants;
	`
	rows, err := tx.Query(ctx, cte, rootID)
	if err != nil {
		return err
	}
	defer rows.Close()

	var tIDs []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err == nil {
			tIDs = append(tIDs, id)
		}
	}

	for _, tid := range tIDs {
		if _, err := e.regenerateViewForTable(ctx, tx, tid); err != nil {
			return err
		}
	}

	return nil
}

// regenerateViewForTable constructs the JOIN query for all ancestor tables and creates v_<name>.
func (e *Engine) regenerateViewForTable(ctx context.Context, tx pgx.Tx, tableID uuid.UUID) (string, error) {
	// 1. Get lineage from leaf to root
	cte := `
		WITH RECURSIVE lineage AS (
			SELECT sys_id, name, super_class_id, 0 AS depth
			FROM sys_db_object WHERE sys_id = $1
			UNION ALL
			SELECT p.sys_id, p.name, p.super_class_id, l.depth + 1
			FROM sys_db_object p
			JOIN lineage l ON l.super_class_id = p.sys_id
		)
		SELECT sys_id, name, depth FROM lineage ORDER BY depth ASC;
	`
	rows, err := tx.Query(ctx, cte, tableID)
	if err != nil {
		return "", err
	}
	defer rows.Close()

	type tableNode struct {
		id    uuid.UUID
		name  string
		depth int
		alias string
	}
	var nodes []tableNode
	for rows.Next() {
		var n tableNode
		if err := rows.Scan(&n.id, &n.name, &n.depth); err != nil {
			return "", err
		}
		n.alias = fmt.Sprintf("t%d", n.depth)
		nodes = append(nodes, n)
	}

	if len(nodes) == 0 {
		return "", errors.New("tabela não encontrada para geração de view")
	}

	leafTable := nodes[0].name
	viewName := fmt.Sprintf("v_%s", strings.TrimPrefix(leafTable, "tbl_"))

	// If root table with no parent, simple view
	if len(nodes) == 1 {
		sql := fmt.Sprintf("CREATE OR REPLACE VIEW %s AS SELECT * FROM %s;", viewName, leafTable)
		_, err := tx.Exec(ctx, sql)
		return viewName, err
	}

	// Multi-table TPT view: collect distinct columns
	// We want columns from root to leaf, but avoid duplicate sys_id
	var selectCols []string
	seenCols := make(map[string]bool)

	// Collect columns for each table node from root to leaf (depth DESC)
	for i := len(nodes) - 1; i >= 0; i-- {
		node := nodes[i]
		colRows, err := tx.Query(ctx, `
			SELECT column_name FROM sys_dictionary
			WHERE table_id = $1
			ORDER BY sys_created_on ASC, column_name ASC
		`, node.id)
		if err != nil {
			return "", err
		}
		for colRows.Next() {
			var col string
			if err := colRows.Scan(&col); err == nil {
				if !seenCols[col] {
					seenCols[col] = true
					selectCols = append(selectCols, fmt.Sprintf("%s.%s", node.alias, col))
				}
			}
		}
		colRows.Close()
	}

	// Build FROM clause starting with leaf table
	fromClause := fmt.Sprintf("%s %s", nodes[0].name, nodes[0].alias)
	for i := 1; i < len(nodes); i++ {
		fromClause += fmt.Sprintf(" JOIN %s %s ON %s.sys_id = %s.sys_id",
			nodes[i].name, nodes[i].alias, nodes[i-1].alias, nodes[i].alias)
	}

	viewSQL := fmt.Sprintf("CREATE OR REPLACE VIEW %s AS SELECT %s FROM %s;",
		viewName, strings.Join(selectCols, ", "), fromClause)

	if _, err := tx.Exec(ctx, viewSQL); err != nil {
		return "", err
	}

	return viewName, nil
}

func mapTypeToPostgresDDL(iType string, maxLen int, defVal *string, refTableID *uuid.UUID, tx pgx.Tx, ctx context.Context) (string, bool) {
	isAutoNum := false
	var ddl string

	switch strings.ToLower(iType) {
	case "string":
		ddl = fmt.Sprintf("VARCHAR(%d)", maxLen)
	case "text":
		ddl = "TEXT"
	case "integer":
		ddl = "INTEGER"
	case "bigint":
		ddl = "BIGINT"
	case "boolean":
		ddl = "BOOLEAN DEFAULT FALSE"
	case "reference":
		if refTableID != nil {
			var targetName string
			_ = tx.QueryRow(ctx, "SELECT name FROM sys_db_object WHERE sys_id = $1", refTableID).Scan(&targetName)
			if targetName != "" {
				ddl = fmt.Sprintf("UUID REFERENCES %s(sys_id) ON DELETE RESTRICT", targetName)
			} else {
				ddl = "UUID"
			}
		} else {
			ddl = "UUID"
		}
	case "auto_number":
		ddl = "VARCHAR(22) NOT NULL UNIQUE"
		isAutoNum = true
	case "timestamptz":
		ddl = "TIMESTAMPTZ"
	case "jsonb":
		ddl = "JSONB DEFAULT '{}'::jsonb"
	case "uuid":
		ddl = "UUID"
	default:
		ddl = "VARCHAR(255)"
	}

	if defVal != nil && *defVal != "" && !isAutoNum && iType != "boolean" {
		ddl += fmt.Sprintf(" DEFAULT '%s'", *defVal)
	}

	return ddl, isAutoNum
}

func sanitizeIdentifier(s string) string {
	cleaned := strings.ReplaceAll(s, `"`, "")
	cleaned = strings.ReplaceAll(cleaned, `;`, "")
	cleaned = strings.ReplaceAll(cleaned, `--`, "")
	return cleaned
}

// GetTable retrieves table metadata by UUID or by physical name.
func (e *Engine) GetTable(ctx context.Context, idOrName string) (*TableInfo, error) {
	var t TableInfo
	query := `
		SELECT sys_id, name, label, super_class_id, is_extendable, is_kernel_table, sys_created_on
		FROM sys_db_object
	`
	var err error
	if parsedID, parseErr := uuid.Parse(idOrName); parseErr == nil {
		err = e.db.Pool.QueryRow(ctx, query+" WHERE sys_id = $1", parsedID).Scan(
			&t.SysID, &t.Name, &t.Label, &t.SuperClassID, &t.IsExtendable, &t.IsKernelTable, &t.SysCreatedOn,
		)
	} else {
		err = e.db.Pool.QueryRow(ctx, query+" WHERE name = $1", idOrName).Scan(
			&t.SysID, &t.Name, &t.Label, &t.SuperClassID, &t.IsExtendable, &t.IsKernelTable, &t.SysCreatedOn,
		)
	}
	if err != nil {
		return nil, fmt.Errorf("tabela '%s' não encontrada: %w", idOrName, err)
	}
	t.ViewName = fmt.Sprintf("v_%s", strings.TrimPrefix(t.Name, "tbl_"))
	return &t, nil
}

// UpdateTable updates mutable metadata of a table.
func (e *Engine) UpdateTable(ctx context.Context, id uuid.UUID, label string, isExtendable bool, userCtx *auth.SecurityContext) (*TableInfo, error) {
	err := auth.ExecuteInTx(ctx, e.db, userCtx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE sys_db_object
			SET label = $1, is_extendable = $2, sys_updated_on = clock_timestamp(), sys_updated_by = $3
			WHERE sys_id = $4
		`, label, isExtendable, userCtx.UserID, id)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return errors.New("tabela não encontrada para atualização")
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return e.GetTable(ctx, id.String())
}

// DeleteTable drops the physical table with CASCADE and cleans up all system metadata.
func (e *Engine) DeleteTable(ctx context.Context, id uuid.UUID, userCtx *auth.SecurityContext) error {
	t, err := e.GetTable(ctx, id.String())
	if err != nil {
		return err
	}
	if t.IsKernelTable {
		return errors.New("não é permitido excluir tabelas fundamentais do Kernel do sistema")
	}

	// Check if other tables extend this table
	var childCount int64
	err = e.db.Pool.QueryRow(ctx, "SELECT count(*) FROM sys_db_object WHERE super_class_id = $1", id).Scan(&childCount)
	if err != nil {
		return err
	}
	if childCount > 0 {
		return fmt.Errorf("não é possível excluir a tabela '%s' pois existem %d tabela(s) derivada(s) que herdam dela. Exclua as tabelas filhas primeiro.", t.Name, childCount)
	}

	return auth.ExecuteInTx(ctx, e.db, userCtx, func(tx pgx.Tx) error {
		// 1. Delete numbers and counters
		if _, err := tx.Exec(ctx, `DELETE FROM sys_number_counter WHERE number_id IN (SELECT sys_id FROM sys_number WHERE table_id = $1);`, id); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM sys_number WHERE table_id = $1;`, id); err != nil {
			return err
		}

		// 2. Delete choices
		if _, err := tx.Exec(ctx, "DELETE FROM sys_choice WHERE table_id = $1", id); err != nil {
			return err
		}

		// 3. Delete rules
		if _, err := tx.Exec(ctx, "DELETE FROM sys_script WHERE table_id = $1", id); err != nil {
			return err
		}

		// 4. Delete transitions
		if _, err := tx.Exec(ctx, "DELETE FROM sys_state_transition WHERE table_id = $1", id); err != nil {
			return err
		}

		// 5. Delete permissions
		if _, err := tx.Exec(ctx, `DELETE FROM sys_role_has_permission WHERE permission_id IN (SELECT sys_id FROM sys_permission WHERE table_id = $1);`, id); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM sys_permission WHERE table_id = $1;`, id); err != nil {
			return err
		}

		// 6. Delete dictionary entries
		if _, err := tx.Exec(ctx, "DELETE FROM sys_dictionary WHERE table_id = $1", id); err != nil {
			return err
		}

		// 7. Drop associated polymorphic view if defined
		if t.ViewName != "" {
			if _, err := tx.Exec(ctx, fmt.Sprintf("DROP VIEW IF EXISTS %s CASCADE;", t.ViewName)); err != nil {
				return fmt.Errorf("falha ao excluir view polimórfica %s: %w", t.ViewName, err)
			}
		}

		// 8. Drop physical table
		if _, err := tx.Exec(ctx, fmt.Sprintf("DROP TABLE IF EXISTS %s CASCADE;", t.Name)); err != nil {
			return fmt.Errorf("falha ao excluir tabela física %s: %w", t.Name, err)
		}

		// 9. Delete from sys_db_object
		cmd, err := tx.Exec(ctx, "DELETE FROM sys_db_object WHERE sys_id = $1", id)
		if err != nil {
			return err
		}
		if cmd.RowsAffected() == 0 {
			return errors.New("tabela não encontrada no catálogo")
		}
		return nil
	})
}

// GetField retrieves field definition from sys_dictionary.
func (e *Engine) GetField(ctx context.Context, fieldID uuid.UUID) (*FieldInfo, error) {
	query := `
		SELECT d.sys_id, d.table_id, d.column_name, d.label, d.internal_type,
		       COALESCE(d.max_length, 255), d.is_mandatory, d.is_read_only, d.default_value,
		       d.reference_table_id, o.name AS defined_in_table, 0 AS inheritance_level
		FROM sys_dictionary d
		JOIN sys_db_object o ON o.sys_id = d.table_id
		WHERE d.sys_id = $1
	`
	var f FieldInfo
	err := e.db.Pool.QueryRow(ctx, query, fieldID).Scan(
		&f.SysID, &f.TableID, &f.ColumnName, &f.Label, &f.InternalType,
		&f.MaxLength, &f.IsMandatory, &f.IsReadOnly, &f.DefaultValue,
		&f.ReferenceTableID, &f.DefinedInTable, &f.InheritanceLevel,
	)
	if err != nil {
		return nil, fmt.Errorf("campo não encontrado: %w", err)
	}
	return &f, nil
}

// UpdateField updates field properties in sys_dictionary.
func (e *Engine) UpdateField(ctx context.Context, fieldID uuid.UUID, label string, isMandatory, isReadOnly bool, defaultValue *string, userCtx *auth.SecurityContext) (*FieldInfo, error) {
	err := auth.ExecuteInTx(ctx, e.db, userCtx, func(tx pgx.Tx) error {
		cmd, err := tx.Exec(ctx, `
			UPDATE sys_dictionary
			SET label = $1, is_mandatory = $2, is_read_only = $3, default_value = $4
			WHERE sys_id = $5
		`, label, isMandatory, isReadOnly, defaultValue, fieldID)
		if err != nil {
			return err
		}
		if cmd.RowsAffected() == 0 {
			return errors.New("campo não encontrado para atualização")
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return e.GetField(ctx, fieldID)
}

// DeleteField drops the column from the physical table and regenerates views.
func (e *Engine) DeleteField(ctx context.Context, fieldID uuid.UUID, userCtx *auth.SecurityContext) error {
	var tableID uuid.UUID
	var colName, tableName string
	var isSystem bool

	err := e.db.Pool.QueryRow(ctx, `
		SELECT d.table_id, d.column_name, d.is_system_field, o.name
		FROM sys_dictionary d
		JOIN sys_db_object o ON o.sys_id = d.table_id
		WHERE d.sys_id = $1
	`, fieldID).Scan(&tableID, &colName, &isSystem, &tableName)
	if err != nil {
		return fmt.Errorf("campo não encontrado: %w", err)
	}

	if isSystem || strings.HasPrefix(colName, "sys_") {
		return errors.New("não é permitido excluir campos do sistema (kernel)")
	}

	return auth.ExecuteInTx(ctx, e.db, userCtx, func(tx pgx.Tx) error {
		// Drop column physically with cascade
		sql := fmt.Sprintf("ALTER TABLE %s DROP COLUMN IF EXISTS %s CASCADE;", tableName, sanitizeIdentifier(colName))
		if _, err := tx.Exec(ctx, sql); err != nil {
			return fmt.Errorf("falha ao remover coluna física: %w", err)
		}

		// Delete choices referencing this column
		_, _ = tx.Exec(ctx, "DELETE FROM sys_choice WHERE table_id = $1 AND element = $2", tableID, colName)

		// Delete dictionary entry
		cmd, err := tx.Exec(ctx, "DELETE FROM sys_dictionary WHERE sys_id = $1", fieldID)
		if err != nil {
			return err
		}
		if cmd.RowsAffected() == 0 {
			return errors.New("campo não encontrado no dicionário")
		}

		// Regenerate polymorphic views
		return e.propagatePolymorphicViews(ctx, tx, tableID)
	})
}

// ChoiceItem represents a Choice in sys_choice.
type ChoiceItem struct {
	SysID          uuid.UUID `json:"sys_id"`
	TableID        uuid.UUID `json:"table_id"`
	Element        string    `json:"element"`
	Value          string    `json:"value"`
	Label          string    `json:"label"`
	Sequence       int       `json:"sequence"`
	IsActive       bool      `json:"is_active"`
	DependentValue *string   `json:"dependent_value,omitempty"`
}

// GetChoice retrieves a single choice by ID.
func (e *Engine) GetChoice(ctx context.Context, choiceID uuid.UUID) (*ChoiceItem, error) {
	var c ChoiceItem
	err := e.db.Pool.QueryRow(ctx, `
		SELECT sys_id, table_id, element, value, label, sequence, is_active, dependent_value
		FROM sys_choice WHERE sys_id = $1
	`, choiceID).Scan(&c.SysID, &c.TableID, &c.Element, &c.Value, &c.Label, &c.Sequence, &c.IsActive, &c.DependentValue)
	if err != nil {
		return nil, fmt.Errorf("opção não encontrada: %w", err)
	}
	return &c, nil
}

// UpdateChoice updates a choice in sys_choice.
func (e *Engine) UpdateChoice(ctx context.Context, choiceID uuid.UUID, label, value string, sequence int, isActive bool, userCtx *auth.SecurityContext) (*ChoiceItem, error) {
	err := auth.ExecuteInTx(ctx, e.db, userCtx, func(tx pgx.Tx) error {
		cmd, err := tx.Exec(ctx, `
			UPDATE sys_choice
			SET label = $1, value = $2, sequence = $3, is_active = $4
			WHERE sys_id = $5
		`, label, value, sequence, isActive, choiceID)
		if err != nil {
			return err
		}
		if cmd.RowsAffected() == 0 {
			return errors.New("opção não encontrada para atualização")
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return e.GetChoice(ctx, choiceID)
}

// DeleteChoice removes a choice from sys_choice.
func (e *Engine) DeleteChoice(ctx context.Context, choiceID uuid.UUID, userCtx *auth.SecurityContext) error {
	return auth.ExecuteInTx(ctx, e.db, userCtx, func(tx pgx.Tx) error {
		cmd, err := tx.Exec(ctx, "DELETE FROM sys_choice WHERE sys_id = $1", choiceID)
		if err != nil {
			return err
		}
		if cmd.RowsAffected() == 0 {
			return errors.New("opção não encontrada para exclusão")
		}
		return nil
	})
}

