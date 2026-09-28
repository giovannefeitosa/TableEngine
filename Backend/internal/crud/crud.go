package crud

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"tableengine/internal/auth"
	"tableengine/internal/condition"
	"tableengine/internal/database"
	"tableengine/internal/ddl"
	"tableengine/internal/fsm"
	"tableengine/internal/numbering"
	"tableengine/internal/rules"
)

type ConcurrencyConflictError struct {
	Message string
}

func (e *ConcurrencyConflictError) Error() string {
	return e.Message
}

type Engine struct {
	db          *database.DB
	ddlEngine   *ddl.Engine
	numEngine   *numbering.Engine
	fsmEngine   *fsm.Engine
	rulesEngine *rules.Engine
	authService *auth.Service
}

func NewEngine(
	db *database.DB,
	ddlEngine *ddl.Engine,
	numEngine *numbering.Engine,
	fsmEngine *fsm.Engine,
	rulesEngine *rules.Engine,
	authService *auth.Service,
) *Engine {
	return &Engine{
		db:          db,
		ddlEngine:   ddlEngine,
		numEngine:   numEngine,
		fsmEngine:   fsmEngine,
		rulesEngine: rulesEngine,
		authService: authService,
	}
}

type ListResult struct {
	Meta MetaInfo                 `json:"meta"`
	Data []map[string]interface{} `json:"data"`
}

type MetaInfo struct {
	Table      string `json:"table"`
	TotalCount int64  `json:"total_count"`
	Limit      int    `json:"limit"`
	Offset     int    `json:"offset"`
}

// Create inserts a polymorphic record across all TPT hierarchy tables.
func (e *Engine) Create(ctx context.Context, tableName string, payload map[string]interface{}, userCtx *auth.SecurityContext) (map[string]interface{}, error) {
	// 1. Resolve table metadata
	var tableID uuid.UUID
	var isKernel bool
	err := e.db.Pool.QueryRow(ctx, "SELECT sys_id, is_kernel_table FROM sys_db_object WHERE name = $1", tableName).Scan(&tableID, &isKernel)
	if err != nil {
		return nil, fmt.Errorf("tabela '%s' não encontrada", tableName)
	}

	// 2. Check permission
	hasPerm, err := e.authService.HasPermission(ctx, userCtx, tableID, "create", nil, nil)
	if err != nil || !hasPerm {
		return nil, errors.New("permissão insuficiente para criar registros nesta tabela")
	}

	// 3. Execute before_insert business rules
	if err := e.rulesEngine.ExecuteRules(ctx, "before_insert", tableName, payload, nil, userCtx); err != nil {
		return nil, err
	}

	// 4. Resolve lineage from leaf to root
	lineage, err := e.getTableLineage(ctx, tableID)
	if err != nil {
		return nil, err
	}

	newID := uuid.New()
	if idVal, ok := payload["sys_id"].(string); ok && idVal != "" {
		if parsed, err := uuid.Parse(idVal); err == nil {
			newID = parsed
		}
	}
	payload["sys_id"] = newID.String()

	// Resolve any state reference columns in payload (e.g. state: "new" -> UUID of "new" state in sys_state)
	if stateRefCols, err := e.fsmEngine.GetStateReferenceColumns(ctx, tableID); err == nil {
		if len(stateRefCols) == 0 && payload["state"] != nil {
			stateRefCols = append(stateRefCols, "state")
		}
		for _, col := range stateRefCols {
			if val, exists := payload[col]; exists && val != nil && val != "" {
				if s, err := e.fsmEngine.ResolveState(ctx, val, &tableID); err == nil && s != nil {
					payload[col] = s.SysID.String()
				}
			}
		}
	}

	err = auth.ExecuteInTx(ctx, e.db, userCtx, func(tx pgx.Tx) error {
		// Generate auto-number if number field exists
		autoNum, err := e.numEngine.GetNextNumber(ctx, tx, tableID, "number")
		if err == nil && autoNum != "" {
			payload["number"] = autoNum
		}

		// Insert into root table (lineage[len(lineage)-1])
		rootNode := lineage[len(lineage)-1]
		rootFields, err := e.getTableColumns(ctx, tx, rootNode.ID)
		if err != nil {
			return err
		}

		if err := e.insertRow(ctx, tx, rootNode.Name, newID, tableName, rootFields, payload, userCtx, true, isKernel); err != nil {
			return fmt.Errorf("falha ao inserir na tabela raiz %s: %w", rootNode.Name, err)
		}

		// Insert into child tables down to leaf
		for i := len(lineage) - 2; i >= 0; i-- {
			childNode := lineage[i]
			childFields, err := e.getTableColumns(ctx, tx, childNode.ID)
			if err != nil {
				return err
			}
			if err := e.insertRow(ctx, tx, childNode.Name, newID, tableName, childFields, payload, userCtx, false, isKernel); err != nil {
				return fmt.Errorf("falha ao inserir na tabela derivada %s: %w", childNode.Name, err)
			}
		}

		// 5. Execute after_insert business rules
		return e.rulesEngine.ExecuteRules(ctx, "after_insert", tableName, payload, nil, userCtx)
	})

	if err != nil {
		return nil, err
	}

	return e.ReadSingle(ctx, tableName, newID, userCtx)
}

// ReadList retrieves paginated records through the polymorphic view.
func (e *Engine) ReadList(ctx context.Context, tableName string, limit, offset int, sortBy, sortDir, query string, userCtx *auth.SecurityContext) (*ListResult, error) {
	var tableID uuid.UUID
	var isKernel bool
	err := e.db.Pool.QueryRow(ctx, "SELECT sys_id, is_kernel_table FROM sys_db_object WHERE name = $1", tableName).Scan(&tableID, &isKernel)
	if err != nil {
		return nil, fmt.Errorf("tabela '%s' não encontrada", tableName)
	}

	hasPerm, err := e.authService.HasPermission(ctx, userCtx, tableID, "read", nil, nil)
	if err != nil || !hasPerm {
		return nil, errors.New("permissão insuficiente para consultar registros nesta tabela")
	}

	viewName := tableName
	if !isKernel {
		viewName = fmt.Sprintf("v_%s", strings.TrimPrefix(tableName, "tbl_"))
	}

	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	if offset < 0 {
		offset = 0
	}

	if sortBy == "" {
		sortBy = "sys_created_on"
	}
	if !strings.EqualFold(sortDir, "asc") {
		sortDir = "desc"
	}

	// Count total rows
	var totalCount int64
	countSQL := fmt.Sprintf("SELECT COUNT(*) FROM %s", viewName)
	_ = e.db.Pool.QueryRow(ctx, countSQL).Scan(&totalCount)

	// Fetch data
	dataSQL := fmt.Sprintf("SELECT * FROM %s ORDER BY %s %s LIMIT %d OFFSET %d",
		viewName, sanitizeIdentifier(sortBy), sortDir, limit, offset)

	rows, err := e.db.Pool.Query(ctx, dataSQL)
	if err != nil {
		// Fallback to table directly if view has issue
		dataSQL = fmt.Sprintf("SELECT * FROM %s ORDER BY %s %s LIMIT %d OFFSET %d",
			tableName, sanitizeIdentifier(sortBy), sortDir, limit, offset)
		rows, err = e.db.Pool.Query(ctx, dataSQL)
		if err != nil {
			return nil, fmt.Errorf("falha ao consultar registros: %w", err)
		}
	}
	defer rows.Close()

	records, err := scanRowsToMaps(rows)
	if err != nil {
		return nil, err
	}

	return &ListResult{
		Meta: MetaInfo{
			Table:      tableName,
			TotalCount: totalCount,
			Limit:      limit,
			Offset:     offset,
		},
		Data: records,
	}, nil
}

// ReadSingle retrieves a single consolidated record by UUID.
func (e *Engine) ReadSingle(ctx context.Context, tableName string, recordID uuid.UUID, userCtx *auth.SecurityContext) (map[string]interface{}, error) {
	var tableID uuid.UUID
	var isKernel bool
	err := e.db.Pool.QueryRow(ctx, "SELECT sys_id, is_kernel_table FROM sys_db_object WHERE name = $1", tableName).Scan(&tableID, &isKernel)
	if err != nil {
		return nil, fmt.Errorf("tabela '%s' não encontrada", tableName)
	}

	hasPerm, err := e.authService.HasPermission(ctx, userCtx, tableID, "read", nil, nil)
	if err != nil || !hasPerm {
		return nil, errors.New("permissão insuficiente para consultar este registro")
	}

	viewName := tableName
	if !isKernel {
		viewName = fmt.Sprintf("v_%s", strings.TrimPrefix(tableName, "tbl_"))
	}

	query := fmt.Sprintf("SELECT * FROM %s WHERE sys_id = $1 LIMIT 1", viewName)
	rows, err := e.db.Pool.Query(ctx, query, recordID)
	if err != nil {
		// Fallback to table directly
		query = fmt.Sprintf("SELECT * FROM %s WHERE sys_id = $1 LIMIT 1", tableName)
		rows, err = e.db.Pool.Query(ctx, query, recordID)
		if err != nil {
			return nil, err
		}
	}
	defer rows.Close()

	records, err := scanRowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	if len(records) == 0 {
		return nil, errors.New("registro não encontrado")
	}

	return records[0], nil
}

// Update updates records across TPT tables with optimistic locking and FSM checks.
func (e *Engine) Update(ctx context.Context, tableName string, recordID uuid.UUID, payload map[string]interface{}, userCtx *auth.SecurityContext) (map[string]interface{}, error) {
	var tableID uuid.UUID
	var isKernel bool
	err := e.db.Pool.QueryRow(ctx, "SELECT sys_id, is_kernel_table FROM sys_db_object WHERE name = $1", tableName).Scan(&tableID, &isKernel)
	if err != nil {
		return nil, fmt.Errorf("tabela '%s' não encontrada", tableName)
	}

	hasPerm, err := e.authService.HasPermission(ctx, userCtx, tableID, "update", nil, nil)
	if err != nil || !hasPerm {
		return nil, errors.New("permissão insuficiente para atualizar registros nesta tabela")
	}

	currentRecord, err := e.ReadSingle(ctx, tableName, recordID, userCtx)
	if err != nil {
		return nil, err
	}

	// 1. Optimistic Concurrency Check
	expectedModCount, hasModCount := payload["sys_mod_count"]
	if !hasModCount {
		expectedModCount = currentRecord["sys_mod_count"]
	}

	// 2. FSM State Transition Check for ANY column that references sys_state
	stateRefCols, _ := e.fsmEngine.GetStateReferenceColumns(ctx, tableID)
	hasStateRef := false
	for _, col := range stateRefCols {
		if col == "state" {
			hasStateRef = true
			break
		}
	}
	if !hasStateRef && payload["state"] != nil {
		stateRefCols = append(stateRefCols, "state")
	}

	for _, stateCol := range stateRefCols {
		proposedVal, exists := payload[stateCol]
		if !exists || proposedVal == nil || proposedVal == "" {
			continue
		}

		currVal := currentRecord[stateCol]
		currState, errCurr := e.fsmEngine.ResolveState(ctx, currVal, &tableID)
		newState, errNew := e.fsmEngine.ResolveState(ctx, proposedVal, &tableID)

		if errNew != nil || newState == nil {
			return nil, fmt.Errorf("o valor '%v' para o campo '%s' não é um estado válido cadastrado em sys_state", proposedVal, stateCol)
		}

		if errCurr != nil || currState == nil {
			currState, _ = e.fsmEngine.ResolveState(ctx, "new", &tableID)
		}

		if currState != nil && newState != nil && currState.SysID != newState.SysID {
			// Find matching transition using polymorphic lineage CTE
			cte := `
				WITH RECURSIVE lineage AS (
					SELECT sys_id, super_class_id, 0 AS depth
					FROM sys_db_object WHERE sys_id = $1
					UNION ALL
					SELECT p.sys_id, p.super_class_id, l.depth + 1
					FROM sys_db_object p
					JOIN lineage l ON l.super_class_id = p.sys_id
				)
				SELECT st.sys_id, st.required_role_id, st.condition_tree, st.on_transition_action
				FROM lineage l
				JOIN sys_state_transition st ON st.table_id = l.sys_id
				WHERE st.state_field = $2
				  AND (st.from_state_id = $3 OR st.from_state = $4)
				  AND (st.to_state_id = $5 OR st.to_state = $6)
				  AND st.is_active = TRUE
				ORDER BY l.depth ASC
				LIMIT 1
			`
			var transID uuid.UUID
			var reqRoleID *uuid.UUID
			var condTreeBytes, onActionBytes []byte
			err := e.db.Pool.QueryRow(ctx, cte, tableID, stateCol, currState.SysID, currState.Name, newState.SysID, newState.Name).Scan(
				&transID, &reqRoleID, &condTreeBytes, &onActionBytes,
			)
			if err != nil {
				return nil, fmt.Errorf("transição de estado inválida de '%s' para '%s' no campo '%s'", currState.Label, newState.Label, stateCol)
			}

			// Validate role requirement
			if reqRoleID != nil && !userCtx.HasRole("admin") {
				hasRole := false
				for _, rid := range userCtx.RoleIDs {
					if rid == *reqRoleID {
						hasRole = true
						break
					}
				}
				if !hasRole {
					return nil, fmt.Errorf("permissão insuficiente para a transição de '%s' para '%s'", currState.Label, newState.Label)
				}
			}

			// Validate execute permission
			actionName := fmt.Sprintf("transition:%s:%s", currState.Name, newState.Name)
			hasPerm, err := e.authService.HasPermission(ctx, userCtx, tableID, "execute", nil, &actionName)
			if (err != nil || !hasPerm) && !userCtx.HasRole("admin") {
				return nil, fmt.Errorf("não autorizado a executar a transição '%s'", actionName)
			}

			// Validate condition tree
			if len(condTreeBytes) > 0 {
				tree, err := condition.ParseConditionTree(condTreeBytes)
				if err == nil && tree != nil {
					merged := make(map[string]interface{})
					for k, v := range currentRecord {
						merged[k] = v
					}
					for k, v := range payload {
						merged[k] = v
					}
					merged[stateCol] = newState.SysID.String()
					merged[stateCol+"_name"] = newState.Name
					merged[stateCol+"_label"] = newState.Label
					if !condition.EvaluateCondition(tree, merged, currentRecord, userCtx) {
						return nil, fmt.Errorf("condições obrigatórias para a transição para '%s' não atendidas", newState.Label)
					}
				}
			}

			// Apply on_transition_action
			if len(onActionBytes) > 0 {
				var actionDef struct {
					SetFields map[string]interface{} `json:"set_fields"`
				}
				if err := json.Unmarshal(onActionBytes, &actionDef); err == nil {
					nowStr := time.Now().UTC().Format(time.RFC3339)
					for k, v := range actionDef.SetFields {
						valStr := fmt.Sprintf("%v", v)
						if valStr == "$NOW" {
							payload[k] = nowStr
						} else if valStr == "$CURRENT_USER" {
							payload[k] = userCtx.UserID.String()
						} else {
							payload[k] = v
						}
					}
				}
			}

			// Store the UUID foreign key
			payload[stateCol] = newState.SysID.String()
		} else if newState != nil {
			payload[stateCol] = newState.SysID.String()
		}
	}

	// 3. Execute before_update rules
	if err := e.rulesEngine.ExecuteRules(ctx, "before_update", tableName, payload, currentRecord, userCtx); err != nil {
		return nil, err
	}

	lineage, err := e.getTableLineage(ctx, tableID)
	if err != nil {
		return nil, err
	}

	err = auth.ExecuteInTx(ctx, e.db, userCtx, func(tx pgx.Tx) error {
		rootNode := lineage[len(lineage)-1]
		rootCols, err := e.getTableColumns(ctx, tx, rootNode.ID)
		if err != nil {
			return err
		}

		// Update root table with sys_mod_count check
		affected, err := e.updateRow(ctx, tx, rootNode.Name, recordID, rootCols, payload, userCtx, expectedModCount, true, isKernel)
		if err != nil {
			return err
		}
		if affected == 0 {
			currMod := currentRecord["sys_mod_count"]
			return &ConcurrencyConflictError{
				Message: fmt.Sprintf("O registro foi modificado por outro usuário (versão esperada: %v, versão atual: %v).", expectedModCount, currMod),
			}
		}

		// Update child tables
		for i := len(lineage) - 2; i >= 0; i-- {
			childNode := lineage[i]
			childCols, err := e.getTableColumns(ctx, tx, childNode.ID)
			if err != nil {
				return err
			}
			_, err = e.updateRow(ctx, tx, childNode.Name, recordID, childCols, payload, userCtx, nil, false, isKernel)
			if err != nil {
				return err
			}
		}

		// 4. Execute after_update rules
		return e.rulesEngine.ExecuteRules(ctx, "after_update", tableName, payload, currentRecord, userCtx)
	})

	if err != nil {
		return nil, err
	}

	return e.ReadSingle(ctx, tableName, recordID, userCtx)
}

// Delete removes record from root table; PostgreSQL cascaded FK deletes child tables.
func (e *Engine) Delete(ctx context.Context, tableName string, recordID uuid.UUID, userCtx *auth.SecurityContext) error {
	var tableID uuid.UUID
	err := e.db.Pool.QueryRow(ctx, "SELECT sys_id FROM sys_db_object WHERE name = $1", tableName).Scan(&tableID)
	if err != nil {
		return fmt.Errorf("tabela '%s' não encontrada", tableName)
	}

	hasPerm, err := e.authService.HasPermission(ctx, userCtx, tableID, "delete", nil, nil)
	if err != nil || !hasPerm {
		return errors.New("permissão insuficiente para excluir registros nesta tabela")
	}

	lineage, err := e.getTableLineage(ctx, tableID)
	if err != nil {
		return err
	}
	rootNode := lineage[len(lineage)-1]

	return auth.ExecuteInTx(ctx, e.db, userCtx, func(tx pgx.Tx) error {
		sql := fmt.Sprintf("DELETE FROM %s WHERE sys_id = $1;", rootNode.Name)
		cmd, err := tx.Exec(ctx, sql, recordID)
		if err != nil {
			return err
		}
		if cmd.RowsAffected() == 0 {
			return errors.New("registro não encontrado para exclusão")
		}
		return nil
	})
}

// ExecuteStateTransition executes a state transition atomically with all guards and mutators.
func (e *Engine) ExecuteStateTransition(
	ctx context.Context,
	tableName string,
	recordID uuid.UUID,
	transitionID uuid.UUID,
	payload map[string]interface{},
	userCtx *auth.SecurityContext,
) (map[string]interface{}, error) {
	currentRecord, err := e.ReadSingle(ctx, tableName, recordID, userCtx)
	if err != nil {
		return nil, err
	}

	var mutated map[string]interface{}
	err = auth.ExecuteInTx(ctx, e.db, userCtx, func(tx pgx.Tx) error {
		_, resMap, err := e.fsmEngine.ValidateAndApplyTransition(ctx, tx, tableName, currentRecord, transitionID, payload, userCtx)
		if err != nil {
			return err
		}
		mutated = resMap
		return nil
	})
	if err != nil {
		return nil, err
	}

	// Forward to normal Update with mutated payload
	return e.Update(ctx, tableName, recordID, mutated, userCtx)
}

type LineageNode struct {
	ID    uuid.UUID
	Name  string
	Depth int
}

func (e *Engine) getTableLineage(ctx context.Context, tableID uuid.UUID) ([]LineageNode, error) {
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
	rows, err := e.db.Pool.Query(ctx, cte, tableID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var nodes []LineageNode
	for rows.Next() {
		var n LineageNode
		if err := rows.Scan(&n.ID, &n.Name, &n.Depth); err != nil {
			return nil, err
		}
		nodes = append(nodes, n)
	}
	return nodes, nil
}

func (e *Engine) getTableColumns(ctx context.Context, tx pgx.Tx, tableID uuid.UUID) (map[string]bool, error) {
	rows, err := tx.Query(ctx, "SELECT column_name FROM sys_dictionary WHERE table_id = $1", tableID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	cols := make(map[string]bool)
	for rows.Next() {
		var col string
		if err := rows.Scan(&col); err == nil {
			cols[col] = true
		}
	}
	return cols, nil
}

func (e *Engine) insertRow(
	ctx context.Context,
	tx pgx.Tx,
	tableName string,
	recordID uuid.UUID,
	concreteClass string,
	tableCols map[string]bool,
	payload map[string]interface{},
	userCtx *auth.SecurityContext,
	isRoot bool,
	isKernel bool,
) error {
	var cols []string
	var placeholders []string
	var args []interface{}
	idx := 1

	cols = append(cols, "sys_id")
	placeholders = append(placeholders, fmt.Sprintf("$%d", idx))
	args = append(args, recordID)
	idx++

	if isRoot && !isKernel {
		cols = append(cols, "sys_class_name")
		placeholders = append(placeholders, fmt.Sprintf("$%d", idx))
		args = append(args, concreteClass)
		idx++

		cols = append(cols, "sys_created_by", "sys_updated_by")
		placeholders = append(placeholders, fmt.Sprintf("$%d", idx), fmt.Sprintf("$%d", idx+1))
		args = append(args, userCtx.UserID, userCtx.UserID)
		idx += 2
	}

	for k, v := range payload {
		if k == "sys_id" || k == "sys_class_name" || k == "sys_created_by" || k == "sys_updated_by" || k == "sys_created_on" || k == "sys_updated_on" || k == "sys_mod_count" {
			continue
		}
		if tableCols[k] {
			cols = append(cols, sanitizeIdentifier(k))
			placeholders = append(placeholders, fmt.Sprintf("$%d", idx))
			args = append(args, v)
			idx++
		}
	}

	sql := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s);",
		tableName, strings.Join(cols, ", "), strings.Join(placeholders, ", "))

	_, err := tx.Exec(ctx, sql, args...)
	return err
}

func (e *Engine) updateRow(
	ctx context.Context,
	tx pgx.Tx,
	tableName string,
	recordID uuid.UUID,
	tableCols map[string]bool,
	payload map[string]interface{},
	userCtx *auth.SecurityContext,
	expectedModCount interface{},
	isRoot bool,
	isKernel bool,
) (int64, error) {
	var sets []string
	var args []interface{}
	idx := 1

	if isRoot && !isKernel {
		sets = append(sets, "sys_updated_on = clock_timestamp()")
		sets = append(sets, fmt.Sprintf("sys_updated_by = $%d", idx))
		args = append(args, userCtx.UserID)
		idx++

		sets = append(sets, "sys_mod_count = sys_mod_count + 1")
	}

	for k, v := range payload {
		if k == "sys_id" || k == "sys_class_name" || k == "sys_created_by" || k == "sys_updated_by" || k == "sys_created_on" || k == "sys_updated_on" || k == "sys_mod_count" {
			continue
		}
		if tableCols[k] {
			sets = append(sets, fmt.Sprintf("%s = $%d", sanitizeIdentifier(k), idx))
			args = append(args, v)
			idx++
		}
	}

	if len(sets) == 0 {
		return 1, nil // No columns to update in this table
	}

	args = append(args, recordID)
	whereClause := fmt.Sprintf("WHERE sys_id = $%d", idx)
	idx++

	if isRoot && expectedModCount != nil && !isKernel {
		whereClause += fmt.Sprintf(" AND sys_mod_count = $%d", idx)
		args = append(args, expectedModCount)
		idx++
	}

	sql := fmt.Sprintf("UPDATE %s SET %s %s;", tableName, strings.Join(sets, ", "), whereClause)
	cmd, err := tx.Exec(ctx, sql, args...)
	if err != nil {
		return 0, err
	}
	return cmd.RowsAffected(), nil
}

func sanitizeIdentifier(s string) string {
	cleaned := strings.ReplaceAll(s, `"`, "")
	cleaned = strings.ReplaceAll(cleaned, `;`, "")
	cleaned = strings.ReplaceAll(cleaned, `--`, "")
	return cleaned
}

func scanRowsToMaps(rows pgx.Rows) ([]map[string]interface{}, error) {
	fields := rows.FieldDescriptions()
	records := make([]map[string]interface{}, 0)

	for rows.Next() {
		values, err := rows.Values()
		if err != nil {
			return nil, err
		}
		record := make(map[string]interface{})
		for i, fd := range fields {
			val := values[i]
			record[string(fd.Name)] = formatColumnValue(val)
		}
		records = append(records, record)
	}
	return records, nil
}

func formatColumnValue(val interface{}) interface{} {
	if val == nil {
		return nil
	}
	switch v := val.(type) {
	case [16]byte:
		u, err := uuid.FromBytes(v[:])
		if err == nil {
			return u.String()
		}
		return fmt.Sprintf("%x", v)
	case []byte:
		if len(v) == 16 {
			u, err := uuid.FromBytes(v)
			if err == nil {
				return u.String()
			}
		}
		return string(v)
	case time.Time:
		return v.UTC().Format(time.RFC3339)
	default:
		return v
	}
}
